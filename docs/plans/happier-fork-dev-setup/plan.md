# Happier fork development setup

## Goal and context

Clone `omnia-digital/happier` here and establish a reproducible development and eventual daily-use process for iOS, macOS, and Windows. Preserve the existing Happier installation until the fork passes platform acceptance.

## Decisions

- Current user priority: macOS desktop first, then desktop workflow improvements. Defer iOS until macOS works the way Josh wants; Windows remains a later platform target. Mac daily-use acceptance does not wait for iOS acceptance.

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
- Current toolchain evidence: Rust/Cargo 1.94.1 verifies on Mac and Windows. CocoaPods 1.17.0 verifies through Homebrew Ruby on Mac; the old system-Ruby executable is preserved. Windows locked dependency installation completed; stack dependency compilation and live startup are in progress. See the runbook continuation for exact failures and prerequisites.
- Native builds, full tests and live stack checks are pending storage and dependency/toolchain setup. No daily-use cutover occurred.
- Expo/EAS, Apple submission and Tauri updater configuration still refer to upstream ownership. Configure fork identities before release commands.
- Local mobile helper clears the Expo slug; validate the project identity at its canonical owner before using a fork EAS project.

## Scope

This task establishes and documents development setup. It does not publish releases, replace the running stable installation, migrate accounts, or claim unperformed Windows/iOS acceptance.

## First improvements after a stable macOS build

Josh requested a prioritized Linear backlog before implementation: custom session ordering with project/repository grouping across machines; an alternate machine grouping/filter; right-click parity with the existing session overflow menu; an archive action among default session hover buttons; Command-held number hints with Command+number session navigation; and hovered-session A to archive through a confirmation dialog accepting Enter.

Create focused OH tickets with native macOS acceptance, shared action ownership and shortcut safety. Gate this work on the stable macOS/source-session acceptance in OH-4 and OH-6, without waiting for Windows, iOS or the cross-device release. Keep implementation deferred until that baseline is verified. Review existing Linear work first to avoid duplicates; investigate canonical source owners only to ground the tickets, not to start feature implementation. Cross-machine repository identity and ordering persistence details belong in the organization ticket's design work.

### Verified backlog

- [OH-14](https://linear.app/omniachurchapps/issue/OH-14): project/repository grouping across machines, custom ordering and alternate machine grouping/filter. Existing workspace identity combines machine ID and normalized path; define repository equivalence without merging unrelated same-name repos and reuse organization/order state.
- [OH-15](https://linear.app/omniachurchapps/issue/OH-15): right-click opens the same menu as the three-dot button. Reuse `moreMenuItems`/`handleMoreMenuSelect`; the native long-press menu currently has a different source.
- [OH-16](https://linear.app/omniachurchapps/issue/OH-16): default hover Archive button alongside existing actions, using canonical capability, busy and stop/archive flows.
- [OH-17](https://linear.app/omniachurchapps/issue/OH-17): held-Command number hints and Command+number navigation in current sidebar order; additionally depends on OH-14. First nine shortcuts are a proposed implementation range, not a final user decision.
- [OH-18](https://linear.app/omniachurchapps/issue/OH-18): hover A always opens confirmation, Enter confirms and Escape cancels; additionally depends on OH-16. Capture the hovered target, exclude text entry and clear stale hover state.

All five issues read back as High priority, Backlog, without a cycle, in milestone `macOS session workflow — after stable build`, with OH-4/OH-6 blocking relations. No product code was changed for this backlog. Routed source reconnaissance failed before work because the model-routing transport is invalid; matching native fallback completed the read-only inspection, and key source claims were independently checked. Linear shared agent-context lookup is unavailable; normal project/issue tools worked.
