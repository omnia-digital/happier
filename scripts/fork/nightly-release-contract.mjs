import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

// The single definition of an Autopilot nightly release, shared by the CI packager,
// the CI change gate and the Mac update agent.
export const APP_NAME = 'Autopilot.app';
export const BUNDLE_ID = 'com.omnia.autopilot';
export const PRODUCT_NAME = 'Autopilot';
export const SERVER_URL = 'https://api.happier.dev';
export const TARBALL_ASSET = 'autopilot-macos-arm64.tar.gz';
export const MANIFEST_ASSET = 'autopilot-macos-arm64.json';
export const RELEASE_AUTHOR = 'github-actions[bot]';

const fullSha = /^[0-9a-f]{40}$/;
const sha256Hex = /^[0-9a-f]{64}$/;
const tagPattern = /^autopilot-nightly-[0-9a-f]{12}$/;

export function releaseTagForSha(sha) {
  if (!fullSha.test(String(sha))) throw new Error(`Invalid source SHA: ${sha}`);
  return `autopilot-nightly-${sha.slice(0, 12)}`;
}

/** True when a GitHub release object is a finished nightly carrying both assets. */
export function isPublishedNightlyRelease(release) {
  if (!release || release.draft || release.prerelease) return false;
  if (!tagPattern.test(String(release.tag_name))) return false;
  const names = new Set((release.assets ?? []).map((asset) => asset.name));
  return names.has(TARBALL_ASSET) && names.has(MANIFEST_ASSET);
}

/** True when a published nightly also has the provenance the Mac agent requires before reading its assets. */
export function isTrustedNightlyRelease(release) {
  return isPublishedNightlyRelease(release) && release.immutable === true && release.author?.login === RELEASE_AUTHOR;
}

/** Returns the validated manifest, or throws describing the first violation. */
export function validateManifest(manifest, expectedTag) {
  const fail = (message) => { throw new Error(`Invalid nightly manifest: ${message}`); };
  if (manifest?.schema !== 1) fail(`unsupported schema ${manifest?.schema}`);
  if (!fullSha.test(String(manifest.sourceSha))) fail('sourceSha must be a full commit SHA');
  if (expectedTag !== undefined && releaseTagForSha(manifest.sourceSha) !== expectedTag) {
    fail(`sourceSha ${manifest.sourceSha} does not belong to tag ${expectedTag}`);
  }
  if (manifest.bundleId !== BUNDLE_ID) fail(`bundleId ${manifest.bundleId}`);
  if (manifest.productName !== PRODUCT_NAME) fail(`productName ${manifest.productName}`);
  if (manifest.serverUrl !== SERVER_URL) fail(`serverUrl ${manifest.serverUrl}`);
  if (manifest.updatesEnabled !== false) fail('updatesEnabled must be false');
  if (manifest.signature !== 'adhoc') fail(`signature ${manifest.signature}`);
  if (manifest.tarball !== TARBALL_ASSET) fail(`tarball ${manifest.tarball}`);
  if (!Number.isSafeInteger(manifest.size) || manifest.size <= 0) fail('size must be a positive integer');
  if (!sha256Hex.test(String(manifest.sha256))) fail('sha256 must be 64 hex characters');
  return manifest;
}

function tool(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  return { ok: result.status === 0, out: (result.stdout ?? '').trim(), err: (result.stderr ?? '').trim() };
}

function plistValue(plist, key) {
  const value = tool('plutil', ['-extract', key, 'raw', '-o', '-', plist]);
  if (!value.ok) throw new Error(`Bundle Info.plist has no ${key}: ${value.err}`);
  return value.out;
}

/** The absolute path of the bundle's main executable, as `ps` reports it for the running app. */
export function bundleExecutablePath(appPath) {
  return join(appPath, 'Contents', 'MacOS', plistValue(join(appPath, 'Contents', 'Info.plist'), 'CFBundleExecutable'));
}

/** Throws unless every tarball entry sits under the app bundle, its one and only root. */
export function verifyTarballLayout(tarballPath) {
  const listing = tool('tar', ['-tzf', tarballPath]);
  if (!listing.ok) throw new Error(`Not a readable tarball: ${listing.err}`);
  for (const entry of listing.out.split('\n')) {
    const segments = entry.split('/');
    if (segments[0] !== APP_NAME || segments.includes('..')) throw new Error(`Tarball entry ${entry} is outside the single root ${APP_NAME}`);
  }
}

/** Throws unless the bundle is a strictly valid arm64 Autopilot app. */
export function verifyAppBundle(appPath) {
  const plist = join(appPath, 'Contents', 'Info.plist');
  // A symlink root would verify its target but install only a pointer to it.
  if (!existsSync(plist) || !lstatSync(appPath).isDirectory()) throw new Error(`Not an app bundle: ${appPath}`);
  const bundleId = plistValue(plist, 'CFBundleIdentifier');
  if (bundleId !== BUNDLE_ID) throw new Error(`Bundle identifier is ${bundleId}, expected ${BUNDLE_ID}`);
  const productName = plistValue(plist, 'CFBundleName');
  if (productName !== PRODUCT_NAME) throw new Error(`Bundle name is ${productName}, expected ${PRODUCT_NAME}`);
  const executable = bundleExecutablePath(appPath);
  if (!existsSync(executable)) throw new Error(`Bundle executable is missing: ${executable}`);
  if (!existsSync(join(appPath, 'Contents', 'MacOS', 'hsetup'))) throw new Error('Bundle sidecar hsetup is missing');
  const archs = tool('lipo', ['-archs', executable]);
  if (!archs.ok || !archs.out.split(/\s+/).includes('arm64')) throw new Error(`Bundle executable is not arm64: ${archs.out || archs.err}`);
  const signature = tool('codesign', ['--verify', '--deep', '--strict', appPath]);
  if (!signature.ok) throw new Error(`Bundle signature failed verification: ${signature.err}`);
  return { bundleId, productName, version: plistValue(plist, 'CFBundleShortVersionString'), executable };
}
