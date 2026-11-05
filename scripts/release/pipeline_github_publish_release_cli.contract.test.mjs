import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

test('pipeline CLI can publish GitHub release in dry-run without GH_TOKEN (uses local gh auth)', async () => {
  const out = execFileSync(
    process.execPath,
    [
      resolve(repoRoot, 'scripts', 'pipeline', 'run.mjs'),
      'github-publish-release',
      '--tag',
      'cli-preview',
      '--title',
      'Happier CLI Preview',
      '--target-sha',
      '0123456789abcdef0123456789abcdef01234567',
      '--prerelease',
      'true',
      '--rolling-tag',
      'true',
      '--generate-notes',
      'false',
      '--notes',
      'Rolling preview build.',
      '--dry-run',
      '--secrets-source',
      'env',
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, GH_TOKEN: '', GH_REPO: '', GITHUB_REPOSITORY: '' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    },
  );

  assert.match(out, /\[pipeline\] github release: tag=cli-preview/);
  assert.match(out, /\[dry-run\] gh release view cli-preview/);
});

test('pipeline CLI forwards the immutable nightly publication options', () => {
  const out = execFileSync(
    process.execPath,
    [
      resolve(repoRoot, 'scripts', 'pipeline', 'run.mjs'),
      'github-publish-release',
      '--tag', 'omnia-nightly-0123456789ab',
      '--title', 'Omnia Happier nightly',
      '--target-sha', '0123456789abcdef0123456789abcdef01234567',
      '--prerelease', 'false',
      '--rolling-tag', 'false',
      '--generate-notes', 'false',
      '--notes', 'Nightly build.',
      '--assets', '/tmp/a.tar.gz\n/tmp/a.json',
      '--clobber', 'false',
      '--prune-assets', 'false',
      '--latest', 'true',
      '--replace-draft', 'true',
      '--dry-run',
      '--secrets-source', 'env',
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, GH_TOKEN: '', GH_REPO: 'test/test', GITHUB_REPOSITORY: '' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    },
  );

  assert.match(out, /\[dry-run\] gh release edit omnia-nightly-0123456789ab --repo test\/test --draft=false --latest/);
  assert.match(out, /"--replace-draft" "true"/);
});

