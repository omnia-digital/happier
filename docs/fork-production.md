# Omnia development and production

The Omnia fork uses `dev` for integration and `production` for the daily-use
source. `main` follows the parent project's main line and is not our release
destination. Feature branches and pull requests target `dev`.

This is a source promotion workflow gated by CI and unsigned desktop builds. It does not publish upstream npm packages,
update feeds, app-store builds, Docker images, or GitHub release artifacts.
Signing and distribution are separate release work. The hosted Happier account,
relay, installed CLI and daemon remain the existing daily services.

## Permanent local checkouts

| Checkout | Branch | Purpose |
| --- | --- | --- |
| `/Users/Josh/Developer/Projects/Omnia/apps/happier-dev` | `dev` | Integration baseline and starting point for feature worktrees |
| `/Users/Josh/Developer/Projects/Omnia/apps/happier-production` | `production` | Pull-only daily-use source |
| `/Users/Josh/Developer/Projects/Omnia/apps/happier` | Existing feature branch | Preserved existing development and running stack |

The first two are independent clones. Production never shares a Git directory,
working source, or a mutable `node_modules` symlink with development. The existing
feature checkout is preserved until its work is integrated; do not switch it or
delete it during setup. A branch name alone does not certify its starting commit
as a tested release.

Create ticket-named worktrees through the existing Stack owner, from `happier-dev`:

```sh
git pull --ff-only origin dev
node apps/stack/scripts/repo_local.mjs wt new OH-123-description --from=origin --base=origin/dev --deps=none
```

Use an explicitly named stack for concurrent feature runtimes. Linked worktrees
can share the repo-local stack identity; the permanent production clone has its
own Git identity and therefore a separate repo-local stack.

## Production protection on this Mac

Run the following from a development checkout containing this change, never by
editing the production copy:

```sh
node scripts/fork/production-checkout.mjs protect /Users/Josh/Developer/Projects/Omnia/apps/happier-production
node scripts/fork/production-checkout.mjs status /Users/Josh/Developer/Projects/Omnia/apps/happier-production
node scripts/fork/production-checkout.mjs update /Users/Josh/Developer/Projects/Omnia/apps/happier-production
```

`protect` requires a clean independent clone, the `production` branch, and the
exact fork GitHub origin. It refuses to replace an existing local hooks path.
It marks tracked source, its parent directories, the index, HEAD, local Git
configuration and guard hooks immutable with macOS file flags. Commits, rebases
and pushes are blocked by hooks; the push destination is disabled. Generated
runtime state and installed dependencies are not source and are not locked.

`update` fetches only `origin/production`, checks ancestry, then temporarily
unlocks the source for a fast-forward to that fetched commit. It locks the new
tree again in `finally`, including after a failed merge. No reset, rebase,
force-push, automatic cleanup, or stash is used. A dirty or divergent checkout
stops for investigation. Network failure occurs before unlocking. Stop the
production app before updating; reopen it after the update and any necessary
build. A failed or interrupted update is not a verified running release.

Install dependencies and create required ignored build/cache directories before
first protection. Upgrades that change dependency or build prerequisites need
the normal build/validation workflow before daily adoption. This helper does not
certify a native app or silently refresh a running app. It currently supports
macOS only and does not change Windows or Linux runtime paths.

These are strong accidental-edit safeguards, not an OS security boundary against
the owning account or an administrator deliberately removing them. Agents must
not remove the guards. After an abrupt process/OS interruption, rerun `protect`
from development to reapply file flags before using the checkout.

### Verified setup and remaining launch gate

The two permanent clones were created at
`98dab9837ab4f918cb9be86095eca8ebe6136c25`. The production clone has the guards
installed: the OS rejects write access to tracked source with `EPERM`, its HEAD
and index are immutable, and a real `update` fetched GitHub successfully without
changing that commit. The six checkout tests exercise writes, Git mutations,
fast-forward/repeat updates, wrong checkout admission, failed fetch/merge, and
preservation of ignored files. Workflow, existing CI-verifier and existing
promotion tests also pass locally. These do not establish a hosted release.

Dependencies were copied independently with APFS copy-on-write from the existing
checkout, whose dependency manifests/lockfile match this source. A separate
repo-local production stack was initialized as
`repo-happier-production-3cff8ebd12`, titled **Happier Omnia Production**, with the
hosted relay and no local relay or daemon. Its protected launch is **blocked**:
Expo development type generation opens `apps/ui/.gitignore` for writing and is
correctly denied by the OS. The source guards were not weakened to allow this.
The unprotected first native compilation was stopped before completion; no
native build or authenticated production-app acceptance is claimed.

The daily app has not been replaced. Resolve the source-read-only launch path
through the canonical Stack build/launcher after the required setup changes reach
production, then verify the built native app and hosted session continuity.
`hstack build --tauri` already owns local bundled builds; its export paths can be
kept outside source through existing stack settings. Distribution must also
resolve the inherited upstream updater feed before daily adoption. Do not run
the development launcher as the protected production daily app or bypass file
flags to make it start.

## Nightly promotion

`.github/workflows/omnia-production.yml` runs at **02:17 America/Los_Angeles**,
including daylight-saving changes, on the fork's default `dev` branch. GitHub
schedules are best effort. A manual run is admitted only from this fork's `dev`.

1. Bind the triggering `dev` commit.
2. Find a successful canonical `tests.yml` **push** run for that exact SHA.
3. Use `verify-existing-ci.mjs` to validate the repository, workflow, event,
   branch, source SHA and required lane artifact. A green unrelated/manual run
   does not qualify. Missing or failed CI leaves production untouched.
4. Build unsigned desktop candidates through `build-tauri.yml`, with Apple
   Silicon on Cassian and other platforms on their existing hosted runners.
   Missing, skipped or failed builds block promotion.
5. Create a narrowly scoped token from the fork's release GitHub App.
6. Use the existing `promote-branch.mjs` owner to fast-forward `production` to
   the certified commit. Divergence fails; it is never reset. Newer `dev` commits
   arriving during the run are not silently included.

GitHub's normal repository-write permission controls manual dispatch. The
fork/repository and `dev` guards, exact-source CI verifier and App scope protect
promotion. Desktop preparation retains the canonical release actor guard, with
its repository-admin check when no release team credentials are forwarded.
Upstream scheduled
publication and extra nightly suites remain defined, but their scheduled jobs
are admitted only in `happier-dev/happier`; their manual/reusable behavior remains.

## Cassian nightly build host

Josh selected Cassian for the nightly build. SSH access was verified to its Apple
Silicon Mac: 48 GiB RAM, 14 CPU cores, Rust 1.94.1, Xcode 26.5, and Git/GitHub CLI/
Node/unzip available with `/opt/homebrew/bin` on PATH. At inspection it had about
15 GiB free and substantial existing load; those are observations, not a native
build capacity certification.

The official ARM64 GitHub Actions runner **2.338.1** was downloaded and extracted
to `/Users/cassian/Developer/runners/happier-nightly`. Its published SHA-256
`52c3fb801b931fbd454979bae5ec3443ea3da2c4a1b4c44fa546fb630d61a0a9` matched,
and `bin/Runner.Listener --version` succeeded. It is **not registered or running
as a service**. Existing Guitar Tricks and Omnia Church Platform runner services
were inspected and left unchanged. They are registered to other repositories or
organizations and cannot be assumed available to Happier.

The Happier repository runner list is empty. Organization runner administration
returned HTTP 403 with the current local GitHub credentials, and Cassian's CLI
has no authenticated GitHub API session. Registration remains part of the
GitHub activation exception below; no credentials were copied between machines.

For registration, use a dedicated organization runner group restricted to this
repository and `omnia-digital/happier/.github/workflows/build-tauri.yml@refs/heads/dev`,
where the reusable build job is defined. Its additional admission step permits
Cassian only when called by `omnia-production.yml` on `dev`, for the triggering
exact SHA and unsigned preparation. This fork is public, so
do not expose Cassian's persistent runner to pull-request workflows. Give the
runner a Cassian-specific label and its own `_work` directory under the installed
runner. Register with `/opt/homebrew/bin` on PATH, then install/start its own
service and verify that GitHub reports it online before dispatch.

Verify the selected-workflow restriction is available and enforced for the
organization before starting the service. Current credentials cannot administer
or verify that policy. Do not fall back to a repository-only/default group: a
separate PR workflow could request the same labels without passing this build
workflow's guard. If workflow restriction is unavailable, resolve an isolated
execution boundary before registration. GitHub documents the workflow allowlist
and reusable-job behavior in its
[runner-group access guide](https://docs.github.com/en/enterprise-cloud%40latest/actions/how-tos/manage-runners/self-hosted-runners/manage-access).

The selected `dev` source is trusted code and executes with the runner service
account's filesystem permissions; a dedicated working directory does not isolate
that account from the other CI services. The first live run must also verify the
canonical actor guard: scheduled workflows can have a human actor, who must pass
the existing repository-admin check when no release team credentials are passed.

The branch now wires native builds through the existing
`.github/workflows/build-tauri.yml` candidate owner. Only its unsigned Apple
Silicon candidate selects the `self-hosted`, `macOS`, `ARM64`,
`cassian-happier-nightly` labels. Its Xcode step verifies **26.5** in
`/Applications/Xcode.app` and sets `DEVELOPER_DIR` for that job without changing
the host's global selection. Intel Mac, Linux, Windows and signing/publication
jobs keep their existing runners and environments; hosted Mac jobs retain Xcode
**26.2**. The nightly call forwards no signing or release App credentials and
requests preparation only, with publication disabled. Promotion depends on
successful completion of the reusable desktop workflow.

The three new Cassian workflow tests first failed on missing admission, routing,
and build gating, then passed. They execute the real admission shell against
trusted schedule/manual requests and reject PR contexts, other caller workflows,
different source SHAs, and signing phases. The adjacent focused run passed 23 of
24 tests: the prior source-promotion test still expects only two dependencies and
must be updated to require the new build dependency. The existing persistent-
runner security test also needs to recognize the conditional runner selection
and explicitly admit this guarded job. Those existing-test updates await Josh's
permission; this branch is not yet ready to merge. Actionlint passes for both
changed workflows when the already documented inherited findings are ignored,
including two SC2016 findings reproduced against the pre-Cassian workflow.
The exact new Xcode selection shell also ran successfully over SSH on Cassian,
reporting Xcode 26.5 and the intended job-local `DEVELOPER_DIR`.

No Cassian native build, runner registration, workflow dispatch, or nightly
execution has been verified yet. The runner installation is preparation for
that integration, not completion of the daily-driver release gate.

## GitHub activation and first acceptance

At setup inspection the fork had no registered Actions workflows/runs, repository
secrets, release environments or production branch protection. Local checks and
a pushed feature branch do not activate a nightly release.

The repository's external-write rule permits feature-branch pushes only, so the
following GitHub changes require Josh's explicit exception or his own action:

1. Merge the setup feature work and this OH-10 change into `dev` through reviewed
   PRs. Keep `dev` the default branch; do not merge into `main`.
2. Enable GitHub Actions for the fork and verify that canonical `tests.yml` push
   CI registers and succeeds on the resulting exact `dev` SHA.
3. Install a fork-owned GitHub App on **only** `omnia-digital/happier`, with
   Contents and Workflows write permissions. Configure its ID/private key as
   `RELEASE_BOT_APP_ID` and `RELEASE_BOT_PRIVATE_KEY` repository Actions secrets.
   Never reuse the parent's credentials or commit the key.
4. Add a production ruleset preventing ordinary updates, deletion and non-fast-
   forward updates. Allow only the installed release App to bypass update
   restriction. Do not add a PR requirement that would prevent its fast-forward
   promotion. Keep administrators' ability to change rules separate and explicit.
5. Dispatch the new workflow on `dev`, verify successful terminal CI/promotion,
   and read back `production` at the certified SHA. Exercise a no-green-CI attempt
   and confirm production remains unchanged.
6. Update the guarded local production clone, build and launch its Mac UI through
   the existing repo-local Stack launcher, and verify hosted login/session
   continuity before replacing the current daily app.

Native signing, updater feeds and app installation are not established by branch
promotion. Existing fork UI changes must reach `dev` before they can reach
production. The fetched parent `dev` is reviewed independently; nightly promotion
does not automatically merge parent updates or certify their compatibility.

The changes here are fork-specific repository operations, not a 0.2 protocol or
product fix to copy into the parent's `v0.3` branch. The fork has no active `v0.3`
release branch in this setup. Retain this workflow and its owners when the fork
eventually upgrades its development line.

References: [GitHub scheduling](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onschedule),
[enabling fork workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows),
and [GitHub App installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation).
