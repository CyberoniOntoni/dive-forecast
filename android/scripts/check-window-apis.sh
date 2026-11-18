#!/usr/bin/env bash
# Fails if the release bundle's code calls a Window API that Android 15 deprecates for edge to edge. Play Console
# flags these on every upload ("Your app uses deprecated APIs or parameters for edge-to-edge"); they came from
# androidx.activity's enableEdgeToEdge() before MainActivity moved the bar setup to the theme. Run after bundleRelease.
# LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES is an int constant, so it cannot be told apart in the dex: keep it out of
# code by hand (the theme sets the cutout mode).
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
  if "$dexdump" -d "$dex" | grep -E 'Landroid/view/Window;\.(setStatusBarColor|setNavigationBarColor|setNavigationBarDividerColor):' >"$work/hits.txt"; then
    echo "::error::$(basename "$dex") calls deprecated Window bar-colour APIs:"
    sort -u "$work/hits.txt" | sed 's/^.*invoke/  invoke/'
    found=1
  fi
done
[ "$found" -eq 0 ] && echo "No deprecated Window bar-colour calls in the release bundle."
exit "$found"
