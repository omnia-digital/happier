import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveDockerReleaseArtifactInputs,
  dockerReleaseArtifactInputsToBuildArgs,
} from './resolve-release-artifact-build-args.mjs';

const forkPublicKey = `untrusted comment: test-only fork release key\n${Buffer.concat([
  Buffer.from('Ed'), Buffer.alloc(8, 3), Buffer.alloc(32, 4),
]).toString('base64')}\n`;

test('publishing Docker images rejects moving rolling artifact inference', async () => {
  await assert.rejects(
    resolveDockerReleaseArtifactInputs({
      channel: 'preview',
      repoRoot: process.cwd(),
      dryRun: false,
      env: {},
      fetchGitHubReleaseByTag: async () => {
        throw new Error('unexpected GitHub lookup');
      },
    }),
    /HAPPIER_DOCKER_SERVER_VERSION/,
  );
});

test('uses explicit Docker artifact version overrides without GitHub lookups', async () => {
  let fetched = false;
  const inputs = await resolveDockerReleaseArtifactInputs({
    channel: 'dev',
    repoRoot: process.cwd(),
    dryRun: false,
    env: {
      HAPPIER_DOCKER_SERVER_VERSION: '1.0.0-dev.1',
      HAPPIER_DOCKER_CLI_VERSION: '1.0.0-dev.3',
      HAPPIER_DOCKER_RELEASE_BASE_URL: 'https://releases.example.test/download',
      HAPPIER_MINISIGN_PUBKEY: forkPublicKey,
    },
    fetchGitHubReleaseByTag: async () => {
      fetched = true;
      throw new Error('unexpected fetch');
    },
  });

  assert.equal(fetched, false);
  assert.equal(inputs.releaseBaseUrl, 'https://releases.example.test/download');
  assert.deepEqual(inputs.relay.server, { releaseTag: 'server-v1.0.0-dev.1', version: '1.0.0-dev.1' });
  assert.deepEqual(inputs.devBox.cli, { releaseTag: 'cli-v1.0.0-dev.3', version: '1.0.0-dev.3' });
});

test('Docker publication uses the fork feed and distinct verifier, refusing unconfigured trust', async () => {
  const params = {
    channel: 'dev',
    repoRoot: process.cwd(),
    dryRun: true,
  };
  await assert.rejects(resolveDockerReleaseArtifactInputs({ ...params, env: {} }), /minisign public key is required/i);
  const inputs = await resolveDockerReleaseArtifactInputs({
    ...params,
    env: { HAPPIER_MINISIGN_PUBKEY: forkPublicKey },
  });
  assert.equal(inputs.releaseBaseUrl, 'https://github.com/omnia-digital/happier/releases/download');
  const buildArgs = dockerReleaseArtifactInputsToBuildArgs(inputs, 'dev-box');
  assert.ok(buildArgs.includes(`HAPPIER_RELEASE_PUBLIC_KEY_BASE64=${Buffer.from(forkPublicKey.trim()).toString('base64')}`));
  assert.ok(buildArgs.includes(`HAPPIER_RELEASE_BASE_URL=${inputs.releaseBaseUrl}`));
});

test('requires the exact CLI version when publishing only the dev-box image', async () => {
  await assert.rejects(
    resolveDockerReleaseArtifactInputs({
      channel: 'preview',
      repoRoot: process.cwd(),
      dryRun: false,
      includeRelay: false,
      env: {},
    }),
    /HAPPIER_DOCKER_CLI_VERSION/,
  );
});
