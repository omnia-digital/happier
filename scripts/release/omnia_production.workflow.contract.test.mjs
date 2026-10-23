import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

const repoRoot = new URL('../..', import.meta.url).pathname;

function workflow(name) {
  return YAML.parse(readFileSync(join(repoRoot, '.github', 'workflows', name), 'utf8'));
}

test('Omnia nightly promotes only an exact successful canonical dev push CI source', () => {
  const configured = workflow('omnia-production.yml');
  assert.deepEqual(configured.on.schedule, [{ cron: '17 2 * * *', timezone: 'America/Los_Angeles' }]);
  assert.ok(Object.hasOwn(configured.on, 'workflow_dispatch'), 'manual retry must remain available');

  const candidate = configured.jobs.candidate;
  const verify = configured.jobs.verify_source_ci;
  const promote = configured.jobs.promote;
  assert.match(candidate.if, /github\.repository == 'omnia-digital\/happier'/);
  assert.match(candidate.if, /github\.ref == 'refs\/heads\/dev'/);
  assert.deepEqual(candidate.permissions, { actions: 'read', contents: 'read' });
  assert.deepEqual(verify.permissions, { actions: 'read', contents: 'read' });
  assert.equal(candidate.outputs.source_sha, '${{ steps.source.outputs.source_sha }}');
  assert.equal(candidate.outputs.ci_run_id, '${{ steps.ci.outputs.ci_run_id }}');

  const candidateShell = candidate.steps.map((step) => step.run ?? '').join('\n');
  assert.equal(candidate.steps[0].env.SOURCE_SHA, '${{ github.sha }}');
  assert.match(candidateShell, /head_sha=\$\{SOURCE_SHA\}/);
  assert.match(candidateShell, /event=push/);
  assert.match(candidateShell, /status=success/);
  assert.match(candidateShell, /ci_run_id=/);
  assert.match(candidateShell, /exit 1/);
  assert.doesNotMatch(candidateShell, /secrets\.|RELEASE_BOT_/);

  assert.deepEqual(verify.needs, ['candidate']);
  assert.equal(verify.steps[0].with.repository, '${{ github.repository }}');
  assert.equal(verify.steps[0].with.ref, '${{ github.sha }}');
  assert.match(verify.steps.map((step) => step.run ?? '').join('\n'), /verify-existing-ci\.mjs/);
  assert.match(verify.steps.map((step) => step.run ?? '').join('\n'), /--source-branch dev/);
  assert.deepEqual(promote.needs, ['candidate', 'verify_source_ci']);
  assert.equal(promote.steps[0].with.repository, '${{ github.repository }}');
  assert.equal(promote.steps[0].with.ref, '${{ github.sha }}');
  assert.equal(promote.permissions.contents, 'read');
  assert.equal(promote.environment, undefined, 'fork promotion must not assume an upstream environment');
  assert.equal(
    promote.steps.some((step) => step.uses === './.github/actions/release-actor-guard'),
    false,
    'fork-only branch promotion uses GitHub dispatch authorization and exact CI admission',
  );

  const appToken = promote.steps.find((step) => String(step.uses ?? '').startsWith('actions/create-github-app-token@'));
  assert.ok(appToken, 'promotion must use a fork-owned GitHub App token');
  assert.equal(appToken.with['permission-contents'], 'write');
  assert.equal(appToken.with['permission-workflows'], 'write');
  const promoteShell = promote.steps.map((step) => step.run ?? '').join('\n');
  assert.match(promoteShell, /promote-branch/);
  assert.match(promoteShell, /--source dev/);
  assert.match(promoteShell, /--target production/);
  assert.match(promoteShell, /--source-sha/);
  assert.match(promoteShell, /--mode fast_forward/);
  assert.doesNotMatch(promoteShell, /--allow-reset true|--mode reset/);
});

test('upstream scheduled jobs retain their schedules and skip work on the Omnia fork', () => {
  const nightly = workflow('nightly-dev.yml');
  assert.ok(nightly.on.schedule?.length > 0);
  assert.match(nightly.jobs.resolve_resume.if, /github\.repository == 'happier-dev\/happier'/);
  assert.match(nightly.jobs.release_status.if, /github\.repository == 'happier-dev\/happier'/);
  assert.deepEqual(nightly.jobs.prepare_release_candidate.needs, ['resolve_resume', 'snapshot_source_issues']);

  const extended = workflow('extended-db-tests.yml');
  assert.deepEqual(extended.on.schedule, [{ cron: '0 4 * * *' }]);
  assert.deepEqual(Object.keys(extended.on.workflow_call.inputs), [
    'checkout_sha', 'select_jobs_explicitly', 'run_e2e_postgres', 'run_e2e_mysql',
    'run_db_contract_postgres', 'run_db_contract_mysql',
  ]);
  for (const job of Object.values(extended.jobs)) {
    assert.match(job.if, /github\.repository == 'happier-dev\/happier'/);
  }

  const stress = workflow('stress-tests.yml');
  assert.ok(stress.on.schedule?.length > 0);
  assert.match(stress.jobs['stress-scheduled'].if, /github\.repository == 'happier-dev\/happier'/);
  assert.equal(stress.jobs['stress-dispatch'].if, "${{ github.event_name == 'workflow_dispatch' }}");

  const selfHost = workflow('self-host-e2e.yml');
  assert.ok(selfHost.on.schedule?.length > 0);
  assert.match(selfHost.jobs.self_host.if, /github\.repository == 'happier-dev\/happier'/);
  assert.match(selfHost.jobs.self_host.if, /github\.event_name == 'workflow_dispatch'/);
});
