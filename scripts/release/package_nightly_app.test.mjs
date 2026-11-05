import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  APP_NAME, BUNDLE_ID, MANIFEST_ASSET, PRODUCT_NAME, SERVER_URL, TARBALL_ASSET, releaseTagForSha, validateManifest,
} from '../fork/nightly-release-contract.mjs';

const script = fileURLToPath(new URL('../fork/package-nightly-app.mjs', import.meta.url));
const sourceSha = 'd'.repeat(40);

// Compiled shapes copied from real Expo exports: `ui-tauri` for the Tauri server URL and the
// disabled updater; `ui` (plain web export) for the empty URLs. `t(void 0)` is what the real
// Babel config produces for the updater when the flag is unset at build time.
const updaterGate = (value) => `function s(){if(!(0,r(d[0]).isTauriDesktop)())return!1;if((0,r(d[1]).isDesktopPetOverlayWindowContext)())return!1;const n=t(${value});return null!==n?n:!0!==globalThis.__DEV__}`;
const serverUrls = (url) => `function n(){return t((0,r(d[0]).readWebRuntimeConfigServerUrl)(),"${url}","${url}","${url}")}`;
// Every export carries this constant, so the bare URL string proves nothing.
const cloudConstant = `const s=_e.HAPPIER_CLOUD_SERVER_URL='${SERVER_URL}';`;

function tool(bin, name, body) {
  const path = join(bin, name);
  writeFileSync(path, `#!/usr/bin/env node\nconst args = process.argv.slice(2);\n${body}\n`);
  chmodSync(path, 0o755);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'package-nightly-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const plist = { CFBundleIdentifier: BUNDLE_ID, CFBundleName: PRODUCT_NAME, CFBundleExecutable: 'omnia', CFBundleShortVersionString: '0.2.18' };
  // macOS developer tools are the system boundary; tar, hashing and validation stay real.
  tool(bin, 'plutil', `console.log(${JSON.stringify(plist)}[args[1]]);`);
  tool(bin, 'lipo', "console.log('arm64');");
  tool(bin, 'codesign', `if (args.includes('-dv')) console.error(process.env.STUB_SIGNATURE ?? 'Signature=adhoc');`);
  tool(bin, 'rustc', "console.log('rustc 1.94.1 (e408947bf 2026-03-25)');");
  tool(bin, 'xcodebuild', "console.log('Xcode 26.5\\nBuild version 17F42');");

  const parent = join(root, 'bundle');
  const app = join(parent, APP_NAME);
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
  writeFileSync(join(app, 'Contents', 'Info.plist'), '<plist/>');
  writeFileSync(join(app, 'Contents', 'MacOS', 'omnia'), 'binary');
  writeFileSync(join(app, 'Contents', 'MacOS', 'hsetup'), 'sidecar');

  const uiExport = join(root, 'dist');
  const web = join(uiExport, '_expo', 'static', 'js', 'web');
  mkdirSync(web, { recursive: true });
  const writeBundle = (gate, urls) => writeFileSync(join(web, 'index-abc.js'), `${cloudConstant}${urls}${gate}`);
  writeBundle(updaterGate('"0"'), serverUrls(SERVER_URL));

  const outDir = join(root, 'out');
  const execute = (overrides = {}, env = {}) => spawnSync(process.execPath, [
    script,
    '--app', overrides.app ?? app,
    '--source-sha', overrides.sourceSha ?? sourceSha,
    '--run-id', overrides.runId ?? '4242',
    '--ui-export', uiExport,
    '--out-dir', outDir,
  ], { encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, ...env } });
  return { root, parent, app, uiExport, web, outDir, writeBundle, execute, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('packaging writes a single-root tarball and a manifest the contract accepts', () => {
  const f = fixture();
  try {
    const result = f.execute();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const tarball = join(f.outDir, TARBALL_ASSET);
    const bytes = readFileSync(tarball);
    const manifest = JSON.parse(readFileSync(join(f.outDir, MANIFEST_ASSET), 'utf8'));
    assert.equal(validateManifest(manifest, releaseTagForSha(sourceSha)), manifest);
    assert.deepEqual(manifest, {
      schema: 1,
      sourceSha,
      workflowRunId: 4242,
      version: '0.2.18',
      bundleId: BUNDLE_ID,
      productName: PRODUCT_NAME,
      serverUrl: SERVER_URL,
      updatesEnabled: false,
      signature: 'adhoc',
      tarball: TARBALL_ASSET,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      rustc: 'rustc 1.94.1',
      xcode: 'Xcode 26.5',
    });
    const listed = spawnSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).stdout.trim().split('\n');
    assert.ok(listed.length > 1);
    assert.deepEqual([...new Set(listed.map((entry) => entry.split('/')[0]))], [APP_NAME]);
  } finally {
    f.cleanup();
  }
});

test('packaging rejects an export the release settings did not reach, and writes nothing', async (t) => {
  const cases = {
    'updater flag unset at build time': [updaterGate('void 0'), serverUrls(SERVER_URL), /updater/i],
    'updater enabled': [updaterGate('"1"'), serverUrls(SERVER_URL), /updater/i],
    'updater gate not found': ['', serverUrls(SERVER_URL), /updater/i],
    'plain web export without a server URL': [updaterGate('"0"'), serverUrls(''), /server URL/i],
    'another server URL': [updaterGate('"0"'), serverUrls('http://127.0.0.1:3005'), /server URL/i],
    'server URL site not found': [updaterGate('"0"'), '', /server URL/i],
  };
  for (const [name, [gate, urls, message]] of Object.entries(cases)) {
    await t.test(name, () => {
      const f = fixture();
      try {
        f.writeBundle(gate, urls);
        const result = f.execute();
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, message);
        assert.equal(existsSync(f.outDir), false);
      } finally {
        f.cleanup();
      }
    });
  }
});

test('packaging rejects a bundle that breaks the release contract', async (t) => {
  await t.test('wrong bundle folder name', () => {
    const f = fixture();
    try {
      const renamed = join(f.parent, 'Other.app');
      cpSync(f.app, renamed, { recursive: true });
      const result = f.execute({ app: renamed });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Other\.app/);
    } finally {
      f.cleanup();
    }
  });
  await t.test('not ad-hoc signed', () => {
    const f = fixture();
    try {
      const result = f.execute({}, { STUB_SIGNATURE: 'Signature size=9000\nAuthority=Developer ID Application' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /ad-hoc/);
    } finally {
      f.cleanup();
    }
  });
  await t.test('run id is not a number', () => {
    const f = fixture();
    try {
      const result = f.execute({ runId: 'latest' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /run id/i);
    } finally {
      f.cleanup();
    }
  });
  await t.test('source SHA is not a full commit', () => {
    const f = fixture();
    try {
      assert.notEqual(f.execute({ sourceSha: 'abc' }).status, 0);
    } finally {
      f.cleanup();
    }
  });
});
