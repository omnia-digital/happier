import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const uiRoot = resolve(repoRoot, 'apps/ui');
const require = createRequire(resolve(uiRoot, 'package.json'));
const { transformFileSync } = require('@babel/core');
const updateChecksEnv = 'EXPO_PUBLIC_HAPPIER_DESKTOP_UPDATES_ENABLED';

test('desktop updater opt-out is embedded in the production Expo bundle', () => {
  const previous = process.env[updateChecksEnv];
  const compile = (enabled) => {
    process.env[updateChecksEnv] = enabled;
    const result = transformFileSync(resolve(uiRoot, 'sources/desktop/updates/desktopUpdater.ts'), {
      cwd: uiRoot,
      configFile: resolve(uiRoot, 'babel.config.js'),
      envName: 'production',
      caller: {
        name: 'metro',
        bundler: 'metro',
        platform: 'web',
        isDev: false,
        isServer: false,
        supportsStaticESM: true,
      },
    });
    assert.ok(result?.code, 'Expo must compile the real desktop updater');
    return result.code;
  };

  try {
    const disabledBundle = compile('0');
    const enabledBundle = compile('1');
    assert.ok(disabledBundle !== enabledBundle, 'the build-time setting must change the shipped bundle');
    for (const bundle of [disabledBundle, enabledBundle]) {
      assert.ok(!bundle.includes(updateChecksEnv), 'the webview must not need a runtime environment variable');
    }
  } finally {
    if (previous === undefined) delete process.env[updateChecksEnv];
    else process.env[updateChecksEnv] = previous;
  }
});
