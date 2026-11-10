import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  APP_NAME,
  BUNDLE_ID,
  MANIFEST_ASSET,
  PRODUCT_NAME,
  RELEASE_AUTHOR,
  SERVER_URL,
  TARBALL_ASSET,
  bundleExecutablePath,
  isPublishedNightlyRelease,
  isTrustedNightlyRelease,
  releaseTagForSha,
  validateManifest,
  verifyAppBundle,
  verifyTarballLayout,
} from '../fork/nightly-release-contract.mjs';

const sha = 'a'.repeat(40);
const tag = `autopilot-nightly-${'a'.repeat(12)}`;
const skip = process.platform !== 'darwin';

const manifest = (overrides = {}) => ({
  schema: 1,
  sourceSha: sha,
  workflowRunId: 123,
  version: '0.2.18',
  bundleId: BUNDLE_ID,
  productName: PRODUCT_NAME,
  serverUrl: SERVER_URL,
  updatesEnabled: false,
  signature: 'adhoc',
  tarball: TARBALL_ASSET,
  size: 1,
  sha256: 'b'.repeat(64),
  rustc: 'rustc 1.0.0',
  xcode: 'Xcode 26.5',
  ...overrides,
});

const release = (overrides = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  immutable: true,
  author: { login: RELEASE_AUTHOR },
  assets: [{ name: TARBALL_ASSET }, { name: MANIFEST_ASSET }],
  ...overrides,
});

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function tempDir(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nightly-contract-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function arm64MachO() {
  for (const candidate of ['/opt/homebrew/bin/node', process.execPath]) {
    const archs = spawnSync('lipo', ['-archs', candidate], { encoding: 'utf8' });
    if (archs.status === 0 && archs.stdout.trim().split(/\s+/).includes('arm64')) return candidate;
  }
  throw new Error('No arm64 Mach-O available for the bundle fixture');
}

function makeBundle(appPath, { bundleId = BUNDLE_ID, productName = PRODUCT_NAME, executable = arm64MachO(), sidecar = true } = {}) {
  mkdirSync(join(appPath, 'Contents', 'MacOS'), { recursive: true });
  mkdirSync(join(appPath, 'Contents', 'Resources'), { recursive: true });
  const binaries = sidecar ? ['happier-desktop', 'hsetup'] : ['happier-desktop'];
  for (const name of binaries) {
    copyFileSync(executable, join(appPath, 'Contents', 'MacOS', name));
    chmodSync(join(appPath, 'Contents', 'MacOS', name), 0o755);
  }
  writeFileSync(join(appPath, 'Contents', 'Resources', 'marker'), 'fixture');
  writeFileSync(join(appPath, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>happier-desktop</string>
<key>CFBundleIdentifier</key><string>${bundleId}</string>
<key>CFBundleName</key><string>${productName}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.2.18</string>
</dict></plist>
`);
  run('codesign', ['--force', '--deep', '--sign', '-', appPath]);
  return appPath;
}

test('releaseTagForSha derives the immutable per-SHA tag and rejects anything but a full SHA', () => {
  assert.equal(releaseTagForSha(sha), tag);
  for (const bad of ['abc', 'A'.repeat(40), `${sha}0`, undefined]) assert.throws(() => releaseTagForSha(bad), /Invalid source SHA/);
});

test('isPublishedNightlyRelease requires a finished nightly tag with both assets', () => {
  assert.equal(isPublishedNightlyRelease(release()), true);
  assert.equal(isPublishedNightlyRelease(null), false);
  assert.equal(isPublishedNightlyRelease(release({ draft: true })), false);
  assert.equal(isPublishedNightlyRelease(release({ prerelease: true })), false);
  assert.equal(isPublishedNightlyRelease(release({ tag_name: 'v0.2.18' })), false);
  assert.equal(isPublishedNightlyRelease(release({ assets: [{ name: TARBALL_ASSET }] })), false);
  assert.equal(isPublishedNightlyRelease(release({ assets: [{ name: MANIFEST_ASSET }] })), false);
});

test('isTrustedNightlyRelease also requires immutability and the workflow author', () => {
  assert.equal(isTrustedNightlyRelease(release()), true);
  assert.equal(isTrustedNightlyRelease(release({ immutable: false })), false);
  assert.equal(isTrustedNightlyRelease(release({ immutable: undefined })), false);
  assert.equal(isTrustedNightlyRelease(release({ author: { login: 'andorcassian' } })), false);
  assert.equal(isTrustedNightlyRelease(release({ author: undefined })), false);
  assert.equal(isTrustedNightlyRelease(release({ draft: true })), false);
});

test('validateManifest accepts the contract and names the first violation', () => {
  assert.equal(validateManifest(manifest(), tag).sourceSha, sha);
  assert.equal(validateManifest(manifest()).sourceSha, sha);
  const violations = [
    [{ schema: 2 }, /schema/],
    [{ sourceSha: 'abc' }, /sourceSha/],
    [{ sourceSha: 'c'.repeat(40) }, /does not belong/],
    [{ bundleId: 'com.other' }, /bundleId/],
    [{ productName: 'Happier' }, /productName/],
    [{ serverUrl: 'https://example.invalid' }, /serverUrl/],
    [{ updatesEnabled: true }, /updatesEnabled/],
    [{ signature: 'developer-id' }, /signature/],
    [{ tarball: 'other.tar.gz' }, /tarball/],
    [{ size: 0 }, /size/],
    [{ size: '1' }, /size/],
    [{ sha256: 'short' }, /sha256/],
  ];
  for (const [overrides, pattern] of violations) assert.throws(() => validateManifest(manifest(overrides), tag), pattern);
  assert.throws(() => validateManifest(null, tag), /schema/);
});

test('verifyAppBundle accepts a real ad-hoc signed arm64 bundle', { skip }, (t) => {
  const app = makeBundle(join(tempDir(t), APP_NAME));
  const verified = verifyAppBundle(app);
  assert.equal(verified.bundleId, BUNDLE_ID);
  assert.equal(verified.productName, PRODUCT_NAME);
  assert.equal(verified.version, '0.2.18');
  assert.equal(verified.executable, bundleExecutablePath(app));
  assert.equal(verified.executable, join(app, 'Contents', 'MacOS', 'happier-desktop'));
});

test('verifyAppBundle detects tampering after signing', { skip }, (t) => {
  const root = tempDir(t);
  const app = makeBundle(join(root, APP_NAME));
  appendFileSync(join(app, 'Contents', 'Resources', 'marker'), 'tampered');
  assert.throws(() => verifyAppBundle(app), /signature/i);

  const added = makeBundle(join(root, 'added', APP_NAME));
  writeFileSync(join(added, 'Contents', 'Resources', 'injected'), 'extra');
  assert.throws(() => verifyAppBundle(added), /signature/i);
});

test('verifyAppBundle rejects wrong identity, a missing sidecar, a missing executable and non-arm64 code', { skip }, (t) => {
  const root = tempDir(t);
  assert.throws(() => verifyAppBundle(makeBundle(join(root, 'id', APP_NAME), { bundleId: 'com.happier.other' })), /identifier/);
  assert.throws(() => verifyAppBundle(makeBundle(join(root, 'name', APP_NAME), { productName: 'Happier' })), /name/);
  assert.throws(() => verifyAppBundle(makeBundle(join(root, 'sidecar', APP_NAME), { sidecar: false })), /hsetup/);

  const noExecutable = makeBundle(join(root, 'exe', APP_NAME));
  rmSync(join(noExecutable, 'Contents', 'MacOS', 'happier-desktop'));
  assert.throws(() => verifyAppBundle(noExecutable), /executable/);

  const x86 = join(root, 'x86-binary');
  run('lipo', ['-thin', 'x86_64', '/usr/bin/true', '-output', x86]);
  assert.throws(() => verifyAppBundle(makeBundle(join(root, 'x86', APP_NAME), { executable: x86 })), /arm64/);

  assert.throws(() => verifyAppBundle(join(root, 'nothing')), /Not an app bundle/);
});

test('verifyAppBundle refuses a symlink standing in for the bundle', { skip }, (t) => {
  const root = tempDir(t);
  const real = makeBundle(join(root, 'real', APP_NAME));
  const link = join(root, APP_NAME);
  symlinkSync(real, link);
  assert.throws(() => verifyAppBundle(link), /Not an app bundle/);
});

test('verifyTarballLayout requires the app bundle as the only root entry', { skip }, (t) => {
  const root = tempDir(t);
  const contents = join(root, 'contents');
  mkdirSync(join(contents, APP_NAME, 'Contents'), { recursive: true });
  writeFileSync(join(contents, APP_NAME, 'Contents', 'file'), 'x');
  writeFileSync(join(contents, 'stray'), 'x');
  const tarball = (name, ...entries) => {
    const path = join(root, name);
    run('tar', ['-czf', path, '-C', contents, ...entries], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
    return path;
  };
  assert.doesNotThrow(() => verifyTarballLayout(tarball('good.tar.gz', APP_NAME)));
  assert.throws(() => verifyTarballLayout(tarball('multi.tar.gz', APP_NAME, 'stray')), /root/);
  assert.throws(() => verifyTarballLayout(tarball('dotted.tar.gz', `./${APP_NAME}`)), /root/);
  assert.throws(() => verifyTarballLayout(tarball('other.tar.gz', 'stray')), /root/);
  const escaping = join(root, 'escaping.tar.gz');
  run('tar', ['-czf', escaping, '-C', contents, '-s', `|^stray$|${APP_NAME}/../stray|`, APP_NAME, 'stray'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  assert.throws(() => verifyTarballLayout(escaping), /root/);
  writeFileSync(join(root, 'garbage.tar.gz'), 'not a tarball');
  assert.throws(() => verifyTarballLayout(join(root, 'garbage.tar.gz')), /tarball/i);
});
