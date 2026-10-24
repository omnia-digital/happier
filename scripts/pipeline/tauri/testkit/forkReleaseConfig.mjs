import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../../..');
const sourceDir = join(repoRoot, 'apps/ui/src-tauri');
const syntheticPublicKey = Buffer.from(`untrusted comment: test-only fork updater key\n${Buffer.concat([
  Buffer.from('Ed'), Buffer.alloc(8, 1), Buffer.alloc(32, 2),
]).toString('base64')}\n`).toString('base64');

/** Coherent public config fixture; the synthetic key is not a release signing identity. */
export function writeConfiguredForkTauriFiles(uiDir) {
  const tauriDir = join(uiDir, 'src-tauri');
  mkdirSync(tauriDir, { recursive: true });
  for (const [source, suffix, identifier] of [
    ['tauri.conf.json', 'stable', 'com.example.fork'],
    ['tauri.preview.conf.json', 'preview', 'com.example.fork.preview'],
    ['tauri.publicdev.conf.json', 'dev', 'com.example.fork.dev'],
  ]) {
    const config = JSON.parse(readFileSync(join(sourceDir, source), 'utf8'));
    config.identifier = identifier;
    config.plugins = {
      ...config.plugins,
      updater: {
        ...config.plugins?.updater,
        pubkey: syntheticPublicKey,
        endpoints: [`https://github.com/omnia-digital/happier/releases/download/ui-desktop-${suffix}/latest.json`],
      },
    };
    writeFileSync(join(tauriDir, source), JSON.stringify(config));
  }
  return tauriDir;
}
