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

These are the only two permanent clones. Production never shares a Git directory,
working source, or a mutable `node_modules` symlink with development. Task
directories are temporary linked worktrees owned by `happier-dev`; neither
permanent checkout is a feature branch. A branch name alone does not certify its
starting commit as a tested release.

The old `/Users/Josh/Developer/Projects/Omnia/apps/happier` checkout is temporary
migration state. Its `chore/happier-fork-dev-setup` branch accumulated feature work
that was absent from the first GitHub `dev`/`production` release. Reconcile that
committed work through a PR into `dev`; do not call a release feature-complete
until its source contains the intended changes. Existing active and unpublished
work, linked worktrees, and running stacks still need preservation/migration
before this old checkout can be removed. Start no new tasks there.

Create ticket-named worktrees through the existing Stack owner, from `happier-dev`:

```sh
git pull --ff-only origin dev
node apps/stack/scripts/repo_local.mjs wt new OH-123-description --from=origin --base=origin/dev --deps=none
```

Implement and validate in that task worktree, commit and push its branch, and open
the PR with `--base dev`. After merge, fast-forward the clean `happier-dev`
checkout. Verify all task work is pushed and merged and no process, unsaved work,
or valuable ignored data depends on its directory before removing it through the
existing worktree cleanup tools. Do not use forced removal to discard unfinished
work. The nightly workflow then promotes tested `dev` source to `production`;
update the protected clone only through the helper below.

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

### Verified setup and remaining release gate

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
Use the bundled application described below instead of this development launcher.

The daily app has not been replaced. A bundled build also requires a mutable
source tree: dependency postinstall can generate UI source/assets, and Tauri's
build dependency creates `src-tauri/permissions/autogenerated`. External export
and Cargo output settings do not relocate all of those writes. Keep the permanent
production clone protected and build in a separate mutable checkout pinned to its
exact GitHub production commit. A feature worktree can prepare the candidate,
provided its source tree matches the promoted commit and its mutable dependencies
and outputs are separate from production. Do not use the development launcher in
the protected clone or bypass file flags to make it start.

The existing desktop updater had a build-time opt-out that Expo could not inline
because it used a dynamic environment-variable read. This change corrects that
read at the single updater owner. A regression test compiled the real updater
with the real production Babel configuration: disabled/enabled settings produced
identical output before the fix, then distinct inlined output after it. All nine
updater host tests pass, including automatic and explicit actions with updates
disabled. This does not yet verify a built native app.

After the fix reaches `production`, run the canonical bundled build from the
separate checkout, first verifying its HEAD equals the protected clone's HEAD:

```sh
env -u HAPPIER_STACK_ENV_FILE \
  HAPPIER_STACK_CLI_ROOT_DISABLE=1 \
  HAPPIER_STACK_DISABLE_STACK_ENV_AUTOLOAD=1 \
  HAPPIER_STACK_STACK=omnia-production-desktop \
  HAPPIER_STACK_REPO_DIR="$PWD" \
  HAPPIER_STACK_TAURI_SERVER_URL=https://api.happier.dev \
  HAPPIER_STACK_TAURI_DEBUG=0 \
  HAPPIER_STACK_TAURI_IDENTIFIER=com.omnia.happier.production \
  HAPPIER_STACK_TAURI_PRODUCT_NAME='Omnia Happier' \
  APP_ENV=production \
  EXPO_PUBLIC_HAPPIER_DESKTOP_UPDATES_ENABLED=0 \
  APPLE_SIGNING_IDENTITY=- \
  PATH="$HOME/.cargo/bin:$PATH" \
  ./apps/stack/bin/hstack-exec -- node apps/stack/bin/hstack.mjs build --tauri --tauri-production
```

`--tauri-production` selects the stable Tauri config and Omnia Happier artwork.
The explicit identifier keeps this local app's storage separate. Build and
verify a fresh bundle after this integration before adopting its output.

The local macOS 27 / Rust 1.94.1 build also required
`CARGO_PROFILE_RELEASE_STRIP=none CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_STRIP=none`.
Without these, dyld rejected compiler libraries with `mis-aligned LINKEDIT string
pool`, matching [Rust issue 157750](https://github.com/rust-lang/rust/issues/157750).
With them, the libraries loaded and the optimized release build passed. This is
a local toolchain mitigation; remove it when the installed Rust version fixes
that issue. The same focused probe passed without the mitigation on Cassian's
Xcode 26.5 toolchain, so its runner environment was not changed.

For an already verified matching dependency installation,
`HAPPIER_STACK_SKIP_REFRESH_DEPS=1` skips the redundant package-manager refresh;
Stack still checks component prerequisites. Do not use it to ignore missing or
outdated dependencies. Include the repository's pinned Node and Bun tools on
PATH as well as Cargo.

The local DMG packaging step failed after successfully compiling the app. A DMG
is not required to run the local bundle. The existing UI build owner completed
the app-only bundle using the already exported UI and generated Stack config:

```sh
env APPLE_SIGNING_IDENTITY=- \
  CARGO_PROFILE_RELEASE_STRIP=none \
  CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_STRIP=none \
  CARGO_TARGET_DIR="$HOME/.happier/stacks/omnia-production-desktop/tauri-target" \
  CI=false APP_ENV=production \
  EXPO_PUBLIC_HAPPIER_DESKTOP_UPDATES_ENABLED=0 \
  PATH="$HOME/.cargo/bin:$PATH" \
  ./apps/stack/bin/hstack-exec -- yarn --cwd apps/ui -s tauri:build:production \
  --bundles app \
  --config "$HOME/.happier/stacks/omnia-production-desktop/tauri.conf.happier-stack.json"
```

On 2026-10-23 the earlier pre-integration bundle completed at `13c80eb975d37505b6d394f738da7a32f7da53c8`.
The earlier UI export came from its tree-identical parent `f24db5a2ff`; the source
diff is empty. The bundle passed `codesign --verify --deep --strict`, and the
dedicated `com.omnia.happier.production` process opened its welcome/login window.
The actual exported updater module contains the inlined `"0"`, and the exported
server configuration contains `https://api.happier.dev`. These checks do not yet
establish authenticated session continuity or successful source promotion.

The persistent bundle destination is under
`~/.happier/stacks/omnia-production-desktop/tauri-target/release/bundle/macos/`.
Keep that stack and app identifier stable across updates. The explicit updater
opt-out prevents the normal app surfaces from consulting the inherited upstream
feed; this workflow does not publish a fork updater feed. Verify updater
suppression, hosted login and session continuity in the built app before adopting
it. `hstack stack install` is not the hosted-relay installation path: it also
configures local runtime services and a loopback relay.

The separate application identifier keeps local account storage distinct, so
connect the existing hosted account in the new app. Both stable apps currently
declare `happier://`; launch this bundle by its full path. After the first launch,
the observed default handler remained `/Applications/Happier.app`. Verify the
intended handler before relying on external login/deep links in the fork app.

## Latest development integration

The follow-up desktop integration includes committed product work through
`e658d2b024`: indexed palette content search, ticket linking/status, machine
monitoring, independent status grouping/sorting, and session PR links. The
source is assembled in a temporary worktree owned by `happier-dev` and reaches
`dev` through its pull request. Uncommitted work in the old checkout is not part
of this build.

OH-5 commits `85bef2bda8` and `f4c093c9cd` remain deferred. Their unfinished
signing/feed admission changes reject the unsigned preparation used by the
existing nightly promotion workflow. This integration reverses those two
commits while preserving their original branch and the product features.
When OH-5 is complete, explicitly reintroduce the reviewed changes; ancestry
alone will not reapply reverted commits. The current nightly continues to
promote source after CI and unsigned native builds, with app updates disabled.

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
and `bin/Runner.Listener --version` succeeded. At the 2026-10-23 activation
checkpoint it is registered as **cassian-happier-nightly**, runner ID **1446**, in
**happier-nightly**, group ID **3**. Its dedicated launchd service is
`actions.runner.omnia-digital.cassian-happier-nightly`; the service log reports
connection to GitHub and **Listening for Jobs**. Existing Guitar Tricks and Omnia
Church Platform runner services were left unchanged.

Josh configured the organization runner group and confirmed both repository and
workflow restrictions below. A short-lived organization registration token was
used for setup; no personal access token was copied to Cassian. The selected
`andorcassian` account has repository Write access but cannot query the runner
inventory or administer runner groups through its PAT. Group restriction
configuration is confirmed by Josh; the registered group identity and service
connection were independently read back on Cassian.

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
that account from the other CI services. The canonical actor guard explicitly
trusts the selected `andorcassian` operator only after Cassian admission passes.
Other desktop workflows retain their existing actor policy. Scheduled runs can
have a human actor; an unlisted non-admin actor fails visibly. No release App or
signing secrets are forwarded to the unsigned build workflow.

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
different source SHAs, and signing phases. Josh approved the existing-test
updates: the promotion contract now requires the native build dependency, and
the persistent-runner scan recognizes conditional label selection and requires
the guarded desktop build in its explicit allowlist. The focused run passed all
24 tests. Two further existing schedule assertions were updated to preserve
their release/status and explicit database-selection guarantees alongside the
fork guard; the combined focused run passed **39/39**. Actionlint passes for both
changed workflows when the already documented inherited findings are ignored,
including two SC2016 findings reproduced against the pre-Cassian workflow.
The exact new Xcode selection shell also ran successfully over SSH on Cassian,
reporting Xcode 26.5 and the intended job-local `DEVELOPER_DIR`.

The actor-admission follow-up first failed on the missing scoped trusted-actor
input, then passed after configuring that existing input. It also executes the
real actor guard without privileged credentials, accepting the named operator
only with the Cassian actor list and rejecting an unlisted actor. All **23**
focused Cassian, promotion, secret-hardening and actor-guard checks pass, as does
workflow lint with the same inherited exclusions.

After independently copying the matching dependency installation with APFS
copy-on-write and rebuilding shared package outputs, the broader release-contract
lane completed with **1,662 passed, 3 failed and 24 skipped** on macOS. Two failures
require the unavailable Linux `dpkg-deb` command; the existing installer static-art
PTY assertion also fails when run alone. The installer implementation and its
test are unchanged by this branch. The complete local lane is not green. The
full hosted [PR CI run](https://github.com/omnia-digital/happier/actions/runs/40023454842)
subsequently passed for `f999a3ec071d14ce69488301eac353f48c5e4fd1`, including Release
Contracts and all selected platform/test lanes. Each later source commit still
requires its own applicable CI evidence.

No successful Cassian native build or production promotion has been verified at
this checkpoint. The live [negative-case run](https://github.com/omnia-digital/happier/actions/runs/40031169026)
was dispatched for `30762cf988708230cd4302d040f145c7f8a34209` while its canonical push
CI was pending. It failed at the missing-successful-CI check, skipped all three
downstream jobs, and a GitHub read-back confirmed production remained at
`98dab9837ab4f918cb9be86095eca8ebe6136c25`.

## GitHub activation and first acceptance

This section records the **2026-10-23 setup checkpoint before the first successful
production release**, not a continuously updated deployment dashboard. Use the
linked Actions runs and branch refs for current state.

Josh approved the following GitHub activation steps and selected `andorcassian`
as the GitHub API actor for this setup, overriding the inherited bot requirement.
That credential's identity and repository Write access are verified. Josh elected
to perform admin-only configuration himself, keeping the PAT at its existing
permissions. Repository ruleset writes and organization runner administration
remain outside this account's access; classic PAT runner-group API access also
requires `admin:org`.
Ordinary feature-branch commits and pushes continue using the machine's configured
Git identity. No credential is stored in the repository.

[PR #1](https://github.com/omnia-digital/happier/pull/1) merged into `dev` after its
full CI passed, producing `30762cf988708230cd4302d040f145c7f8a34209`. The permanent
dev clone fast-forwarded to that commit. Its separate canonical push CI and the
scoped actor-admission follow-up are release gates.

The fork-owned **omnia-happier-release** App, ID **5448093**, has Contents and
Workflows write permissions. Josh confirmed installation only on this repository;
the two Actions secret names were read back successfully without reading values.
Active **Production History** ruleset **25757440** protects `production` and
`main` from deletion and non-fast-forward updates. **Production promotion**
ruleset **25757480** restricts production updates; Josh confirmed its only bypass
is the release App with Always allow. The effective production rules were read
back through GitHub. This non-admin account cannot read the bypass list itself.

1. Merge the actor-admission follow-up into `dev` through a reviewed, tested PR.
   Keep `dev` the default branch; do not merge into `main`.
2. Verify canonical `tests.yml` push CI succeeds on the resulting exact `dev` SHA.
3. Install a fork-owned GitHub App on **only** `omnia-digital/happier`, with
   Contents and Workflows write permissions. Configure its ID/private key as
   `RELEASE_BOT_APP_ID` and `RELEASE_BOT_PRIVATE_KEY` repository Actions secrets.
   Never reuse the parent's credentials or commit the key.
4. Keep production history protection in its own active ruleset with no bypass.
   In a separate active ruleset, restrict updates and allow only the installed
   release App to bypass that restriction. Each branch target is a separate
   entry. Do not add a PR requirement that would prevent fast-forward promotion.
5. Dispatch the new workflow on `dev`, verify successful terminal CI/promotion,
   and read back `production` at the certified SHA. Exercise a no-green-CI attempt
   and confirm production remains unchanged.
6. Update the guarded local production clone, build the identical commit in the
   separate mutable checkout through `hstack build --tauri`, and launch its
   bundled Mac UI. Verify updater suppression and hosted login/session continuity
   before replacing the current daily app.

Native signing, updater feeds and app installation are not established by branch
promotion. Existing fork UI changes must reach `dev` before they can reach
production. The fetched parent `dev` is reviewed independently; nightly promotion
does not automatically merge parent updates or certify their compatibility.

The release workflow and checkout guards are fork-specific repository operations.
The updater environment read also fixes a product build defect. Read-only
inspection of upstream `v0.3` at `e82253f97ab991aebdf69ea16bb2ab209b59ccb8` found the
same dynamic read in its evolved desktop updater owner. The fork has no active
`v0.3` release branch, so that counterpart remains unported; carry the static-read
fix through that owner when adopting it. The latest inspected parent `dev`,
`413054f17c814f2b2a3ad6159d38eff2230b9c4d`, adds desktop setup upgrade-test changes
outside this unsigned preparation path; it does not require a merge for this setup.

References: [GitHub scheduling](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onschedule),
[enabling fork workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows),
and [GitHub App installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation).
