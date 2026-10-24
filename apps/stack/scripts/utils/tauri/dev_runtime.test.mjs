import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildStackTauriBundleConfig, buildStackTauriDevConfig, resolveStackTauriDevUrl } from './dev_runtime.mjs';

test('stack desktop dev and bundled builds consume the same dev artwork and macOS display metadata', async () => {
  const baseConfig = JSON.parse(await readFile(new URL('../../../../ui/src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const overlayConfig = JSON.parse(await readFile(new URL('../../../../ui/src-tauri/tauri.publicdev.conf.json', import.meta.url), 'utf8'));
  const env = { HAPPIER_STACK_STACK: 'qa' };
  const dev = buildStackTauriDevConfig({ baseConfig, overlayConfig, devUrl: 'http://localhost:18081', env });
  const bundle = buildStackTauriBundleConfig({ baseConfig, overlayConfig, frontendDist: '../dist', env });

  for (const config of [dev, bundle]) {
    assert.equal(config.identifier, 'com.happier.stack.qa');
    assert.equal(config.bundle.macOS.infoPlist, 'Info.dev.plist');
    assert.deepEqual(config.bundle.icon, overlayConfig.bundle.icon);
    assert.equal(config.app.windows[0].title, config.productName);
  }
  assert.equal(dev.productName, '(Dev) Omnia - Happier');
  assert.equal(bundle.productName, '(Dev) Omnia - Happier (qa)');
  assert.equal(bundle.build.frontendDist, '../dist');
  assert.equal(bundle.build.beforeBuildCommand, null);
  const plist = await readFile(new URL('../../../../ui/src-tauri/Info.dev.plist', import.meta.url), 'utf8');
  assert.match(plist, /<key>CFBundleDisplayName<\/key>\s*<string>\(Dev\) Omnia - Happier<\/string>/);
});

test('an explicit production bundle keeps stable Tauri assets and isolated stack identity', async () => {
  const baseConfig = JSON.parse(await readFile(new URL('../../../../ui/src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const overlayConfig = JSON.parse(await readFile(new URL('../../../../ui/src-tauri/tauri.publicdev.conf.json', import.meta.url), 'utf8'));
  const config = buildStackTauriBundleConfig({
    baseConfig,
    overlayConfig,
    variant: 'production',
    frontendDist: '../dist',
    env: {
      HAPPIER_STACK_STACK: 'omnia-production-desktop',
      HAPPIER_STACK_TAURI_IDENTIFIER: 'com.omnia.happier.production',
      HAPPIER_STACK_TAURI_PRODUCT_NAME: 'Omnia Happier',
    },
  });

  assert.equal(config.identifier, 'com.omnia.happier.production');
  assert.equal(config.productName, 'Omnia Happier');
  assert.equal(config.app.windows[0].title, 'Omnia Happier');
  assert.equal(config.mainBinaryName, baseConfig.mainBinaryName);
  assert.equal(config.bundle.macOS.infoPlist, undefined);
  assert.deepEqual(config.bundle.icon, baseConfig.bundle.icon);
  assert.deepEqual(config.plugins['deep-link'], baseConfig.plugins['deep-link']);
  assert.deepEqual(config.plugins.updater, baseConfig.plugins.updater);
});

test('resolveStackTauriDevUrl prefers the stack expo web port', () => {
  assert.equal(
    resolveStackTauriDevUrl({
      runtimeState: {
        expo: { webPort: 19364 },
      },
    }),
    'http://localhost:19364',
  );
});

test('resolveStackTauriDevUrl falls back to the default Metro port', () => {
  assert.equal(resolveStackTauriDevUrl({ runtimeState: null }), 'http://localhost:8081');
});

test('buildStackTauriDevConfig disables beforeDevCommand and points Tauri at the existing dev server', () => {
  const config = buildStackTauriDevConfig({
    baseConfig: {
      productName: 'Happier',
      identifier: 'dev.happier.app',
      build: {
        devUrl: 'http://localhost:8081',
        beforeDevCommand: 'yarn -s tauri:prepare:dev',
      },
      bundle: {
        externalBin: ['binaries/hsetup'],
      },
      app: {
        windows: [{ title: 'Happier', dragDropEnabled: false }],
      },
    },
    overlayConfig: {
      productName: 'Happier (dev)',
      identifier: 'dev.happier.app.publicdev',
      app: {
        windows: [{ title: 'Happier (dev)' }],
      },
    },
    devUrl: 'http://localhost:19364',
    env: {},
  });

  assert.equal(config.productName, 'Happier (dev)');
  assert.equal(config.identifier, 'dev.happier.app.publicdev');
  assert.equal(config.build.devUrl, 'http://localhost:19364');
  assert.equal(config.build.beforeDevCommand, '');
  assert.equal(config.build.beforeBuildCommand, '');
  assert.deepEqual(config.bundle.externalBin, ['binaries/hsetup']);
  assert.equal(config.app.windows[0]?.title, 'Happier (dev)');
  assert.equal(config.app.windows[0]?.dragDropEnabled, false);
});

test('buildStackTauriDevConfig applies explicit stack overrides after merging configs', () => {
  const config = buildStackTauriDevConfig({
    baseConfig: {
      productName: 'Happier',
      identifier: 'dev.happier.app',
      build: {},
      app: { windows: [{ title: 'Happier' }] },
    },
    overlayConfig: {
      productName: 'Happier (dev)',
      identifier: 'dev.happier.app.publicdev',
    },
    devUrl: 'http://localhost:18081',
    env: {
      HAPPIER_STACK_TAURI_PRODUCT_NAME: 'Happier (stack exp1)',
      HAPPIER_STACK_TAURI_IDENTIFIER: 'com.happier.stack.exp1',
    },
  });

  assert.equal(config.productName, 'Happier (stack exp1)');
  assert.equal(config.identifier, 'com.happier.stack.exp1');
  assert.equal(config.app.windows[0]?.title, 'Happier (stack exp1)');
});
