# Happier fork development setup

## Goal and context

Clone `omnia-digital/happier` here and establish a reproducible development and eventual daily-use process for iOS, macOS, and Windows. Preserve the existing Happier installation until the fork passes platform acceptance.

## Decisions

- Base this setup branch on `origin/dev`; PRs target the fork's `dev` branch.
- Keep `origin` as the fork and `upstream` as `happier-dev/happier`.
- Standing user preference: check the parent at work-session start and before release candidates, and integrate compatible upstream improvements through feature branches and validation without breaking fork behavior.
- Reuse repo-local stack tooling rather than inventing a second launcher.
- Separate development readiness from signed release and physical-device acceptance.
- Keep upstream application identities and release destinations untouched until fork ownership is configured deliberately.

## Tasks and verification

1. Verify checkout, prerequisites, existing runtime isolation and platform commands.
2. Install locked dependencies and run appropriate setup checks if disk capacity permits.
3. Document the fork-specific daily workflow, platform prerequisites, distribution ownership, and cutover/rollback gates in `docs/fork-development.md`.
4. Review commands against their implementations, run applicable checks, and commit/push setup documentation.

## Initial discoveries

- Default branch: `dev`; upstream recommends matching dev clients/CLI/server.
- Node 24.20.0, Yarn 1.22.22, Xcode 27.1 are present; Rust is not on PATH.
- Free disk space was about 10 GiB during clone. Native build capacity needs resolution before large builds.
- Model-routing MCP is unavailable in this session; native fallback is disclosed.

## Verification and remaining prerequisites

- Clone completed; `origin` is the Omnia fork and `upstream` is the original project; push default is `origin`.
- Plan and runbook checkpoints are pushed on `chore/happier-fork-dev-setup`.
- Two repo-script/stack-identity tests and twelve mobile-identity/desktop-deep-link tests passed.
- Initial broader launcher run: 2 passed, 6 failed because `@happier-dev/cli-common` was not installed; dependent spawn checks could not run successfully.
- Rust is absent. CocoaPods resolves to an old system-Ruby installation and crashes; Homebrew Ruby 3.3.5 exists but is not the active `pod` runtime.
- Native builds, full tests and live stack checks are pending storage and dependency/toolchain setup. No daily-use cutover occurred.
- Expo/EAS, Apple submission and Tauri updater configuration still refer to upstream ownership. Configure fork identities before release commands.
- Local mobile helper clears the Expo slug; validate the project identity at its canonical owner before using a fork EAS project.

## Scope

This task establishes and documents development setup. It does not publish releases, replace the running stable installation, migrate accounts, or claim unperformed Windows/iOS acceptance.
