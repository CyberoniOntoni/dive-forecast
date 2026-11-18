#!/usr/bin/env bash
# Fails if the release bundle's code uses what Play Console flags as deprecated for edge to edge (Android 15):
# Window.setStatusBarColor, Window.setNavigationBarColor, and LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES. Why the app
# avoids them: android/README.md § Releasing to Google Play. Run from android/ after bundleRelease.
#
# SHORT_EDGES is the int 1, so it shows in the dex only as a write of 1 to WindowManager.LayoutParams
# .layoutInDisplayCutoutMode: the check follows each such write back to the register's last constant in the method.
set -euo pipefail

bundle="${1:-app/build/outputs/bundle/release/app-release.aab}"
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
dexdump="$(ls -d "$sdk"/build-tools/*/dexdump 2>/dev/null | sort -V | tail -n 1 || true)"
if [ -z "$dexdump" ]; then echo "::error::dexdump not found under \$ANDROID_HOME/build-tools"; exit 1; fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
unzip -q -o "$bundle" 'base/dex/*.dex' -d "$work"

found=0
for dex in "$work"/base/dex/*.dex; do
  # Disassemble to a file first, so a dexdump failure stops the script rather than reading as "no calls".
  "$dexdump" -d "$dex" >"$work/dump.txt"
  if "$(dirname "$0")/find-window-apis.awk" "$work/dump.txt" >"$work/hits.txt"; then :; else
    echo "::error::$(basename "$dex") uses Window APIs deprecated for edge to edge:"
    sort -u "$work/hits.txt"
    found=1
  fi
done

# The theme sets the cutout mode; shortEdges there is the same deprecated mode.
if grep -rnE 'shortEdges|SHORT_EDGES' app/src/main --include='*.xml' --include='*.kt' --include='*.java' \
  | grep -vE '^\S+:[0-9]+:\s*(//|\*|<!--)|Never shortEdges' >"$work/src.txt"; then
  echo "::error::The source sets the deprecated short-edges cutout mode:"
  cat "$work/src.txt"
  found=1
fi

[ "$found" -eq 0 ] && echo "No deprecated edge-to-edge Window APIs in the release bundle."
exit "$found"
