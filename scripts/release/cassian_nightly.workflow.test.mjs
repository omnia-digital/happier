import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

import { APP_NAME, BUNDLE_ID, PRODUCT_NAME, SERVER_URL } from '../fork/nightly-release-contract.mjs';

function workflow(name) {
  return YAML.parse(readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8'));
}

test('Cassian admission accepts only the fork nightly with a dev ancestor source and unsigned preparation', () => {
  const desktop = workflow('build-tauri.yml');
  const admission = desktop.jobs.trusted_ref_guard.steps.find((step) => step.id === 'admit_cassian');
  assert.ok(admission, 'persistent Cassian builds require admission before runner allocation');
  assert.deepEqual(admission.env, {
    CASSIAN_BUILD: '${{ inputs.cassian_build }}',
    CALLER_WORKFLOW_REF: '${{ github.workflow_ref }}',
    SOURCE_REF: '${{ inputs.source_ref }}',
    PREPARATION_ONLY: '${{ inputs.preparation_only }}',
    GH_TOKEN: '${{ github.token }}',
  });
  const trigger = 'a'.repeat(40);
  const ancestor = 'b'.repeat(40);
  const admitted = {
    CASSIAN_BUILD: 'true',
    CALLER_WORKFLOW_REF: 'omnia-digital/happier/.github/workflows/omnia-production.yml@refs/heads/dev',
    GITHUB_REPOSITORY: 'omnia-digital/happier',
    GITHUB_REPOSITORY_OWNER: 'omnia-digital',
    GITHUB_REF: 'refs/heads/dev',
    GITHUB_SHA: trigger,
    GITHUB_EVENT_NAME: 'schedule',
    SOURCE_REF: ancestor,
    PREPARATION_ONLY: 'true',
  };
  // gh is the GitHub API boundary. It answers only this repository's source...trigger compare.
  const bin = mkdtempSync(join(tmpdir(), 'cassian-admission-'));
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
if [ -n "$COMPARE_FAILS" ]; then echo 'gh: Server Error (HTTP 500)' >&2; exit 1; fi
test "$*" = "api repos/$GITHUB_REPOSITORY/compare/$SOURCE_REF...$GITHUB_SHA --jq .status" || { echo "Unexpected gh call: $*" >&2; exit 2; }
echo "$COMPARE_STATUS"
`);
  chmodSync(join(bin, 'gh'), 0o755);
  const run = (overrides) => spawnSync('bash', ['-c', admission.run], {
    env: { PATH: `${bin}:${process.env.PATH}`, COMPARE_STATUS: 'ahead', ...admitted, ...overrides }, encoding: 'utf8',
  });
  try {
    for (const event of ['schedule', 'workflow_dispatch']) {
      const result = run({ GITHUB_EVENT_NAME: event });
      assert.equal(result.status, 0, result.stderr);
    }
    const exact = run({ SOURCE_REF: trigger, COMPARE_STATUS: 'behind' });
    assert.equal(exact.status, 0, exact.stderr);
    // Josh is renaming the repository to omnia-digital/autopilot; admission must not depend on the name.
    const renamed = run({
      GITHUB_REPOSITORY: 'omnia-digital/autopilot',
      CALLER_WORKFLOW_REF: 'omnia-digital/autopilot/.github/workflows/omnia-production.yml@refs/heads/dev',
    });
    assert.equal(renamed.status, 0, renamed.stderr);
    for (const override of [
      { GITHUB_REPOSITORY: 'attacker/happier' },
      {
        GITHUB_REPOSITORY: 'attacker/happier',
        GITHUB_REPOSITORY_OWNER: 'attacker',
        CALLER_WORKFLOW_REF: 'attacker/happier/.github/workflows/omnia-production.yml@refs/heads/dev',
      },
      { CALLER_WORKFLOW_REF: 'omnia-digital/another-repo/.github/workflows/omnia-production.yml@refs/heads/dev' },
      { GITHUB_REF: 'refs/pull/1/merge' },
      { GITHUB_EVENT_NAME: 'pull_request_target' },
      { CALLER_WORKFLOW_REF: 'omnia-digital/happier/.github/workflows/untrusted.yml@refs/heads/dev' },
      { CALLER_WORKFLOW_REF: 'omnia-digital/happier/.github/workflows/omnia-production.yml@refs/heads/feature' },
      { COMPARE_STATUS: 'behind' },
      { COMPARE_STATUS: 'diverged' },
      { COMPARE_STATUS: 'identical' },
      { COMPARE_FAILS: '1' },
      { SOURCE_REF: 'dev' },
      { PREPARATION_ONLY: 'false' },
    ]) {
      const result = run(override);
      assert.notEqual(result.status, 0, `Cassian must reject ${JSON.stringify(override)}`);
    }
    assert.equal(run({ CASSIAN_BUILD: 'false', CALLER_WORKFLOW_REF: 'another-release', PREPARATION_ONLY: 'false' }).status, 0);
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});

test('Cassian packages the installable app with the fork identity and uploads it', () => {
  const build = workflow('build-tauri.yml').jobs.build;
  const cassianOnly = "inputs.cassian_build && matrix.platform_key == 'darwin-aarch64'";
  const index = (predicate) => {
    const found = build.steps.findIndex(predicate);
    assert.notEqual(found, -1);
    return found;
  };
  const candidateUpload = index((step) => step.name === 'Upload desktop candidate');
  const appBuild = index((step) => step.id === 'nightly_app');
  const control = index((step) => step.id === 'nightly_control');
  const packaging = index((step) => step.id === 'nightly_package');
  const upload = index((step) => step.id === 'nightly_upload');
  assert.ok(candidateUpload < appBuild && appBuild < control && control < packaging && packaging < upload);
  for (const step of [appBuild, control, packaging, upload]) assert.equal(build.steps[step].if, cassianOnly);

  const { env, run } = build.steps[appBuild];
  assert.deepEqual(env, {
    HAPPIER_STACK_CLI_ROOT_DISABLE: '1',
    HAPPIER_STACK_DISABLE_STACK_ENV_AUTOLOAD: '1',
    HAPPIER_STACK_HOME_DIR: '${{ runner.temp }}/hstack-home',
    HAPPIER_STACK_SKIP_REFRESH_DEPS: '1',
    HAPPIER_STACK_STACK: 'omnia-production-desktop',
    HAPPIER_STACK_TAURI_BUNDLES: 'app',
    HAPPIER_STACK_TAURI_DEBUG: '0',
    HAPPIER_STACK_TAURI_IDENTIFIER: BUNDLE_ID,
    HAPPIER_STACK_TAURI_PREFER_TAILSCALE: '0',
    HAPPIER_STACK_TAURI_PRODUCT_NAME: PRODUCT_NAME,
    HAPPIER_STACK_TAURI_SERVER_URL: SERVER_URL,
    APP_ENV: 'production',
    EXPO_PUBLIC_HAPPIER_DESKTOP_UPDATES_ENABLED: '0',
    APPLE_SIGNING_IDENTITY: '-',
  });
  assert.match(run, /HAPPIER_STACK_REPO_DIR="\$PWD"/);
  assert.match(run, /env -u HAPPIER_STACK_ENV_FILE/);
  assert.match(run, /hstack\.mjs build --tauri --tauri-production/);
  assert.ok(
    run.indexOf('rm -rf "$HOME/.happier/stacks/$HAPPIER_STACK_STACK/tauri-target/release/bundle"') !== -1
      && run.indexOf('rm -rf') < run.indexOf('hstack.mjs build'),
    'a stale bundle from an earlier build must never be packaged',
  );

  // The selected source can predate the packager, so it comes from the trusted workflow control.
  assert.deepEqual(build.steps[control].with, {
    repository: '${{ job.workflow_repository }}',
    ref: '${{ job.workflow_sha }}',
    path: '.release-control',
    'fetch-depth': 1,
    'persist-credentials': false,
  });
  const packageStep = build.steps[packaging];
  assert.match(packageStep.run, /node \.release-control\/scripts\/fork\/package-nightly-app\.mjs/);
  assert.ok(packageStep.run.includes(`tauri-target/release/bundle/macos/${APP_NAME}`));
  assert.match(packageStep.run, /--ui-export apps\/ui\/dist/);
  assert.equal(packageStep.env.SOURCE_SHA, '${{ needs.resolve_source.outputs.source_sha }}');
  assert.equal(packageStep.env.RUN_ID, '${{ github.run_id }}');

  const artifact = build.steps[upload];
  assert.equal(artifact.uses, build.steps[candidateUpload].uses);
  assert.equal(artifact.with.name, 'autopilot-macos-arm64');
  assert.equal(artifact.with['retention-days'], 7);
  assert.equal(artifact.with['if-no-files-found'], 'error');
  assert.doesNotMatch(JSON.stringify(build.steps.slice(appBuild)), /secrets\./);
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
    release_message: 'Autopilot nightly candidate ${{ needs.candidate.outputs.source_sha }}',
  });
  assert.equal(build.secrets, undefined, 'unsigned builds must not inherit signing or publishing credentials');
  assert.ok(nightly.jobs.promote.needs.includes('desktop_candidate'));
  assert.equal(nightly.jobs.promote.if, undefined, 'normal success dependency must block promotion on failed or skipped builds');
});
