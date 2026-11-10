import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isPublishedNightlyRelease, releaseTagForSha } from './nightly-release-contract.mjs';

// Chooses what the Autopilot nightly builds: the newest dev push with successful canonical CI.

/** Returns the newest successful canonical dev push CI run of this repository, or null. */
export function selectGreenDevRun(runs, repository) {
  return runs
    .filter((run) => run.head_branch === 'dev'
      && run.event === 'push'
      && run.status === 'completed'
      && run.conclusion === 'success'
      && run.head_repository?.full_name === repository)
    .reduce((newest, run) => (!newest || run.id > newest.id ? run : newest), null);
}

/** `triggerStatus` compares source...trigger; `productionStatus` compares production...source. */
export function decideNightlyBuild({ sourceSha, triggerStatus, release, productionStatus }) {
  if (triggerStatus !== 'identical' && triggerStatus !== 'ahead') {
    throw new Error(`Green source ${sourceSha} is not an ancestor of the trigger (compare status '${triggerStatus}'); production was not changed.`);
  }
  if (isPublishedNightlyRelease(release)) {
    return { buildNeeded: false, reason: `${sourceSha} already has a published nightly ${release.tag_name}.` };
  }
  if (productionStatus === 'behind') {
    return { buildNeeded: false, reason: `${sourceSha} is strictly behind production.` };
  }
  return { buildNeeded: true, reason: `${sourceSha} has no published nightly; building it.` };
}

function ghApi(args) {
  // 100 full workflow run objects exceed spawnSync's 1 MiB default buffer.
  const result = spawnSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { ok: result.status === 0, out: result.stdout, err: result.stderr.trim() };
}

function ghJson(endpoint) {
  const result = ghApi([endpoint]);
  if (!result.ok) throw new Error(`gh api ${endpoint} failed: ${result.err}`);
  return JSON.parse(result.out);
}

function compareStatus(repository, base, head) {
  const endpoint = `repos/${repository}/compare/${base}...${head}`;
  const result = ghApi([endpoint, '--jq', '.status']);
  if (!result.ok) throw new Error(`gh api ${endpoint} failed: ${result.err}`);
  return result.out.trim();
}

/** A draft or missing tag answers 404, which means not released. */
function readRelease(repository, tag) {
  const endpoint = `repos/${repository}/releases/tags/${tag}`;
  const result = ghApi([endpoint]);
  if (result.ok) return JSON.parse(result.out);
  if (result.err.includes('(HTTP 404)')) return null;
  throw new Error(`gh api ${endpoint} failed: ${result.err}`);
}

function main() {
  const { GITHUB_REPOSITORY: repository, GITHUB_OUTPUT: outputPath, GITHUB_STEP_SUMMARY: summaryPath, TRIGGER_SHA: triggerSha } = process.env;
  const { workflow_runs: runs } = ghJson(`repos/${repository}/actions/workflows/tests.yml/runs?branch=dev&event=push&status=success&per_page=100`);
  const run = selectGreenDevRun(runs, repository);
  if (!run) throw new Error('No successful canonical dev push CI exists; production was not changed.');

  const sourceSha = run.head_sha;
  const releaseTag = releaseTagForSha(sourceSha);
  const { buildNeeded, reason } = decideNightlyBuild({
    sourceSha,
    triggerStatus: sourceSha === triggerSha ? 'identical' : compareStatus(repository, sourceSha, triggerSha),
    release: readRelease(repository, releaseTag),
    productionStatus: compareStatus(repository, 'production', sourceSha),
  });

  appendFileSync(outputPath, [
    `source_sha=${sourceSha}`,
    `ci_run_id=${run.id}`,
    `release_tag=${releaseTag}`,
    `build_needed=${buildNeeded}`,
    '',
  ].join('\n'));
  appendFileSync(summaryPath, `${reason}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.log(`::error::${error.message}`);
    process.exit(1);
  }
}
