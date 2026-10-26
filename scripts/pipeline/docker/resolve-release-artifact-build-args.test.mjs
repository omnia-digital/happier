import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveDockerReleaseArtifactInputs,
} from './resolve-release-artifact-build-args.mjs';

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
