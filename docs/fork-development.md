# Omnia Happier development and adoption

This is the fork-specific runbook for `omnia-digital/happier`. Develop against an isolated local stack, then qualify one revision on iOS, macOS, and Windows before using it for daily work. This setup is not yet build- or device-verified.

## Repository and change flow

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

Only after these gates pass should we install fork release builds as daily tools and activate the fork CLI/services on each computer. A local server tied to a laptop sleeping cannot be assumed always available; choose a durable reachable host before relying on remote daily use. Account/session migration from the hosted service remains a separate tested step, not an assumption that a new server inherits existing data.

## Initial verification record — 2026-10-22

- Full clone completed; feature branch and plan checkpoint pushed to `origin`.
- Two dependency-free tests passed: root repo-local script wiring and Git-owned stack identity preservation.
- The initial broader setup run reported 2 passed / 6 failed: launcher/provider checks could not load uninstalled `@happier-dev/cli-common`; dependent spawn assertions consequently failed. No tests were changed.
- Dependency install, full tests/typecheck, live stack, native builds, Windows and physical-iPhone acceptance: **blocked/unrun** pending setup prerequisites above.
- No app publication, service replacement, account migration, or release cutover was performed.

The next execution step is storage resolution, followed by locked dependency installation and rerunning the failed launcher checks. Then repair native toolchains and validate the local stack before configuring distribution identities.
