# DMG installer window styling

Two owners, in this order:

1. `tauri.conf.json` → `bundle.macOS.dmg`: background, window size, icon
   positions. Tauri applies these while bundling. All release channels inherit
   it (the preview/publicdev overlays define no `bundle` section).
2. `scripts/pipeline/tauri/relayout-macos-dmg.mjs`, run by `build-tauri.yml`
   right before notarization: re-applies that layout plus what Tauri cannot
   express, then re-signs the DMG (Tauri signed the original).

What Tauri cannot express, and why the second step exists:

- **Icon size.** Tauri never passes `--icon-size` to its DMG script, so icons
  render at its default 128pt. The step sets **88pt** (text **12pt**).
- **Hidden volume items.** Tauri parks "every item" off-window, but Finder's
  "every item" skips invisible files, so `.background` and `.VolumeIcon.icns`
  stay on top of the background for anyone who shows hidden files. The step
  parks them by name, with Finder's hidden files shown for the duration
  (`--show-hidden-files`, CI only: it restarts Finder).
- **CI.** Tauri also skips its whole Finder pass when `CI=true`;
  `TAURI_BUNDLER_DMG_IGNORE_CI=true` on the bundling step turns it back on.

## Source of truth

- Background master: marketing `dmg-bg.png`, **2824x2728** (27 Sep 2026
  export: tighter crop, headline on two lines). Supersedes the 3260x2728,
  4096x2728 and 3072x2046 exports.

## Geometry

- Window: **623x602 points** (the master's 1.035 aspect ratio).
- `dmg-background.png`: **1246x1204 px @144 DPI**, exactly 2x the window.
  Tauri's DMG `background` takes png/jpg/gif only, so 2x PNG + DPI metadata is
  the retina path. Regenerate:

  ```bash
  sips -z 1204 1246 dmg-bg.png --out dmg-background.png
  sips -s dpiWidth 144 -s dpiHeight 144 dmg-background.png
  ```

- Icon centres (Finder `position` = icon centre), measured on the master:
  - x on the QR-code columns: 27.18% and 72.36% of the width → `169` and `451`;
  - y `305`: level with the arrow's top (arrow spans 50.4%–55.2% of the height,
    its ends at 51.7%), a touch above its centre by design.
  At 88pt the arrow (38.7%–61.2% of the width, centred) sits between the two
  icons with an even ~27pt gap on each side.

## QR codes

Baked into the background; they target **https://happier.dev/appstore** and
**https://happier.dev/playstore** (website `_redirects`). If those URLs change,
regenerate the background from a new design export.

## Icon labels

Finder cannot hide labels. The app label is the bundle filename and follows the
app into /Applications, so it always shows the variant's `productName`; never
rename the bundle to change it. Renaming the Applications symlink to U+2800
(invisible) remains an option for the relayout step; not applied.
