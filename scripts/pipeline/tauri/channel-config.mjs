// @ts-check

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePublicReleaseChannel } from '../release/lib/public-release-rings.mjs';
import { DEFAULT_MINISIGN_PUBLIC_KEY, FIRST_PARTY_RELEASE_REPOSITORY, UPSTREAM_TAURI_UPDATER_PUBLIC_KEY, getMinisignPublicKeyIdentity } from '@happier-dev/release-runtime/minisign';

export const FORK_RELEASE_REPOSITORY = FIRST_PARTY_RELEASE_REPOSITORY;
/**
 * Validate the effective Tauri release config, after the channel overlay. This
 * is source preparation only: Apple registration and ownership of the signing
 * key still require separate external evidence before distribution.
 *
 * @param {{ environment: string; tauriDir?: string; baseConfig?: object; overlayConfig?: object; repository?: string }} options
 */
export function assertForkDesktopReleaseOwnership({ environment, tauriDir = fileURLToPath(new URL('../../../apps/ui/src-tauri', import.meta.url)), baseConfig, overlayConfig, repository }) {
  const channel = normalizePublicReleaseChannel(environment);
  if (!channel) throw new Error(`unsupported Tauri environment: ${environment}`);
  const read = (/** @type {string} */ file) => JSON.parse(fs.readFileSync(path.join(tauriDir, file), 'utf8'));
  const base = baseConfig ?? read('tauri.conf.json');
  const overlay = overlayConfig ?? (channel === 'stable' ? {} : read(resolveTauriChannelConfigFile(channel)));
  const effective = {
    ...base,
    ...overlay,
    plugins: {
      ...base.plugins,
      ...overlay.plugins,
      updater: { ...base.plugins?.updater, ...overlay.plugins?.updater },
    },
  };
  const identity = String(effective.identifier ?? '').trim();
  if (!identity || identity === 'dev.happier.app' || identity.startsWith('dev.happier.app.')) {
    throw new Error(`Fork desktop release ownership is unconfigured: upstream identifier ${identity || '<missing>'} for ${channel}`);
  }
  const suffix = channel === 'stable' ? 'stable' : channel === 'preview' ? 'preview' : 'dev';
  const expectedFeed = `https://github.com/${FORK_RELEASE_REPOSITORY}/releases/download/ui-desktop-${suffix}/latest.json`;
  const endpoints = effective.plugins.updater.endpoints;
  if (!Array.isArray(endpoints) || endpoints.length !== 1 || endpoints[0] !== expectedFeed) {
    throw new Error(`Fork desktop release ownership is unconfigured: expected fork update feed ${expectedFeed}`);
  }
  const pubkey = String(effective.plugins.updater.pubkey ?? '').trim();
  if (!pubkey) {
    throw new Error('Fork desktop release ownership is unconfigured: missing fork updater key');
  }
  let keyIdentity;
  try {
    keyIdentity = getMinisignPublicKeyIdentity(Buffer.from(pubkey, 'base64').toString('utf8'));
  } catch {
    throw new Error('Fork desktop release ownership is unconfigured: updater key is not an encoded minisign public key');
  }
  if ([UPSTREAM_TAURI_UPDATER_PUBLIC_KEY, DEFAULT_MINISIGN_PUBLIC_KEY]
    .some((upstreamKey) => keyIdentity === getMinisignPublicKeyIdentity(upstreamKey))) {
    throw new Error('Fork desktop release ownership is unconfigured: upstream updater key cannot verify fork releases');
  }
  if (repository && repository !== FORK_RELEASE_REPOSITORY) {
    throw new Error(`Fork desktop release ownership is unconfigured: release repository ${repository} differs from ${FORK_RELEASE_REPOSITORY}`);
  }
  return { channel, identifier: identity, updateFeed: expectedFeed, updaterPublicKey: pubkey };
}

/** @param {string} environment */
export function resolveTauriChannelConfigFile(environment) {
  const channel = normalizePublicReleaseChannel(environment);
  if (!channel) throw new Error(`unsupported Tauri environment: ${environment}`);
  if (channel === 'stable') return 'tauri.conf.json';
  return channel === 'publicdev' ? 'tauri.publicdev.conf.json' : 'tauri.preview.conf.json';
}

/** @param {{ environment: string; tauriDir?: string }} options */
export function readTauriMainBinaryName({ environment, tauriDir = fileURLToPath(new URL('../../../apps/ui/src-tauri', import.meta.url)) }) {
  const configFile = resolveTauriChannelConfigFile(environment);
  const read = (/** @type {string} */ file) => JSON.parse(fs.readFileSync(path.join(tauriDir, file), 'utf8'));
  const name = read(configFile).mainBinaryName ?? read('tauri.conf.json').mainBinaryName;
  if (typeof name !== 'string' || !name.trim()) throw new Error(`no mainBinaryName configured for ${environment}`);
  return name;
}
