import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../../..');
const tauriDir = join(repoRoot, 'apps/ui/src-tauri');
const read = (name) => JSON.parse(readFileSync(join(tauriDir, name), 'utf8'));
const upstreamBase = read('tauri.conf.json');
const upstreamDev = read('tauri.publicdev.conf.json');

const forkKeyText = `untrusted comment: minisign public key for test only\n${Buffer.concat([
  Buffer.from('Ed'), Buffer.alloc(8, 1), Buffer.alloc(32, 2),
]).toString('base64')}\n`;
const forkKey = Buffer.from(forkKeyText).toString('base64');

function configured(channel = 'publicdev') {
  return {
    baseConfig: { ...upstreamBase, identifier: 'com.example.fork', plugins: { ...upstreamBase.plugins, updater: {
      pubkey: forkKey,
      endpoints: ['https://github.com/omnia-digital/happier/releases/download/ui-desktop-stable/latest.json'],
    } } },
    overlayConfig: channel === 'stable' ? {} : { ...upstreamDev, identifier: 'com.example.fork.dev', plugins: {
      ...upstreamDev.plugins, updater: {
        pubkey: forkKey,
        endpoints: [`https://github.com/omnia-digital/happier/releases/download/ui-desktop-${channel === 'preview' ? 'preview' : 'dev'}/latest.json`],
      },
    } },
    environment: channel,
  };
}

test('release builder fails before frontend or sidecar preparation when ownership is unconfigured', () => {
  const temp = mkdtempSync(join(tmpdir(), 'fork-desktop-release-'));
  try {
    const result = spawnSync(process.execPath, [join(repoRoot, 'scripts/pipeline/tauri/build-updater-artifacts.mjs'),
      '--environment', 'publicdev', '--build-version', '0.2.18-dev.1', '--ui-dir', 'apps/ui', '--dry-run'], {
      cwd: repoRoot, encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: temp },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /fork desktop release ownership/i);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('direct Tauri build entry point refuses an unconfigured fork release', () => {
  const result = spawnSync(process.execPath, [join(repoRoot, 'apps/ui/scripts/runTauriCli.mjs'),
    'build', '--config', 'src-tauri/tauri.publicdev.conf.json'], {
    cwd: join(repoRoot, 'apps/ui'), encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /fork desktop release ownership/i);
});

test('desktop manifest preparation refuses an upstream release repository', () => {
  const result = spawnSync(process.execPath, [join(repoRoot, 'scripts/pipeline/tauri/prepare-publish-assets.mjs'),
    '--environment', 'publicdev', '--ui-version', '0.2.18', '--repo', 'happier-dev/happier', '--dry-run'], {
    cwd: repoRoot, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /fork desktop release ownership/i);
});

test('fork release preparation rejects the current upstream desktop identity, feed and trust', async () => {
  const { assertForkDesktopReleaseOwnership } = await import('./channel-config.mjs');
  for (const environment of ['stable', 'preview', 'publicdev']) {
    assert.throws(() => assertForkDesktopReleaseOwnership({ environment, tauriDir }), /fork desktop release ownership/i);
  }
});

test('configured fork channel must keep identity, feed and trust together', async () => {
  const { assertForkDesktopReleaseOwnership } = await import('./channel-config.mjs');
  const source = configured();
  assert.doesNotThrow(() => assertForkDesktopReleaseOwnership(source));
  assert.throws(() => assertForkDesktopReleaseOwnership({ ...source, overlayConfig: {
    ...source.overlayConfig, plugins: { updater: { ...source.overlayConfig.plugins.updater, pubkey: upstreamDev.plugins.updater.pubkey } },
  } }), /upstream updater key/i);
  const upstreamWithEditedComment = Buffer.from(
    Buffer.from(upstreamDev.plugins.updater.pubkey, 'base64').toString('utf8').replace('minisign public key: ', 'minisign public key: fork '),
  ).toString('base64');
  assert.throws(() => assertForkDesktopReleaseOwnership({ ...source, overlayConfig: {
    ...source.overlayConfig, plugins: { updater: { ...source.overlayConfig.plugins.updater, pubkey: upstreamWithEditedComment } },
  } }), /upstream updater key/i);
  assert.throws(() => assertForkDesktopReleaseOwnership({ ...source, overlayConfig: {
    ...source.overlayConfig, plugins: { updater: { ...source.overlayConfig.plugins.updater, endpoints: upstreamDev.plugins.updater.endpoints } },
  } }), /fork update feed/i);
  assert.throws(() => assertForkDesktopReleaseOwnership({ ...source, overlayConfig: {
    ...source.overlayConfig, identifier: upstreamDev.identifier,
  } }), /upstream identifier/i);
});

