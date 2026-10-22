# Omnia Happier development and adoption

This is the fork-specific runbook for `omnia-digital/happier`. Develop against an isolated local stack and qualify macOS desktop first for daily work. Windows and iOS remain later platform targets; iOS is explicitly deferred until the macOS app works the way Josh wants. This setup is not yet build- or device-verified.

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

For the first macOS daily-use adoption, require the local source stack, macOS, and update/rollback gates plus any applicable hosting and account-migration checks. Windows, iOS, and cross-device gates apply when those platforms enter the rollout. Activate fork CLI/services on each computer only after its applicable gates pass. A local server tied to a laptop sleeping cannot be assumed always available; choose a durable reachable host before relying on remote daily use. Account/session migration from the hosted service remains a separate tested step, not an assumption that a new server inherits existing data.

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

Josh confirmed macOS desktop is his primary interface. Prioritize launching and validating the fork on this Mac, then refine the desktop workflow from his feedback. Defer iOS builds, simulator work, signing and App Store setup. Windows setup is available for later work, but does not establish Mac readiness. The immediate Mac prerequisite is enough writable space for dependencies and native compilation.

The Mac has 64 GiB of RAM with substantial observed memory headroom. A new, empty 16 GiB RAM disk was created and mounted at `/Volumes/HappierBuildRam`; no existing disk or simulator data was erased. Locked installation is now running with its cache on that temporary volume:

```sh
yarn install --frozen-lockfile --link-duplicates --cache-folder /Volumes/HappierBuildRam/yarn-cache --network-timeout 600000
```

This keeps downloaded cache files off the nearly full internal disk. Dependencies still install into this checkout. The install has reached package fetching; it is not yet verified complete. After installation, reclaim this task's RAM cache before native compilation and use temporary native build output where the canonical launcher permits it. RAM-disk contents disappear on detach or reboot, so this is a development workaround, not durable build storage. The proposed simulator cleanup remains unapproved and has not run.
