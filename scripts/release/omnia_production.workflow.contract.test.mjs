import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

import { MANIFEST_ASSET, TARBALL_ASSET } from '../fork/nightly-release-contract.mjs';

const repoRoot = new URL('../..', import.meta.url).pathname;

function workflow(name) {
  return YAML.parse(readFileSync(join(repoRoot, '.github', 'workflows', name), 'utf8'));
}

test('Omnia nightly promotes only a selected source with successful canonical dev push CI', () => {
  const configured = workflow('omnia-production.yml');
  assert.deepEqual(configured.on.schedule, [{ cron: '17 2 * * *', timezone: 'America/Los_Angeles' }]);
  assert.ok(Object.hasOwn(configured.on, 'workflow_dispatch'), 'manual retry must remain available');

  const candidate = configured.jobs.candidate;
  const verify = configured.jobs.verify_source_ci;
  const promote = configured.jobs.promote;
  // Bound to the organization, not the repository name, which Josh is changing to autopilot.
  assert.match(candidate.if, /github\.repository_owner == 'omnia-digital'/);
  assert.doesNotMatch(candidate.if, /omnia-digital\//);
  assert.match(candidate.if, /github\.ref == 'refs\/heads\/dev'/);
  assert.deepEqual(candidate.permissions, { actions: 'read', contents: 'read' });
  assert.deepEqual(verify.permissions, { actions: 'read', contents: 'read' });
  assert.deepEqual(candidate.outputs, {
    source_sha: '${{ steps.select.outputs.source_sha }}',
    ci_run_id: '${{ steps.select.outputs.ci_run_id }}',
    release_tag: '${{ steps.select.outputs.release_tag }}',
    build_needed: '${{ steps.select.outputs.build_needed }}',
  });

  assert.equal(candidate.steps[0].with.ref, '${{ github.sha }}');
  assert.equal(candidate.steps[0].with['persist-credentials'], false);
  const select = candidate.steps.find((step) => step.id === 'select');
  assert.match(select.run, /node scripts\/fork\/select-nightly-candidate\.mjs/);
  assert.deepEqual(select.env, { GH_TOKEN: '${{ github.token }}', TRIGGER_SHA: '${{ github.sha }}' });
  assert.doesNotMatch(JSON.stringify(candidate), /secrets\.|RELEASE_BOT_/);

  assert.equal(verify.if, "needs.candidate.outputs.build_needed == 'true'");
  assert.deepEqual(verify.needs, ['candidate']);
  assert.equal(verify.steps[0].with.repository, '${{ github.repository }}');
  assert.equal(verify.steps[0].with.ref, '${{ github.sha }}');
  assert.match(verify.steps.map((step) => step.run ?? '').join('\n'), /verify-existing-ci\.mjs/);
  assert.match(verify.steps.map((step) => step.run ?? '').join('\n'), /--source-branch dev/);
  assert.deepEqual(promote.needs, ['candidate', 'verify_source_ci', 'desktop_candidate']);
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
  assert.equal(promote.steps.find((step) => step.env?.SOURCE_SHA).env.SOURCE_SHA, '${{ needs.candidate.outputs.source_sha }}');
  // A skipped verify_source_ci must cascade through the build, promotion and publication.
  assert.equal(promote.if, undefined);
  assert.equal(configured.jobs.desktop_candidate.if, undefined);
});

test('Omnia nightly publishes the promoted build on a hosted job with only contents:write', () => {
  const configured = workflow('omnia-production.yml');
  const publish = configured.jobs.publish_release;
  assert.ok(publish, 'nightly must publish what it promoted');
  assert.deepEqual(publish.needs, ['candidate', 'promote']);
  assert.equal(publish.if, undefined, 'a skipped or failed promotion must block publication');
  assert.equal(publish['runs-on'], 'ubuntu-latest');
  assert.deepEqual(publish.permissions, { contents: 'write' });
  assert.equal(publish.steps[0].with.ref, '${{ github.sha }}');
  assert.equal(publish.steps[0].with['persist-credentials'], false);

  const download = publish.steps.find((step) => String(step.uses ?? '').startsWith('actions/download-artifact@'));
  assert.equal(download.uses, 'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093');
  assert.equal(download.with.name, 'autopilot-macos-arm64');
  // The pipeline refuses a dirty worktree, so assets must land outside the checkout.
  assert.match(download.with.path, /^\$\{\{ runner\.temp \}\}/);

  const release = publish.steps.find((step) => /github-publish-release/.test(step.run ?? ''));
  assert.equal(release.env.GH_TOKEN, '${{ github.token }}');
  assert.equal(release.env.RELEASE_TAG, '${{ needs.candidate.outputs.release_tag }}');
  assert.equal(release.env.SOURCE_SHA, '${{ needs.candidate.outputs.source_sha }}');
  for (const flag of [
    /--tag "\$RELEASE_TAG"/,
    /--title /,
    /--target-sha "\$SOURCE_SHA"/,
    /--prerelease false/,
    /--rolling-tag false/,
    /--generate-notes false/,
    /--notes /,
    /--clobber false/,
    /--prune-assets false/,
    /--latest true/,
    /--replace-draft true/,
    /--secrets-source env/,
  ]) {
    assert.match(release.run, flag);
  }
  assert.doesNotMatch(release.run, /--allow-dirty|--assets-dir/);
  assert.ok(release.run.includes(`/${TARBALL_ASSET}`) && release.run.includes(`/${MANIFEST_ASSET}`));
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
