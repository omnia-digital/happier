import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';

function workflow(name) {
  return YAML.parse(readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8'));
}

test('Cassian admission accepts only the fork nightly exact dev source and unsigned preparation', () => {
  const desktop = workflow('build-tauri.yml');
  const admission = desktop.jobs.trusted_ref_guard.steps.find((step) => step.id === 'admit_cassian');
  assert.ok(admission, 'persistent Cassian builds require admission before runner allocation');
  assert.deepEqual(admission.env, {
    CASSIAN_BUILD: '${{ inputs.cassian_build }}',
    CALLER_WORKFLOW_REF: '${{ github.workflow_ref }}',
    SOURCE_REF: '${{ inputs.source_ref }}',
    PREPARATION_ONLY: '${{ inputs.preparation_only }}',
  });
  const admitted = {
    CASSIAN_BUILD: 'true',
    CALLER_WORKFLOW_REF: 'omnia-digital/happier/.github/workflows/omnia-production.yml@refs/heads/dev',
    GITHUB_REPOSITORY: 'omnia-digital/happier',
    GITHUB_REF: 'refs/heads/dev',
    GITHUB_SHA: 'a'.repeat(40),
    GITHUB_EVENT_NAME: 'schedule',
    SOURCE_REF: 'a'.repeat(40),
    PREPARATION_ONLY: 'true',
  };
  const run = (overrides) => spawnSync('bash', ['-c', admission.run], {
    env: { PATH: process.env.PATH, ...admitted, ...overrides }, encoding: 'utf8',
  });
  for (const event of ['schedule', 'workflow_dispatch']) {
    const result = run({ GITHUB_EVENT_NAME: event });
    assert.equal(result.status, 0, result.stderr);
  }
  for (const override of [
    { GITHUB_REPOSITORY: 'attacker/happier' },
    { GITHUB_REF: 'refs/pull/1/merge' },
    { GITHUB_EVENT_NAME: 'pull_request_target' },
    { CALLER_WORKFLOW_REF: 'omnia-digital/happier/.github/workflows/untrusted.yml@refs/heads/dev' },
    { CALLER_WORKFLOW_REF: 'omnia-digital/happier/.github/workflows/omnia-production.yml@refs/heads/feature' },
    { SOURCE_REF: 'b'.repeat(40) },
    { SOURCE_REF: 'dev' },
    { PREPARATION_ONLY: 'false' },
  ]) {
    const result = run(override);
    assert.notEqual(result.status, 0, `Cassian must reject ${JSON.stringify(override)}`);
  }
  assert.equal(run({ CASSIAN_BUILD: 'false', CALLER_WORKFLOW_REF: 'another-release', PREPARATION_ONLY: 'false' }).status, 0);
});

test('Cassian runs only the unsigned Apple Silicon candidate with a job-local Xcode selection', () => {
  const desktop = workflow('build-tauri.yml');
  assert.equal(desktop.on.workflow_call.inputs.cassian_build?.default, false);
  assert.equal(desktop.on.workflow_dispatch.inputs.cassian_build, undefined);
  const build = desktop.jobs.build;
  assert.equal(build['runs-on'], '${{ inputs.cassian_build && matrix.platform_key == \'darwin-aarch64\' && fromJSON(\'["self-hosted", "macOS", "ARM64", "cassian-happier-nightly"]\') || matrix.os }}');
  assert.deepEqual(build.permissions, { contents: 'read' });
  assert.equal(build.environment, undefined);
  assert.equal(desktop.jobs.finalize['runs-on'], '${{ matrix.os }}');
  assert.equal(desktop.jobs.finalize.environment, 'release-shared');
  const xcode = build.steps.find((step) => step.id === 'cassian_xcode');
  assert.ok(xcode);
  assert.equal(xcode.if, "inputs.cassian_build && matrix.platform_key == 'darwin-aarch64'");
  assert.equal(xcode.env.DEVELOPER_DIR, '/Applications/Xcode.app/Contents/Developer');
  assert.match(xcode.run, /Xcode 26\.5/);
  assert.match(xcode.run, /GITHUB_ENV/);
  assert.doesNotMatch(xcode.run, /^\s*(?:sudo|xcode-select)\b/m);
  const hostedXcode = build.steps.find((step) => step.uses === './.github/actions/setup-xcode');
  assert.equal(hostedXcode.if, "runner.os == 'macOS' && !(inputs.cassian_build && matrix.platform_key == 'darwin-aarch64')");
  assert.equal(hostedXcode.with.xcode_version, '26.2');
});

test('the selected fork operator is trusted only after Cassian admission', () => {
  const desktop = workflow('build-tauri.yml');
  const guardJob = desktop.jobs.release_actor_guard;
  assert.deepEqual(guardJob.needs, ['trusted_ref_guard']);
  const guardStep = guardJob.steps.find((step) => step.uses === './.github/actions/release-actor-guard');
  assert.equal(guardStep.with.trusted_actors,
    "${{ inputs.cassian_build && 'github-actions[bot],github-actions,andorcassian' || 'github-actions[bot],github-actions' }}");

  const guard = YAML.parse(readFileSync(new URL('../../.github/actions/release-actor-guard/action.yml', import.meta.url), 'utf8'));
  const verify = guard.runs.steps.find((step) => step.env?.REPO_TOKEN);
  for (const [actors, actor, allowed] of [
    ['github-actions[bot],github-actions,andorcassian', 'andorcassian', true],
    ['github-actions[bot],github-actions', 'andorcassian', false],
    ['github-actions[bot],github-actions,andorcassian', 'untrusted-contributor', false],
  ]) {
    const result = spawnSync('bash', ['-c', verify.run], {
      env: {
        PATH: process.env.PATH,
        INPUT_TRUSTED_ACTORS: actors,
        ACTOR: actor,
        ORG: 'omnia-digital',
        REPO: 'omnia-digital/happier',
        // No privileged token: only an explicitly trusted actor can pass this boundary.
        APP_TOKEN: '',
        REPO_TOKEN: '',
      },
      encoding: 'utf8',
    });
    assert.equal(result.status === 0, allowed, result.stdout + result.stderr);
  }
});

test('nightly desktop builds consume certified source and must succeed before production promotion', () => {
  const nightly = workflow('omnia-production.yml');
  const build = nightly.jobs.desktop_candidate;
  assert.ok(build, 'nightly must build a native candidate before promotion');
  assert.deepEqual(build.needs, ['candidate', 'verify_source_ci']);
  assert.equal(build.uses, './.github/workflows/build-tauri.yml');
  assert.deepEqual(build.with, {
    source_ref: '${{ needs.candidate.outputs.source_sha }}',
    environment: 'production',
    preparation_only: true,
    publish_release: false,
    cassian_build: true,
    release_message: 'Omnia nightly candidate ${{ needs.candidate.outputs.source_sha }}',
  });
  assert.equal(build.secrets, undefined, 'unsigned builds must not inherit signing or publishing credentials');
  assert.ok(nightly.jobs.promote.needs.includes('desktop_candidate'));
  assert.equal(nightly.jobs.promote.if, undefined, 'normal success dependency must block promotion on failed or skipped builds');
});
