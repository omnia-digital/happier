/**
 * Generates the desktop shell's raster icons from the vector Happier mark (the same sources as the
 * app icon, `apps/ui/src-tauri/icons/AppIcon.icon/Assets/{HappierBag,HappierSmile}.svg`):
 *
 *   apps/ui/src-tauri/icons/dock/dock-icon.png — the running app's macOS Dock image, 1024×1024.
 *     `NSApplication.applicationIconImage` is drawn into the whole Dock cell as-is, while macOS
 *     draws every bundled icon as an 824-point tile centered in its 1024-point cell with a soft
 *     shadow. So the mark carries that grid itself — 824 px, 100 px margins, the system icon
 *     shadow — and matches its neighbours; the notch stays transparent. `src/dock_icon.rs` embeds it.
 *   apps/ui/src-tauri/icons/tray/tray-template.png — macOS menu-bar template: black bag with
 *     the smile knocked out (transparent). 36×36 px because tray-icon draws the status-item
 *     image 18 pt tall, so this is its @2x; the glyph is 32 px (16 pt) with 2 px padding.
 *   apps/ui/src-tauri/icons/tray/tray.png — Windows/Linux light trays: full-colour mark
 *     (gradient bag, white smile), 32×32 px full bleed, so edges stay pixel-aligned at 16 and 24 px.
 *   apps/ui/src-tauri/icons/tray/tray-dark.png — Windows/Linux dark trays: the template glyph in
 *     white (smile knocked out), 32×32 px full bleed. The dark bag vanishes on a dark tray.
 *   apps/ui/src-tauri/icons/dev/** — the blue development variant of the same mark, with an amber
 *     D badge. The layered Icon Composer file, raster fallbacks, ICO, ICNS, and running Dock image
 *     all come from the same vector paths. `iconutil` regenerates ICNS on macOS.
 *
 * Each PNG is rasterized directly at its final size (librsvg via the repo's `sharp`), no
 * resampling. `apps/ui/src-tauri/src/tray.rs` embeds them with `tauri::include_image!`.
 *
 * Regenerate with:  node scripts/generateDesktopIcons.mjs
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = path.join(repoRoot, 'apps', 'ui', 'src-tauri', 'icons');
const assetsDir = path.join(iconsDir, 'AppIcon.icon', 'Assets');
const devDir = path.join(iconsDir, 'dev');

// The dev mark keeps the same silhouette and smile. A blue bag and small amber D remain
// recognizable at Dock size while making a running test build visually distinct.
const devGradient = '<linearGradient id="g" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stop-color="#1261A8"/><stop offset="100%" stop-color="#51D0ED"/></linearGradient>';
const devBadge = '<circle cx="72" cy="72" r="17" fill="#F5A623" stroke="#173B62" stroke-width="2"/><path fill="#173B62" d="M65 60h7c9 0 14 5 14 12s-5 12-14 12h-7zm7 5h-1v14h1c6 0 8-3 8-7s-2-7-8-7z"/>';

function makeIco(pngs) {
  const header = Buffer.alloc(6 + pngs.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...pngs.map(({ png }) => png)]);
}

// Both source paths are drawn in a 90-unit square (scaled ×11.377778 into a 1024 viewBox).
const MARK_UNITS = 90;

async function readSvg(name) {
  return readFile(path.join(assetsDir, name), 'utf8');
}

function pathData(svg, name) {
  const match = svg.match(/<path[^>]*\sd="([^"]+)"/u);
  if (!match) throw new Error(`No <path d="…"> in ${name}`);
  return match[1];
}

function gradientDef(svg, name) {
  const match = svg.match(/<linearGradient[\s\S]*?<\/linearGradient>/u);
  if (!match) throw new Error(`No <linearGradient> in ${name}`);
  return match[0];
}

/** Places the 90-unit mark `glyphPx` wide, centered in a `canvasPx` square. */
function frame({ canvasPx, glyphPx, defs, body }) {
  const pad = ((canvasPx - glyphPx) / 2) * (MARK_UNITS / glyphPx);
  const box = MARK_UNITS + pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasPx}" height="${canvasPx}" viewBox="${-pad} ${-pad} ${box} ${box}"><defs>${defs}</defs>${body}</svg>`;
}

// macOS app icon grid: an 824-point tile centered in a 1024-point cell, with the system's icon
// shadow (black at 30%, 10 points down, 10 points of blur) inside the margin.
const DOCK_CELL_PX = 1024;
const DOCK_TILE_PX = 824;
const DOCK_SHADOW = { opacity: 0.3, offsetPx: 10, blurPx: 10 };

async function main() {
  const bagSvg = await readSvg('HappierBag.svg');
  const smileSvg = await readSvg('HappierSmile.svg');
  const bag = pathData(bagSvg, 'HappierBag.svg');
  const smile = pathData(smileSvg, 'HappierSmile.svg');

  const knockout = `<mask id="knockout" maskUnits="userSpaceOnUse" x="-10" y="-10" width="110" height="110"><rect x="-10" y="-10" width="110" height="110" fill="#fff"/><path fill="#000" d="${smile}"/></mask>`;
  const silhouette = (fill, canvasPx) => frame({
    canvasPx,
    glyphPx: 32,
    defs: knockout,
    body: `<path fill="${fill}" mask="url(#knockout)" d="${bag}"/>`,
  });
  const template = silhouette('#000', 36);
  const dark = silhouette('#FFF', 32);
  const colour = frame({
    canvasPx: 32,
    glyphPx: 32,
    defs: gradientDef(bagSvg, 'HappierBag.svg'),
    body: `<path fill="url(#g)" d="${bag}"/><path fill="#FFFFFF" d="${smile}"/>`,
  });

  // Shadow lengths are in the mark's 90-unit space, like everything else inside the frame.
  const unitsPerPx = MARK_UNITS / DOCK_TILE_PX;
  const shadow = `<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="${(DOCK_SHADOW.blurPx / 2) * unitsPerPx}"/><feOffset dy="${DOCK_SHADOW.offsetPx * unitsPerPx}" result="blur"/><feFlood flood-color="#000" flood-opacity="${DOCK_SHADOW.opacity}"/><feComposite in2="blur" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  const dock = frame({
    canvasPx: DOCK_CELL_PX,
    glyphPx: DOCK_TILE_PX,
    defs: `${gradientDef(bagSvg, 'HappierBag.svg')}${shadow}`,
    body: `<g filter="url(#shadow)"><path fill="url(#g)" d="${bag}"/><path fill="#FFFFFF" d="${smile}"/></g>`,
  });

  const devBody = `<path fill="url(#g)" d="${bag}"/><path fill="#FFFFFF" d="${smile}"/>${devBadge}`;
  const devIcon = frame({ canvasPx: 1024, glyphPx: 1024, defs: devGradient, body: devBody });
  const devDock = frame({
    canvasPx: DOCK_CELL_PX,
    glyphPx: DOCK_TILE_PX,
    defs: `${devGradient}${shadow}`,
    body: `<g filter="url(#shadow)">${devBody}</g>`,
  });

  const sharp = createRequire(path.join(repoRoot, 'package.json'))('sharp');
  for (const [file, svg] of [
    ['dock/dock-icon.png', dock],
    ['tray/tray-template.png', template],
    ['tray/tray.png', colour],
    ['tray/tray-dark.png', dark],
  ]) {
    const out = path.join(iconsDir, file);
    await mkdir(path.dirname(out), { recursive: true });
    // include_image! needs 8-bit RGBA.
    await sharp(Buffer.from(svg)).ensureAlpha().png({ compressionLevel: 9 }).toFile(out);
    console.log(`wrote ${path.relative(repoRoot, out)}`);
  }

  const devAssets = path.join(devDir, 'AppIcon.icon', 'Assets');
  await mkdir(devAssets, { recursive: true });
  await writeFile(path.join(devAssets, 'HappierBag.svg'), bagSvg.replace(gradientDef(bagSvg, 'HappierBag.svg'), devGradient));
  await writeFile(path.join(devAssets, 'HappierSmile.svg'), smileSvg);
  await writeFile(path.join(devAssets, 'DevBadge.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><g transform="scale(11.377778)">${devBadge}</g></svg>\n`);
  const iconDocument = JSON.parse(await readFile(path.join(iconsDir, 'AppIcon.icon', 'icon.json'), 'utf8'));
  iconDocument.groups.push({ layers: [{ 'glass': false, 'image-name': 'DevBadge.svg', 'name': 'Dev badge', position: { scale: 1, 'translation-in-points': [0, 0] } }] });
  await writeFile(path.join(devDir, 'AppIcon.icon', 'icon.json'), `${JSON.stringify(iconDocument, null, 2)}\n`);

  const devRasters = new Map();
  for (const size of [16, 32, 48, 128, 256, 512, 1024]) {
    devRasters.set(size, await sharp(Buffer.from(devIcon)).resize(size, size).ensureAlpha().png({ compressionLevel: 9 }).toBuffer());
  }
  for (const [file, size] of [['32x32.png', 32], ['128x128.png', 128], ['128x128@2x.png', 256]]) {
    await writeFile(path.join(devDir, file), devRasters.get(size));
  }
  await writeFile(path.join(devDir, 'icon.ico'), makeIco([16, 32, 48, 256].map((size) => ({ size, png: devRasters.get(size) }))));
  await mkdir(path.join(devDir, 'dock'), { recursive: true });
  await sharp(Buffer.from(devDock)).ensureAlpha().png({ compressionLevel: 9 }).toFile(path.join(devDir, 'dock', 'dock-icon.png'));

  if (process.platform === 'darwin') {
    const temporaryDir = await mkdtemp(path.join(os.tmpdir(), 'happier-dev-icon-'));
    const iconset = path.join(temporaryDir, 'Dev.iconset');
    try {
      await mkdir(iconset);
      for (const [name, size] of [
        ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
        ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
        ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
        ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
        ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024],
      ]) {
        const png = devRasters.get(size) ?? await sharp(Buffer.from(devIcon)).resize(size, size).ensureAlpha().png({ compressionLevel: 9 }).toBuffer();
        await writeFile(path.join(iconset, name), png);
      }
      execFileSync('iconutil', ['-c', 'icns', '-o', path.join(devDir, 'icon.icns'), iconset]);
    } finally {
      await rm(temporaryDir, { recursive: true, force: true });
    }
  }
  console.log(`wrote ${path.relative(repoRoot, devDir)} icon variants`);
}

await main();
