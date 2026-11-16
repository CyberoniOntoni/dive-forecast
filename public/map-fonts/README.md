# Map label glyphs

Signed-distance-field glyphs for the Android app's MapLibre map (site names), served from `/map-fonts/{fontstack}/{range}.pbf`
so the app does not load them from MapLibre's demo server. The app names the font stack `open-sans-semibold`.

- Font: Open Sans Semibold by Steve Matteson, under the Apache License 2.0 (Open Sans is also published under the SIL Open
  Font License 1.1).
- Glyph ranges: `0-255` (Latin-1), `256-511` (Latin Extended-A) and `8192-8447` (dashes, quotes), built by the
  OpenMapTiles fonts project and copied from demotiles.maplibre.org on 16 Nov 2026. A label character outside them
  is not drawn; add its range here when a site name needs it.
