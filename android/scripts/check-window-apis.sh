#!/usr/bin/env bash
# Fails if the release bundle's code uses what Play Console flags as deprecated for edge to edge (Android 15):
# Window.setStatusBarColor, Window.setNavigationBarColor, and LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES. Why the app
# avoids them: android/README.md § Releasing to Google Play. Run from android/ after bundleRelease.
#
# SHORT_EDGES is the int 1, so it shows in the dex only as a write of 1 to WindowManager.LayoutParams
# .layoutInDisplayCutoutMode: the check follows each such write back to the register's last constant in the method.
set -euo pipefail

bundle="${1:-app/build/outputs/bundle/release/app-release.aab}"
here="$(cd "$(dirname "$0")" && pwd)"
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
latest() { ls -d $1 2>/dev/null | sort -V | tail -n 1 || true; }
dexdump="$(latest "$sdk/build-tools/*/dexdump")"
d8="$(latest "$sdk/build-tools/*/d8")"
androidJar="$(latest "$sdk/platforms/android-*/android.jar")"
for tool in dexdump d8 androidJar; do
  if [ -z "${!tool}" ]; then echo "::error::$tool not found under \$ANDROID_HOME"; exit 1; fi
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
unzip -q -o "$bundle" 'base/dex/*.dex' -d "$work"

# Positive control: the fixture's three uses must be found, and its ALWAYS write must not be.
mkdir -p "$work/fixture/classes" "$work/fixture/dex"
javac -nowarn --release 11 -cp "$androidJar" -d "$work/fixture/classes" "$here/window-apis-fixture/Fixture.java"
"$d8" --min-api 26 --lib "$androidJar" --output "$work/fixture/dex" "$work"/fixture/classes/*.class
"$dexdump" -d "$work/fixture/dex/classes.dex" >"$work/fixture/dump.txt"
"$here/find-window-apis.awk" "$work/fixture/dump.txt" >"$work/fixture/hits.txt" || true
if [ "$(grep -c "'flagged'" "$work/fixture/hits.txt")" -ne 3 ] || grep -q "'fine'" "$work/fixture/hits.txt"; then
  echo "::error::The check no longer reads dexdump's output right; on the fixture it found:"
  cat "$work/fixture/hits.txt"
  exit 1
fi

found=0
for dex in "$work"/base/dex/*.dex; do
  # Disassemble to a file first, so a dexdump failure stops the script rather than reading as "no calls".
  "$dexdump" -d "$dex" >"$work/dump.txt"
  if "$here/find-window-apis.awk" "$work/dump.txt" >"$work/hits.txt"; then :; else
    echo "::error::$(basename "$dex") uses Window APIs deprecated for edge to edge:"
    sort -u "$work/hits.txt"
    found=1
  fi
done

# The cutout mode can also come from a theme, which the dex does not show.
if grep -rnE '>[[:space:]]*shortEdges[[:space:]]*<' app/src/main/res >"$work/src.txt"; then
  echo "::error::A theme sets the deprecated shortEdges cutout mode:"
  cat "$work/src.txt"
  found=1
fi

[ "$found" -eq 0 ] && echo "No deprecated edge-to-edge Window APIs in the release bundle."
exit "$found"
