# Nightly Omnia release and automatic install

Josh, 2026-11-05: "make sure we have a deterministic way of new releases getting
out once per night (if there are any changes) and auto downloaded on to this
machine and this main Omnia Happier app/repo is refreshed with the newest version."

## What was wrong

- The Cassian `happier-nightly` runner received a shutdown on 2026-11-01 and exited 0.
  Its plist had no `KeepAlive`, so it stayed down. Each nightly queued for 24 hours
  and ended `cancelled`. The sender of that shutdown is unknown.
- Nightly builds ran even when `dev` had not changed: 12 scheduled runs built 4 SHAs.
- A non-green `dev` head at 02:17 blocks that night even when earlier commits are green.
- Nightly output was raw binaries with upstream identity, not an installable app.
  Nothing was published, and nothing on the Mac pulled anything.
- A dead runner gives no failure signal: GitHub reports `cancelled` after 24 hours.

## Decisions

| Topic | Decision | Why |
| --- | --- | --- |
| Source selection | Newest `dev` push with successful canonical CI, which must be an ancestor of the trigger SHA | "If there are any changes" must not depend on the head being green at 02:17 |
| Change gate | Skip when a published release for that SHA has both assets, or the SHA is strictly behind `production` | Keying on the release, not on `production`, avoids a wedge when promote succeeds and publish fails |
| Build | One Cassian-only step in the `build` job of `build-tauri.yml`, calling the documented `hstack build --tauri --tauri-production` with new `HAPPIER_STACK_TAURI_BUNDLES=app` | Reuses the tested fork identity owner; the runner group admits only this workflow |
| Publish | Hosted job after promote, using the existing `github-publish-release` pipeline command with `GITHUB_TOKEN` | The reusable release workflow rejects the `andorcassian` actor; Cassian stays read-only |
| Release form | Immutable per-SHA tag `omnia-nightly-<sha12>`, no rolling tag | The repository enforces immutable releases |
| Local trigger | Hourly launchd agent, idempotent | A calendar job can fire on wake, defer, and wait a day |
| Installer source | Script runs from `happier-dev`, which only fast-forwards to certified release SHAs | Satisfies "invoked from a development checkout" without running uncertified code |
| In-app updater | Stays disabled. This is an interim path until OH-5 lands | Updates are compile-time off, so there is no live competing decision-maker |
| CLI and daemons | Out of scope | No fork CLI artifact exists and a swap would affect running sessions |

## Shared contract: release assets

Tag `omnia-nightly-<first 12 of source SHA>`, target the source SHA, author
`github-actions[bot]`, `immutable: true`, not a draft or prerelease.

Assets:

- `omnia-happier-macos-arm64.tar.gz`: exactly one root entry, `Omnia Happier.app/`
- `omnia-happier-macos-arm64.json`:

```json
{
  "schema": 1,
  "sourceSha": "<40 hex>",
  "workflowRunId": 123,
  "version": "0.2.18",
  "bundleId": "com.omnia.happier.production",
  "productName": "Omnia Happier",
  "serverUrl": "https://api.happier.dev",
  "updatesEnabled": false,
  "signature": "adhoc",
  "tarball": "omnia-happier-macos-arm64.tar.gz",
  "size": 1,
  "sha256": "<64 hex>",
  "rustc": "rustc x.y.z",
  "xcode": "Xcode x.y"
}
```

The version does not change nightly, so `sourceSha` identifies a build.

## Mac agent behaviour

Each hourly run:

1. Restore the app if a previous swap was interrupted.
2. Read the latest release. Reject anything that breaks the contract above.
3. Fast-forward `happier-dev` to the release SHA and update `happier-production`
   through its guarded helper. This also happens while an app install is deferred.
4. Stop if the SHA is already installed or is held after a failed install.
5. Download and verify: size, SHA-256, SHA reachable from `origin/production`,
   single-root tarball, strict codesign, bundle id, product name, arm64.
6. Defer while the app is frontmost, or has a window and input was active in the last
   15 minutes. Tray-only and closed states proceed.
7. Save the current bundle as a tarball, SIGTERM the app, wait for exit, swap with two
   renames, relaunch in the previous mode, and confirm the new process stays alive.
   If it does not, roll back and hold that SHA.
8. Watchdog: alert once when the latest completed nightly did not succeed, or no
   successful nightly finished within 26 hours.

Rollback copies are tarballs, because extra bundles with the same id can take over
the `happier://` handler.

## Known limits

- Bundles are ad-hoc signed and public. A repository writer could publish a release
  that passes these checks, so the SHA-on-`production` check is the main origin check.
- A dead Mac agent cannot report itself.
- Cassian has no auto-login, so after a reboot its runner stays offline until someone
  logs in. The watchdog reports this.
- Nothing has yet proven that a launchd job may replace a bundle in `/Applications`
  on macOS 27 (App Management), or that a Cassian-built ad-hoc bundle runs here.
