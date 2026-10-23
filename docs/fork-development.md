# Omnia Happier development and adoption

This is the fork-specific runbook for `omnia-digital/happier`. Develop against an isolated local stack and qualify macOS desktop first for daily work. Windows and iOS remain later platform targets; iOS is explicitly deferred until the macOS app works the way Josh wants. Native Mac compilation, hosted session messaging, permission rejection and authentication/session reconnect across a full native restart are verified. Packaged distribution and daily-use cutover remain open.

## First adoption: custom macOS UI, existing Happier services

Josh prefers to keep his current hosted account, relay, machines, CLI/daemons and sessions, and adopt only the forked macOS UI/app. Use that as the first daily-use target. Keep the isolated local relay/account for development tests and the original installed app for rollback. Self-hosting, account migration and source CLI pairing are not prerequisites for this UI-only path.

The installed app reports 0.2.17 and the installed CLI 0.2.16. The hosted relay's `/v1/features` responds, and an actual `OPTIONS /v1/auth/ping` preflight allows the dev origin and authorization/content-type headers. The checked `/v1/version` returns only `ok`, so its exact deployed revision remains unknown. These checks establish reachability and the checked browser seam, not authenticated mixed-version session compatibility.

Added `https://api.happier.dev` as **Happier Cloud** through the forked app's normal Relay settings and selected existing-account sign-in. The local test profile remains saved separately. No hosted account was created and no recovery key was copied. The hosted profile authenticates successfully (`GET /v1/auth/ping` returns 200), existing sessions and machine groups populate, and selecting this Happier work session opens its transcript and composer. Full scoped native stop/start preserves hosted authentication and reloads existing sessions; the installed app and authenticated daily daemon remain running. The old `/restore` route remained open after authentication; selecting the sidebar session dismissed it. The foreground QR panel renders correctly.

### Native hosted session acceptance

Created a dedicated session through the forked app on the existing Mac daemon, using only `/private/tmp/happier-oh6-hosted-ui-g69n0umk`, with No Worktree selected. Its real agent reply returned the expected smoke marker; the Git panel showed the scratch README, and the agent's read/write results were verified directly on disk. Switching that scratch session to Read Only prevented the requested write. No messages or commands were sent to an existing work session.

For permission QA, the user's Claude configuration defaults to bypass permissions, and Auto can approve benign work. Those runs do not establish a manual approval. A scratch-local `.claude/settings.local.json` sets `permissions.defaultMode` to `default` and adds Write/Edit ask rules; global settings and credentials are unchanged. A fresh installed-CLI test process against that folder produced a real permission card in the forked native app. Before resolution, the provider reported one pending request and the file was absent. The file subsequently appeared with the expected exact content and an agent completion record; the app changed to Auto while the attempted one-time click found no button, so that resolution cannot be attributed to our one-time approval click.

A second requested scratch write was rejected through the native card's **No** action. The provider transcript records an error result saying the tool use was rejected, pending requests return to zero, and `denied-once.txt` remains absent. This proves native request publication and rejection delivery without treating the test prompt's expected text as an agent acknowledgment. A private native screenshot is retained at `/tmp/happier-oh6-real-permission-pending.jpg`; it includes personal sidebar context and is not committed or uploaded.

An independent boundary review correctly identified that rejection alone does not prove the distinct Allow response. A fresh write to `approved-second.txt` closed that gap: the file was absent and provider pending count was one; the native card showed that exact filename; a route-and-filename-guarded click on the one-time **Yes** button succeeded. Afterward the exact content `HAPPIER_SECOND_APPROVAL_OK\n` was present, the provider returned the actual agent reply `HAPPIER_SECOND_APPROVAL_COMPLETE`, and pending count returned to zero. The permission chip remained Auto and no mode control was changed during this test; the scratch-local Write ask rule still required the explicit response. The rejected file remains absent. The earlier ambiguous approval observation remains historical rather than being relabeled as a successful click.

The initial process-level `--setting-sources project,local` attempt did not isolate settings: the inspected remote launch path forwards setting-source selection from its own mode metadata rather than that raw CLI argument. Scratch-local configuration is the verified QA recipe. One stopped test process exited through the canonical session-stop command; no daily daemon/service was stopped.

After a further canonical UI-only stop/start, hosted ping remains 200 and the dedicated QA process remains active with no pending permission requests. Opening that session reloads its transcript; a new message sent through the native composer received the exact agent response `HAPPIER_RECONNECT_OK`, verified both in provider history (`role=agent`) and as a visible native transcript element. The installed original app remains running and its CLI still reports authenticated with daemon running. Current UI typecheck passes (exit 0; `/tmp/happier-oh6-current-ui-typecheck.log`).

The running native app also handles `deep-link://new-url` with a `happier:///session/...` payload and navigates to the target QA session, including after restart. The existing deep-link owner suite passes all six tests (`/tmp/happier-oh6-deep-links-tests.log`). This proves the warm native event handler; macOS URL-scheme registration and cold launch remain packaged-distribution checks.

Josh explicitly chose **Keep it disabled; defer terminal QA**. Embedded Terminal stays disabled; no shared account experiment preference was changed. Terminal QA is deferred and is not an immediate UI-only adoption prerequisite. Packaged installation, signing/notarization, fork-owned update identity/feed and cold OS deep-link acceptance remain release gates.

Independent review confirmed the final positive file bytes, actual agent history and cleared pending state, resolving its sole acceptance finding. OH-6's current UI-only development gate is complete, so the requested macOS workflow tickets can proceed against this baseline. This is not a packaged release or daily-use cutover; OH-5/OH-11 and the failed original root-suite inventory remain open.

### Launch only the forked Mac UI

From this checkout, use the existing repo-local launcher against the hosted relay:

```sh
node apps/stack/scripts/repo_local.mjs dev --tauri \
  --no-server --server-url=https://api.happier.dev --no-daemon \
  --no-browser --no-dev-targets --loopback
```

This starts Metro and the scoped native app without starting a relay or daemon. Stop it through `node apps/stack/scripts/repo_local.mjs stop --json`. The local account and relay data stay on disk. The restored launch reused verified dependencies with the one-shot `HAPPIER_STACK_SKIP_REFRESH_DEPS=1`; omit that shortcut whenever dependency inputs changed. The prior full-stack log reported `ENOSPC`; the exact shutdown cause is not established. Current available storage is approximately 18 GiB, so avoid unnecessary duplicate builds.

### Current validation checkpoint

At source revision `410a7b0703`, eight previously failing CLI files pass unchanged: 86 tests covering Git checkout/materialization/reconciliation/status, review scope, capability probe cwd and build cleanup. The subprocess test environment uses `TMPDIR=/private/tmp` and `GIT_CONFIG_GLOBAL=/dev/null`, so disposable fixture repositories do not inherit the host's interactive signing configuration. Actual feature-branch commits retain configured signing and identity. All four server Sharp runtime checks also pass with canonical TMPDIR and the privately pinned Bun 1.4.2. Logs: `/tmp/happier-oh-4-cli-fixture-validation.log` and `/tmp/happier-oh-4-server-bun-validation.log`. These targeted reruns classify environment failures; the original full-root result remains failed.

Fetched parent `dev` at `e7c3bd5584`: 31 new commits are not integrated yet. Read-only review finds no path overlap with the fork's Metro, Tauri cleanup or installer corrections. The new Claude prompt-location settings are not understood by the installed CLI 0.2.16, so their mixed-version behavior requires validation before adoption. The parent desktop release bump also retains upstream distribution identities. Keep this batch unmerged pending its affected tests and compatibility checks; do not replace the hosted relay or daily daemon to accommodate it.

OH-6 now owns the hosted UI-only acceptance gate. OH-14 through OH-19 follow that stable Mac gate; their former OH-4 local-stack prerequisite was removed, preserving their other UI dependencies. OH-9 hosting/migration is deferred and OH-11 remains a later all-platform rollout. Keep shared settings and session writes compatible with the installed clients; negotiate unavailable hosted features rather than require a server/daemon migration.

## Session workflow improvements

OH-15 is implemented through `0ed0585e79` on the setup feature branch. Desktop/web session right-click opens the same dropdown as the three-dot button without navigating. Actual native QA compared all ten action IDs/labels/order, exercised selected and unselected rows, dismissed with Escape, and renamed only the right-clicked scratch session before restoring its title. Full reload with Fast Refresh disabled loaded the change. The four relevant test files pass (23 tests), UI typecheck passes, and independent review reran those tests with no material findings (`/tmp/happier-oh15-review-tests.log`). Restricted shared-row availability is host-tested; no suitable hosted view-only QA fixture was available for live testing. Exact keyboard-origin focus return was not observed. This feature is pushed for development; it is not merged or distributed as a release.

## Repository and change flow

Planning lives in Linear team **Happier (OH)**, in [Happier fork — development and first stable release](https://linear.app/omniachurchapps/project/happier-fork-development-and-first-stable-release-9a3eb3200232). Use OH issue IDs for future task branches and link evidence to the owning issue. The initial backlog is OH-1 through OH-12, with milestones for development readiness, native app validation, and daily-use release readiness. OH-12 owns ongoing upstream maintenance. OH-10 tracks CI and Linear release-pipeline setup; no release pipeline is configured yet.

Current external-write policy allows Linear planning and git pushes to the task's feature/PR branch. GitHub UI/API writes, including PR creation, merges, settings and workflow dispatch, remain user-owned unless separately authorized.

- `origin`: `https://github.com/omnia-digital/happier.git`
- `upstream`: `https://github.com/happier-dev/happier.git`
- Development base and PR target: `dev`.
- Setup branch: `chore/happier-fork-dev-setup`.
- Local checkout: `/Users/Josh/Developer/Projects/Omnia/apps/happier`.

Create ticket-named feature branches from the fork's current `origin/dev`. Commit and push completed steps, including their plan documents. Review upstream changes on a feature branch and merge through a PR into the fork's `dev`; do not automatically overwrite fork changes. Use `preview` for a tested release candidate and promote through the repository's branch model when release automation is ready. A fast-moving upstream `dev` snapshot is not a stable daily-use release.

The full clone includes upstream history; fetch updates without changing the working tree:

```sh
git fetch origin
git fetch upstream
git log --oneline origin/dev..upstream/dev
```

### Standing upstream maintenance policy

Check the parent repository at the start of each Happier work session and before preparing a release candidate. Fetch upstream changes regularly and bring compatible improvements into the fork; maintaining our modifications is part of accepting an update.

1. Fetch `origin` and `upstream`, compare their `dev` branches, and inspect relevant upstream commits and release notes.
2. Integrate updates on a dedicated feature branch based on the fork's `origin/dev`. Preserve both sides' required functionality when resolving conflicts, including Omnia identities, update destinations and configuration.
3. Run affected tests, typechecks and builds. Exercise changed platform paths on iOS, macOS and Windows as applicable, plus the cross-device session flow before release adoption.
4. Merge through a reviewed PR into the fork's `dev` only after required validation passes. Promote daily-use releases separately through the adoption gates below.
5. When an update breaks the fork or required verification is unavailable, keep it unmerged and record the upstream revision, failing or missing checks, and next action. Revisit it in the next work session.

This is a standing work-session routine; no unattended scheduler or automatic merge job is installed. Fetching updates does not change the working tree or certify compatibility.

## Development prerequisites

Use the committed Yarn lockfile and Yarn 1.22.22. This Mac currently has Node 24.20.0 and Xcode 27.1. Keep native toolchains aligned with the repository rather than independently upgrading them.

| Target | Required tools and acceptance environment |
| --- | --- |
| Web, server, CLI | Node, Yarn, Git; installed workspace dependencies; matching local server and clients |
| macOS desktop | Rust via rustup, Xcode tools, repository Tauri toolchain (`apps/ui/rust-toolchain.toml`, currently 1.94.1); actual macOS window/session testing |
| iOS | Xcode, working CocoaPods, simulator; an Apple signing team and physical iPhone for device acceptance |
| Windows desktop/daemon | Windows machine, Node/Yarn/Git, Rust MSVC toolchain, Microsoft C++ Build Tools and WebView2; actual Windows window/session testing |

See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for platform installation requirements. Windows native builds and behavior must be tested on Windows; a Mac web build does not establish Windows support.

At initial setup the Mac had approximately 9 GiB free after cloning. Dependency installation and native builds are deferred until storage is resolved. Rust is absent from PATH. `/usr/local/bin/pod --version` crashes in the existing system-Ruby CocoaPods installation; repair that toolchain before running iOS prebuild. Do not use `--ignore-scripts` or omit native patches to make a partial install appear ready.

## Daily source workflow

Once storage and toolchains are ready, run from the repository root:

```sh
yarn install --frozen-lockfile
yarn dev
```

In another terminal, use repository scripts to authenticate and operate this checkout:

```sh
yarn auth login
yarn happier -- --help
yarn logs -- --component=server --lines 100 --no-follow
yarn stop
```

For interactive development, use `yarn tui`. Desktop development uses `yarn tui:with-tauri`; mobile development uses `yarn tui:with-mobile`. These are alternative launch modes, not commands to launch concurrently against one stack. Follow [repo-local mode](../apps/docs/content/docs/self-hosting/repo-local.mdx) for their full lifecycle.

The canonical launcher is `apps/stack/scripts/repo_local.mjs`. It chooses a `repo-*` stack with scoped state under `~/.happier/stacks/`, a scoped CLI home, and local ports. Git metadata owns the stack identity: linked worktrees can share that identity. Do not assume every worktree has independent runtime state; use the existing named-stack workflow when separate concurrent runtimes are required.

Before first launch after installation, inspect `node apps/stack/scripts/repo_local.mjs dev --dry-run` and confirm it resolves this checkout and a scoped stack. Then verify the actual running server/UI/daemon and their loaded source. Dry-run success alone is not a live check.

Use the matching local dev server with this dev checkout. Upstream's hosted stable server is not the acceptance target for dev functionality. A phone or second computer needs a reachable server URL; `localhost` points back to that device. Metro also needs phone reachability during iOS development. Choose LAN/Tailscale reachability deliberately before configuring remote clients.

Keep the installed daily-use CLI and app until acceptance passes. `yarn cli:activate`, `yarn cli:activate:path`, and `yarn service:*` change command selection or persistent services and belong to the later cutover, not the initial source smoke test.

## iOS ownership and build path

Start with simulator development, then a signed local development client on an iPhone. Use TestFlight for convenient ongoing use after native and session acceptance. An App Store listing is not required to begin simulator development.

For TestFlight, create an app record in **App Store Connect**, backed by an explicit bundle ID in the Apple Developer team. This is the developer account attached to the Apple ID, not an iCloud application setting. Confirm the team and bundle ID before registration; `com.omniadigital.happier` and `com.omniadigital.happier.dev` are proposed names only, with availability unverified. See [Apple's app-record instructions](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/).

The fork needs its own Expo/EAS project for cloud builds, OTA updates and push credentials. Existing hooks in `apps/ui/app.config.js` accept `EXPO_APP_OWNER`, `EXPO_APP_SLUG`, `EXPO_EAS_PROJECT_ID`, `EXPO_APP_NAME`, `EXPO_APP_BUNDLE_ID`, `EXPO_APP_SCHEME`, `EXPO_UPDATES_URL`, and `EXPO_UPDATES_CHANNEL`. Configure the selected server via `EXPO_PUBLIC_HAPPY_SERVER_URL` and verify the evaluated config before building. Keep signing keys and tokens out of Git.

Review both the final app config and the selected EAS profile: `apps/ui/eas.json` contains upstream bundle IDs, server defaults, and submission identities. Merely forking the repository does not transfer those accounts or make these profiles safe to submit. Configure Omnia build/submission profiles before EAS build, update or submit commands.

The existing local dev-client helper supports explicit identity flags:

```sh
yarn mobile-dev-client -- --install --bundle-id=com.omniadigital.happier.dev --app-name="Happier Omnia Dev" --scheme=happier-omnia-dev
```

This is a future command after bundle ownership, Expo project configuration, signing, disk capacity, and CocoaPods are ready. Verify the helper's evaluated Expo slug/project pair: `buildMobileDevClientInstallInvocation` clears `EXPO_APP_SLUG`, so an environment-only slug override is not sufficient for a differently named fork project. Resolve that at the existing project-identity owner before EAS use. Keep Metro's dev-client scheme consistent with the installed app. See [mobile workflow](../apps/docs/content/docs/hstack/mobile-ios.mdx) and [custom mobile builds](../apps/docs/content/docs/apps/custom-mobile-build.mdx).

## Desktop distribution and update ownership

macOS and Windows share the Expo UI inside Tauri. Development uses the existing stack Tauri launcher; distribution is a separate release task.

Before producing daily-use installers, configure fork-owned application identifiers, display names, URL schemes, update feed and signing trust. `apps/ui/src-tauri/tauri.conf.json` currently points to the upstream desktop update feed and public key. Inspect variant overlays as well as the base configuration. The CLI/setup sidecars and their installer/update destinations also need review so an Omnia desktop app does not install or update back to upstream binaries unexpectedly.

For macOS distribution, configure the Apple signing identity and notarization. For Windows, build and test the installer on Windows and configure signing for trusted distribution. Retain the previous known-good installer and server backup. Do not test rollback by downgrading a database without validating migration compatibility.

## Validation and adoption gates

Use the repository's existing test lanes and release tooling; do not add a parallel test runner. After dependency installation, begin with:

```sh
yarn test
yarn typecheck
```

Then run affected integration lanes and live acceptance. Existing CI includes macOS and Windows installer/service lanes and mobile E2E. Audit fork workflow permissions, runner availability, upstream repository references and secret requirements before enabling or dispatching it. For fork installer evidence select `local-build`, not the manual workflow's default `published-channel`, which can exercise upstream artifacts. Existing CI definitions are not proof that the fork has passed them.

| Gate | Required evidence before daily-use cutover |
| --- | --- |
| Local source stack | Server health; UI loads in Chrome; authenticate; start a real agent session; send/receive messages and approvals |
| macOS | Native app opens; CLI/daemon pairing; terminal, filesystem/Git, resume after app restart, deep links |
| Windows | Native install and launch; CLI/daemon pairing; PowerShell and paths with spaces; terminal, approvals, reboot/resume |
| iOS | Simulator smoke plus physical-device sign-in, pairing, session control, background/foreground, reconnect, push and deep links |
| Cross-device | Same account and server on all three devices; continue one session between them without lost messages or duplicate work |
| Updates and rollback | Fork-owned feed/signatures; upgrade preserves account/settings/session access; previous version and data recovery tested |

For first UI-only macOS adoption, qualify the native app against the existing hosted account and installed runtimes, including real session actions, approvals, restart/reconnect and coexistence. The local source-stack lane is separate; no hosting/account migration or fork CLI/service activation is required. Qualify distribution identities, updates and rollback before adopting a distributable fork. Windows, iOS and cross-device gates apply when those platforms enter the rollout. If hosting is changed later, choose a durable reachable host and test account/session migration separately; a local server on a sleeping laptop is not an always-available relay.

### Fork CI and Linear release tracking audit

The existing `.github/workflows/tests.yml` is the read-only PR validation entry point. It selects UI unit/integration, web E2E, typecheck and web build lanes, with conditional macOS installer smoke. That installer lane does not compile or launch the native Mac UI. No native Mac candidate job exists in ordinary PR validation.

`.github/workflows/build-tauri.yml` owns native candidate and distribution builds. Its trusted-ref and release-actor guards require a trusted `dev`/`preview`/`main` workflow, the release-admins team and release-bot app credentials even when publication is disabled. Finalization requires the updater signing key; production Mac distribution additionally needs Apple signing/notarization credentials. Do not use it as an unprivileged feature-branch smoke test or bypass its guards.

The parent Tauri configurations still contain upstream application identifiers, updater public key and `happier-dev/happier` update feeds, while the release workflow publishes under its invoking repository. Choose the fork's identity, key and feed together before distribution. Keeping the hosted API URL is intentional for UI-only adoption; retaining the installed CLI also avoids changing its installer/update ownership now.

Linear reports no OH release pipelines. Its current release documentation requires a pipeline-specific access key, not a personal API key. Create pipelines for independently built/shipped products and channels; stages are for one immutable build advancing through gates. Add reporting to the actual successful build/publication path, never merely a source push or a local debug launch. Pipeline creation, secure key installation and an actual reported build/release event remain pending. GitHub writes are still limited to this task's feature-branch pushes, so repository settings, secrets, merges and workflow dispatch remain user-owned. No CI dispatch, release record, signing identity or pipeline key was created during this audit.

## Initial verification record — 2026-10-22

- Full clone completed; feature branch and plan checkpoint pushed to `origin`.
- Two dependency-free tests passed: root repo-local script wiring and Git-owned stack identity preservation.
- Twelve additional tests passed for local mobile identity overrides and desktop channel deep-link configuration; these validate existing tooling, not a native app launch.
- The initial broader setup run reported 2 passed / 6 failed: launcher/provider checks could not load uninstalled `@happier-dev/cli-common`; dependent spawn assertions consequently failed. No tests were changed.
- Dependency install, full tests/typecheck, live stack, native builds, Windows and physical-iPhone acceptance: **blocked/unrun** pending setup prerequisites above.
- No app publication, service replacement, account migration, or release cutover was performed.
- Independent source/documentation review found no material errors in the workflow; all three local runbook links resolve and `git diff --check` passes. This review does not close the runtime or platform gates.

## Setup continuation — 2026-10-22

Setup resumed after free space increased to approximately 14 GiB. Locked workspace dependency installation is being attempted, with native builds still pending its result and available storage. Upstream and fork `dev` were fetched again and remain identical.

CocoaPods 1.17.0 is now installed for the user under Homebrew Ruby 3.3.5; `/Users/Josh/.gem/ruby/3.3.0/bin/pod --version` succeeds. The old `/usr/local/bin/pod` remains untouched. Select the working toolchain for this shell before native commands:

```sh
export PATH="$HOME/.gem/ruby/3.3.0/bin:/opt/homebrew/opt/ruby/bin:$HOME/.cargo/bin:$PATH"
pod --version
```

Rust and Cargo 1.94.1 now verify successfully, with rustfmt and clippy installed. OH-3 is complete for toolchain readiness; native compilation remains unverified.

The Mac dependency install was interrupted twice as downloads consumed available disk capacity; it did not complete. `yarn cache clean` reclaimed the downloaded package cache and returned free space to approximately 15 GiB. The attempted SSD worktree could not be created because the attached Extreme SSD is a protected Time Machine volume; no source files were moved there. A local `feature/OH-2-run-happier` branch was created at `origin/dev` by that failed worktree attempt and has no task edits.

SSH access to `josh-pc` is verified. Its C: drive had about 165 GiB free; Node 24.19.0 and Git 2.43.0 are present. The separate clone at `C:\Users\Admin\Developer\Projects\Omnia\happier` is on the setup branch. `corepack yarn install --frozen-lockfile --link-duplicates` completed successfully in 516 seconds. Rust/Cargo 1.94.1, rustfmt, clippy, and Visual Studio C++ tools are present. Native compilation remains unverified.

The first Windows launcher run reported 18 passed, 3 failed, and 1 skipped. Two provider-spawn tests could not read their capture files; the dependency auto-install test uses a Unix executable fixture and colon-separated PATH, which is not portable to Windows. No tests were changed. Actual startup stopped at a missing compiled `@happier-dev/cli-common` export. The existing command `node scripts/workspaces/ensureWorkspacePackagesBuiltCli.mjs --for-component=apps/stack` then successfully built protocol, agents, release-runtime, cli-common, and connection-supervisor. Rerunning the launcher tests still reports 18 passed, 3 failed, and 1 skipped. Corepack Yarn shims were installed in the Windows user's `.local\bin`; add that directory to the current shell PATH for builds.

The launcher dry run resolves `repo-happier-181979f2a7` and its scoped CLI/state directories, rather than the main stack. Windows installation regenerated four tracked UI WebView bundle files; these are preserved in that checkout and have not been committed. The Mac checkout stays in place. Next: finish shared-package compilation, rerun affected checks, start the isolated stack, and verify it through Chrome. Mac/iOS native builds still need sufficient local storage. Neither native builds nor live session behavior has been verified yet.

## Current priority — macOS desktop first

Josh confirmed macOS desktop is his primary interface. Prioritize launching and validating the fork on this Mac, then refine the desktop workflow from his feedback. Defer iOS builds, simulator work, signing and App Store setup. Windows setup is available for later work, but does not establish Mac readiness. Mac dependency installation and launcher checks are now verified; native startup and live acceptance are next.

The Mac has 64 GiB of RAM with substantial observed memory headroom. A new, empty 16 GiB RAM disk was created and mounted at `/Volumes/HappierBuildRam`; no existing disk or simulator data was erased. Locked installation completed successfully in 471.66 seconds with its cache on that temporary volume:

```sh
yarn install --frozen-lockfile --link-duplicates --cache-folder /Volumes/HappierBuildRam/yarn-cache --network-timeout 600000
```

The install kept downloaded cache files off the internal disk and installed dependencies into this checkout. Free disk space increased during installation and now verifies at approximately 55 GiB. The temporary RAM disk was detached after Yarn exited successfully. A temporary empty native-target link was removed, so the native target remains on persistent storage under the scoped stack. No simulator cleanup was needed or performed.

The canonical shared-package build command reported all stack dependencies already current after installation. All 22 checks in `root_package_repo_local_scripts.test.mjs`, `repo_local_wrapper.test.mjs`, `utils/stack/repo_stack_identity.test.mjs`, and `repo_local_effective_db_provider.test.mjs` passed on Mac. No tests or application source were changed.

The Mac dry run resolves stack `repo-happier-42a434c316` and state under `/Users/Josh/.happier/stacks/repo-happier-42a434c316`. Its environment explicitly disables automatic account seeding and credential migration, and names the dev window `Happier Omnia Dev`. Native target directory: `tauri-target` within that scoped stack. Next launch:

```sh
node apps/stack/scripts/repo_local.mjs dev --tauri --no-browser --no-dev-targets --loopback
```

This is an attempt at live development startup, not yet proof of a running desktop app or a daily-use release.

The first startup populated the canonical stack-specific package-manager cache and admitted dependencies before starting services. The separate locked Cargo fetch completed successfully. Another 21 existing Tauri launcher/configuration checks passed, covering native target scoping, dev URL/configuration, identity overrides, and Cargo discovery. These checks do not establish native compilation or window behavior. The active startup log is `/tmp/happier-oh-6-macos-dev.log`.

The first stack refresh completed, but daemon startup correctly required credentials for the new isolated account. Guided-auth startup is now running with one-shot `HAPPIER_STACK_AUTH_FLOW=1` and `HAPPIER_STACK_SKIP_REFRESH_DEPS=1`; the latter reuses the just-verified installation without repeating package refresh. Do not persist that refresh override or use it when dependencies have changed. The refresh made serialization-only lockfile changes (same versions/checksums); those task-generated changes were reversed and the tracked lockfile matches its original bytes.

Server health passes at `http://127.0.0.1:52263/health`, with Metro on `http://localhost:18339`. The native `dev` build succeeded in 2m 35s and launched `/Users/Josh/.happier/stacks/repo-happier-42a434c316/tauri-target/debug/app` as `Happier Omnia Dev`, identifier `com.happier.stack.repo-happier-42a434c316`. Initial UI bundling failed: the workspace-node_modules blockList in `apps/ui/metro.config.js` incorrectly matches root dependencies when the checkout itself is beneath an `apps/` directory. The correction and live replay are recorded below. Current combined log: `/tmp/happier-oh-6-macos-dev-auth.log`.

The Metro exclusion is now anchored to this checkout's escaped root. The new regression reproduced RED using a real relocated checkout beneath `apps/happier[dev]+(fork)`, then passed after the correction. All 27 tests in four neighboring Metro suites passed, as did UI typecheck. Independent review found no material issues and independently reran the regression. Existing tests were not changed.

Live replay after a scoped stack restart successfully bundled the UI (11,394 modules). The Tauri QA bridge confirmed a visible native `main` window at `http://localhost:18339/`, and a native WebView screenshot shows the welcome/account screen using relay `localhost:52263`: [native macOS welcome screen](verification/OH-6-macos-welcome.png). This verifies native launch and rendering; pairing, authenticated session control, reconnect and daily-use acceptance are still pending. A separate local test account requires user approval before UI creation; no existing account data has been imported.

The generic computer-use transport failed during QA. The repository's existing `tauri:mcp:cli` driver connected on port 9223 and successfully read window metadata, found the rendered body and captured the screenshot. The installed bridge is older than the current CLI, so its accessibility snapshot reports a missing aria-api library; body lookup and screenshot capture work. No bridge upgrade or global automation configuration change was made. The original Tauri dev child also remained alive after the scoped stop, so clean native shutdown/restart needs further checking before claiming lifecycle acceptance. Current stack log: `/tmp/happier-oh-6-macos-dev-fixed.log`.

The root `yarn test` lane is running at `/tmp/happier-fork-root-test.log`. Completed package lanes already report 25 failing tests: 18 in cli-common, 5 in bootstrap, and 2 in the website. Observed failures include `/var` versus canonical `/private/var` path comparisons, case-sensitive Windows path expectations on the Mac filesystem, provider update classification, discovery of the installed CLI, and missing separate shipped/unreleased website source trees. This is a partial failure inventory, not a completed root result or proof that every cause has been diagnosed. No existing tests were changed. Other lanes are continuing. Root `yarn typecheck` completed successfully (exit 0); log: `/tmp/happier-fork-root-typecheck.log`. UI-only typecheck also passed.

The native shutdown defect is corrected in `apps/stack/scripts/tauri_dev.mjs`: its inner Tauri launch now inherits the outer helper's process group. A new real-entrypoint subprocess regression failed before this correction and passed afterward. The coordinator independently ran the regression plus adjacent launcher/configuration tests: 27 passed, exit 0 (`/tmp/happier-oh-6-tauri-shutdown-verified.log`). Windows already used the non-detached default; the POSIX process-group regression is skipped there.

Live replay verified helper PID 64433, CLI 64708 and native app 64731 sharing group 64433. The canonical repo-local stop completed successfully, and all three PIDs disappeared; the separately installed daily app PID 3744 remained running. The original orphan from the earlier defective launch was removed only after checking its exact scoped executable and group. No port-based or broad process cleanup was used. This establishes native process cleanup, not authenticated session persistence. A subsequent canonical launch compiled and bundled successfully at `/tmp/happier-oh-6-macos-after-clean-stop.log`; native PID 69128 is running. Its DOM contains the welcome controls, but the WebView reports `document.visibilityState=hidden` and their ancestor is still at opacity 0. Screenshots show the left branding and an empty right panel. Foreground visual replay therefore remains open; the older bridge cannot focus the window, and the application's Tauri capability denies `window.set_focus`. No capability change or alternate focus bypass was made. Do not misclassify DOM presence as visual restart acceptance or infer a foreground product defect from this background capture alone.

The latest upstream fetch completed and `origin/dev...upstream/dev` remains 0/0 at 98dab9837. The required 1Password Git signer still fails, so the lifecycle correction and newest notes remain staged locally until signing recovers; the prior Metro fix and welcome screenshot are pushed at 82c03fd77. No unsigned commit or signing-policy bypass was used.

## Mac test-environment findings

The original full root run still records its failures; the following focused reruns do not replace its final result. No existing test was edited.

- Set a canonical temporary root for Mac test commands. Node resolves module paths under `/private/var`, while the default `TMPDIR` can spell the same location `/var`. With `TMPDIR` set to `realpathSync(tmpdir())`, the artifact/provider-update suites pass 45 tests across two files, and the vendor updater suite passes another 3. Logs: `/tmp/happier-oh-6-canonical-tmp-tests.log` and `/tmp/happier-oh-6-canonical-tmp-install-tests.log`. The installer memory-pressure case still fails and requires a separate correction.
- Website availability tests need independent source inputs, as configured in `.github/workflows/tests.yml`. Source-only archives of `packages/agents/src` from `cli-stable` (`b8d1c449c46ab4dfa8637db36b66f643d149e66d`) and `upstream/v0.3` (`cefac10129c6faac450752909ec4f1b8335d5992`) pass all 39 tests in the two previously failing files. Provenance is recorded in the temporary `happier-website-source-trees-ZnjUTk/provenance.json`; log: `/tmp/happier-oh-6-website-discovery-tests.log`. These are CI discovery inputs, not native compatibility evidence or a v0.3 development checkout.
- Five bootstrap failures inherit the real user HOME while clearing only PATH and Happier's state directory. The intended macOS Dock search still finds `~/.local/bin/happier`, so those fixtures do not simulate a computer without a CLI. Running their five files with an isolated subprocess home and canonical temporary root passes all 76 tests unchanged (`/tmp/happier-oh-6-isolated-bootstrap-tests.log`). The user's shell environment and installed CLI are untouched. Do not remove Dock discovery or alter the installed CLI to make them pass. Existing fixture edits, if later proposed, require Josh's approval.
- The CLI-choice suite also expects no result after creating a managed link in its own `HOME/.local/bin`; that conflicts with the intentional Dock search. Eight other failures simulate Windows on the Mac filesystem and compare `.exe`/`.EXE` or `.cmd`/`.CMD` spellings. Native Windows evidence is required before treating those as product defects.

A one-command canonical-temp example using the existing test runner:

```sh
TMPDIR="$(node -p 'require("node:fs").realpathSync(require("node:os").tmpdir())')" \
  ./apps/stack/bin/hstack-exec -- yarn --cwd packages/cli-common -s vitest run \
  --config vitest.config.ts src/componentArtifacts/finalizeRuntimeArtifactPayload.test.ts \
  src/providers/update.test.ts src/providers/install.update.test.ts
```

This changes only that command's environment. Recreate website source snapshots from the named upstream refs when they are needed; do not point both discovery variables at this checkout or assume temporary folders survive a reboot.

The installer failure is now corrected at `packages/cli-common/src/providers/install.ts`. The vendor recipe records CLI presence using the same execution environment before the entire command sequence. A nonzero command can recover only when the CLI was absent before that sequence and is available afterward. A previously installed CLI no longer masks a failed forced reinstall. Successful forced installs, default already-installed skipping, consent, timeout handling and newly-available recovery are retained.

The new filesystem regression reproduced RED for an existing CLI, then passed after the correction. The coordinator independently verified all 32 tests across the new regression and existing installer gating, update, promotion and provider-update suites; package typecheck passed. Logs: `/tmp/happier-oh-6-installer-verified.log` and `/tmp/happier-oh-6-installer-typecheck.log`. No existing test was changed and no real vendor installer ran. The actual installer consumer is the CLI/daemon, not the native hsetup helper; compiled-runtime preparation is recorded below. Live installation behavior is not claimed verified. This correction also awaits the required Git signer before it can be checkpointed to origin.

## Compiled runtime preparation

The canonical desktop helper build completed successfully (`/tmp/happier-oh-6-updated-sidecar-build.log`). A further canonical stop removed helper/CLI/native PIDs 68843/69125/69128 and preserved the installed daily app. The restarted source desktop compiled in 6.46 seconds and bundled 11,394 UI modules; native PID 679 is in process group 257 with its Tauri CLI and outer helper. The current log is `/tmp/happier-oh-6-updated-helper-native.log`. Foreground visual acceptance and authenticated persistence remain open.

The first scoped CLI help command ran successfully through the existing TSX source fallback; it did not prove a compiled daemon runtime existed. The canonical `yarn cli:build`, routed through `hstack-exec`, then completed successfully and created `apps/cli/dist/index.mjs` with manifest fingerprint `c32d03bcc118df51`, built at `2026-10-23T01:09:03.813Z`. The generated CLI API chunk contains the installer correction. This build did not activate the checkout as the default CLI or change installed services.

Both compiled CLI help and a provider-install dry run completed successfully through the scoped wrapper:

```sh
node apps/stack/scripts/repo_local.mjs happier --source --help
HAPPIER_STACK_STACK=repo-happier-42a434c316 node apps/stack/bin/hstack.mjs \
  happier --source install provider claude --dry-run --force
```

The second command printed the Claude Code vendor-recipe plan; it executed no installer. Use the explicit stack command for this check: `repo_local.mjs` consumes `--dry-run` globally and only prints the wrapper invocation, even when that flag was intended for the CLI. The initial wrapper-only observation is retained at `/tmp/happier-oh-4-compiled-cli-provider-plan.log`; it is not provider-planner execution evidence. Actual successful planner output is at `/tmp/happier-oh-4-actual-cli-provider-plan.log`. Other logs: `/tmp/happier-oh-4-compiled-cli-build.log` and `/tmp/happier-oh-4-compiled-cli-help.log`. Scoped auth status still returns `not_authenticated` for `stack_repo-happier-42a434c316__id_default`, as expected before approval and pairing. Compiled CLI readiness does not establish a running authenticated daemon or real-session behavior.

## Authorized isolated test account

Josh explicitly authorized account creation. In the native dev window connected to `http://localhost:18339`, the normal welcome action created the new account on the isolated relay `http://localhost:52263` and opened the session shell. An authenticated `GET /v1/auth/ping` returned 200 before and after a full WebView reload, with persisted credentials still present. Credentials stayed inside the scoped app storage and were not printed or imported from the installed daily app.

The separate desktop computer-setup flow stopped with `executor_ended_without_result`: “System task executor exited without a final result.” Its details showed no additional stderr preview. The scoped CLI still reports `not_authenticated`; daemon pairing and real agent-session acceptance remain open. Account creation and reload persistence are verified, not computer setup, full native restart persistence or daily-use readiness. The prior root unit run has now exited 1, reporting failures in shared-packages, CLI, server and stack lanes; it is no longer running.

After the correction, the full shared CLI package suite ran with an isolated subprocess home and canonical temporary root: 101 files passed, 2 failed; 592 tests passed, 9 failed and 5 skipped (exit 1). The remaining failures are the CLI-choice expectation against macOS's intentional home-bin discovery and eight Windows-simulation case/path expectations. The installer regression and original memory-pressure test pass in this complete package run. Log: `/tmp/happier-oh-6-cli-common-full-isolated.log`. Do not report this suite as green or change those existing tests without approval. The original full root run is separate and has now exited 1 as recorded above.

## Match the macOS helper compiler to CI

The setup failure was an invalid signature on the Bun-compiled `hsetup` executable. Both the bootstrap output and Tauri copy failed `codesign --verify`; macOS killed a harmless unknown-task probe before it emitted output. Rebuilding with the old local Bun 1.2.17 reproduced the invalid signature immediately. A temporary ad-hoc-signed copy ran the same probe correctly, confirming the failing boundary without changing the live helper or weakening OS checks.

The repository's native/release CI pins Bun 1.4.2. Installed that exact official release under the isolated stack's `toolchains/bun-1.4.2/`, verifying the archive SHA-256 against the GitHub release asset digest (`90987a3a16d7db556d886ac3d551e7b6d3edf0a1cf43acaed622e8676be1d12f`). The canonical bootstrap build with this compiler passed, its signature verified, and the harmless unknown-task probe returned the expected protocol `unknown_kind` result. No product/build source correction was needed. Logs: `/tmp/happier-oh-6-pinned-bun-hsetup-build.log`.

Persisted the supported compiler override only in the isolated stack using:

```sh
node apps/stack/bin/hstack.mjs stack env repo-happier-42a434c316 set \
  HAPPIER_BUN_PATH=/Users/Josh/.happier/stacks/repo-happier-42a434c316/toolchains/bun-1.4.2/bun --json
```

The value was read back through `stack env ... get`; the global Bun installation is unchanged. Canonical native rebuild/restart and computer-setup replay subsequently passed as recorded below.

Required Git signing recovered: the accumulated lifecycle/installer fixes and account evidence are committed/pushed in `bc255a9dad`. The fetched upstream `dev` had one new commit, `f3ce78a2bf`, changing only remote-daemon release-smoke CLI-profile selection. Reviewed its diff, passed `bash -n` before/after integration, and merged/pushed it on the feature branch in `0d2b5db214`. No shared branch or GitHub API was mutated.

## Native restart and local computer connection

The initial one-step `dev --restart` attempt was rejected by the lifecycle owner guard; no ownership checks were bypassed. Canonical repo-local `stop --json` then stopped only the scoped runner, with no port-based kills or cleanup errors. A new canonical launch reused the pinned server/UI ports, the same scoped state and the private Bun override. Native compilation passed in 12.92 seconds; the Tauri copy of `hsetup` also passed `codesign --verify`.

The account remained signed in after the complete native stop/start. Authenticated local-relay ping returned 200 again after the new session shell rendered. Setup now reached its normal relay/account choice. Selected **Connect to localhost:52263 too**, whose canonical coordinator uses a separate pinned service and leaves the other relay's account in place. Setup completed; the native shell shows a green local relay and a connected-machine badge: [local test account in the native app](verification/OH-6-macos-local-account.jpg).

Independently verified the default installed CLI still reports its original `cloud` profile on `api.happier.dev`, authenticated with its registered machine and daemon running. The installed native app PID 3744 also remains running. This establishes coexistence for this setup action. The repository-scoped source CLI profile still reports `not_authenticated`; pairing that source runtime and verifying a real agent session remain separate next steps. No daily-use cutover or all-green test claim is made. Current native stack log: `/tmp/happier-oh-6-pinned-bun-native.log`.
