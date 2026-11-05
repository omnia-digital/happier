import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MANIFEST_ASSET, TARBALL_ASSET, releaseTagForSha } from '../fork/nightly-release-contract.mjs';
import { decideNightlyBuild, selectGreenDevRun } from '../fork/select-nightly-candidate.mjs';

const repository = 'omnia-digital/happier';
const script = fileURLToPath(new URL('../fork/select-nightly-candidate.mjs', import.meta.url));
const trigger = 'a'.repeat(40);
const green = 'b'.repeat(40);

const run = (overrides = {}) => ({
  id: 10,
  head_sha: green,
  head_branch: 'dev',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  head_repository: { full_name: repository },
  ...overrides,
});
const published = (sha = green) => ({
  tag_name: releaseTagForSha(sha),
  draft: false,
  prerelease: false,
  assets: [{ name: TARBALL_ASSET }, { name: MANIFEST_ASSET }],
});

test('the green run selector keeps only successful canonical dev pushes from this repository', () => {
  const newest = run({ id: 30 });
  const excluded = [
    run({ id: 90, head_branch: 'feature' }),
    run({ id: 91, event: 'workflow_dispatch' }),
    run({ id: 92, status: 'in_progress' }),
    run({ id: 93, conclusion: 'failure' }),
    run({ id: 94, head_repository: { full_name: 'attacker/happier' } }),
    run({ id: 95, head_repository: null }),
  ];
  assert.equal(selectGreenDevRun([run({ id: 20 }), ...excluded, newest, run({ id: 5 })], repository), newest);
  assert.equal(selectGreenDevRun(excluded, repository), null);
});

test('the build decision follows the release, not production, and requires ancestry of the trigger', () => {
  for (const triggerStatus of ['behind', 'diverged']) {
    assert.throws(() => decideNightlyBuild({ sourceSha: green, triggerStatus, release: null, productionStatus: 'ahead' }), /not an ancestor/);
  }
  const decide = (input) => decideNightlyBuild({ sourceSha: green, triggerStatus: 'ahead', ...input });

  assert.equal(decide({ release: null, productionStatus: 'ahead' }).buildNeeded, true);
  assert.equal(decideNightlyBuild({ sourceSha: green, triggerStatus: 'identical', release: null, productionStatus: 'ahead' }).buildNeeded, true);
  // Promote succeeded and publish failed: production holds the SHA and no release exists.
  assert.equal(decide({ release: null, productionStatus: 'identical' }).buildNeeded, true);
  assert.equal(decide({ release: published(), productionStatus: 'ahead' }).buildNeeded, false);
  assert.equal(decide({ release: null, productionStatus: 'behind' }).buildNeeded, false);
  // A release that is not a finished nightly does not count as published.
  const incomplete = { ...published(), assets: [{ name: TARBALL_ASSET }] };
  assert.equal(decide({ release: incomplete, productionStatus: 'identical' }).buildNeeded, true);
  assert.equal(decide({ release: { ...published(), draft: true }, productionStatus: 'identical' }).buildNeeded, true);
});

function fixture(responses) {
  const root = mkdtempSync(join(tmpdir(), 'select-nightly-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const responsesPath = join(root, 'responses.json');
  writeFileSync(responsesPath, JSON.stringify(responses));
  // gh is the GitHub API boundary: answers by endpoint, like the real CLI on 404s.
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const responses = JSON.parse(require('node:fs').readFileSync(${JSON.stringify(responsesPath)}, 'utf8'));
const args = process.argv.slice(2);
const endpoint = args[1];
const match = Object.keys(responses).find((key) => endpoint.includes(key));
if (args[0] !== 'api' || !match) { console.error('Unexpected gh call: ' + args.join(' ')); process.exit(2); }
const answer = responses[match];
if (answer.httpStatus) { console.error('gh: failed (HTTP ' + answer.httpStatus + ')'); process.exit(1); }
const jq = args.indexOf('--jq');
console.log(jq === -1 ? JSON.stringify(answer) : answer.status);
`);
  chmodSync(join(bin, 'gh'), 0o755);
  const output = join(root, 'output');
  const summary = join(root, 'summary');
  const execute = () => {
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_REPOSITORY: repository,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
        TRIGGER_SHA: trigger,
      },
    });
    const read = (path) => {
      try { return readFileSync(path, 'utf8'); } catch { return ''; }
    };
    return { ...result, log: result.stdout + result.stderr, outputs: read(output), summary: read(summary) };
  };
  return { execute, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const runsKey = 'actions/workflows/tests.yml/runs?branch=dev&event=push&status=success&per_page=100';
const triggerKey = `compare/${green}...${trigger}`;
const productionKey = `compare/production...${green}`;
const releaseKey = `releases/tags/${releaseTagForSha(green)}`;

function cli(responses, assertions) {
  const f = fixture(responses);
  try {
    assertions(f.execute());
  } finally {
    f.cleanup();
  }
}

test('the CLI writes the selected candidate and a one-line reason', () => {
  cli({
    [runsKey]: { workflow_runs: [run({ id: 7, head_sha: 'c'.repeat(40) }), run({ id: 12 })] },
    [triggerKey]: { status: 'ahead' },
    [releaseKey]: { httpStatus: 404 },
    [productionKey]: { status: 'ahead' },
  }, (result) => {
    assert.equal(result.status, 0, result.log);
    assert.equal(result.outputs, [
      `source_sha=${green}`, 'ci_run_id=12', `release_tag=${releaseTagForSha(green)}`, 'build_needed=true', '',
    ].join('\n'));
    assert.equal(result.summary.trim().split('\n').length, 1);
    assert.match(result.summary, new RegExp(green));
  });
});

test('the CLI skips a SHA whose nightly is already published', () => {
  cli({
    [runsKey]: { workflow_runs: [run()] },
    [triggerKey]: { status: 'identical' },
    [releaseKey]: published(),
    [productionKey]: { status: 'identical' },
  }, (result) => {
    assert.equal(result.status, 0, result.log);
    assert.match(result.outputs, /^build_needed=false$/m);
  });
});

test('the CLI does not call the compare API when the green SHA is the trigger itself', () => {
  cli({
    [runsKey]: { workflow_runs: [run({ head_sha: trigger })] },
    [`releases/tags/${releaseTagForSha(trigger)}`]: { httpStatus: 404 },
    [`compare/production...${trigger}`]: { status: 'ahead' },
  }, (result) => {
    assert.equal(result.status, 0, result.log);
    assert.match(result.outputs, new RegExp(`^source_sha=${trigger}$`, 'm'));
  });
});

test('the CLI fails loudly and writes no decision', async (t) => {
  const cases = {
    'no green run': [{ [runsKey]: { workflow_runs: [run({ conclusion: 'failure' })] } }, /No successful canonical dev push CI/],
    'non-ancestor green run': [{
      [runsKey]: { workflow_runs: [run()] },
      [triggerKey]: { status: 'diverged' },
      [releaseKey]: { httpStatus: 404 },
      [productionKey]: { status: 'ahead' },
    }, /not an ancestor/],
    'release API failure': [{
      [runsKey]: { workflow_runs: [run()] },
      [triggerKey]: { status: 'ahead' },
      [releaseKey]: { httpStatus: 500 },
      [productionKey]: { status: 'ahead' },
    }, /HTTP 500/],
    'production compare failure': [{
      [runsKey]: { workflow_runs: [run()] },
      [triggerKey]: { status: 'ahead' },
      [releaseKey]: { httpStatus: 404 },
      [productionKey]: { httpStatus: 404 },
    }, /HTTP 404/],
  };
  for (const [name, [responses, message]] of Object.entries(cases)) {
    await t.test(name, () => cli(responses, (result) => {
      assert.notEqual(result.status, 0, result.log);
      assert.match(result.log, /::error::/);
      assert.match(result.log, message);
      assert.equal(result.outputs, '');
    }));
  }
});
