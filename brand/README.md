# 50bar brand

The mark is "Waterline": "50" cut by the sea surface, with the digits below the surface pushed sideways by the current.
The digits are Space Grotesk Bold (OFL, `android/licenses/`) converted to outlines; the colours are the Tideline tokens.

| File | Use |
| --- | --- |
| `50bar-icon.svg` | Master artwork, 108-unit adaptive-icon canvas (visible area 18–90). |
| `50bar-play-icon-512.png` | Google Play store icon (512 × 512, square; Play rounds the corners). |
| `../app/icon.svg`, `../app/favicon.ico`, `../app/apple-icon.png` | Web icons (Next.js file conventions). |
| `../components/BrandMark.tsx` | Mark in the web header. |
| `../android/app/src/main/res/drawable/ic_launcher_*.xml` | Android adaptive icon: background (sky and sea), foreground (digits and wave), monochrome (themed icon). |

All of them share the same paths: change the master and regenerate the rest together, so the wave lines up between the background and foreground layers.
