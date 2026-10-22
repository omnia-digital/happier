# Tasks: Happier fork development setup

### [x] Establish checkout and platform workflow
**Description:** Clone the fork, configure remotes, verify development and native build entry points.
**Context:** Existing installed Happier must remain usable during fork development.
**Status:** 🟢 Green — full clone, feature branch, origin/upstream and pushed checkpoint verified. Canonical mobile, desktop, repo-local and CI entry points reviewed.

### [ ] Verify local setup
**Description:** Install locked dependencies when capacity allows and execute relevant setup checks.
**Context:** Native builds require sufficient disk space and platform toolchains.
**Status:** 🔴 Red / blocked — about 9–10 GiB disk available; installation deferred pending storage resolution. Rust absent; existing CocoaPods command crashes. Two setup tests and twelve mobile-identity/desktop-scheme tests pass. Broader launcher run: 2 pass / 6 fail due to uninstalled workspace dependencies. Full builds and device acceptance remain unrun.

### [x] Document and checkpoint the development process
**Description:** Write the fork runbook, review source-backed commands and signing requirements, commit and push.
**Context:** Future sessions need a repeatable route to platform acceptance and safe daily-use cutover.
**Status:** 🟢 Green — runbook committed and pushed; independent source review found no material errors in commands, isolation, identity or release caveats. All three local runbook links resolve; `git diff --check` passes. Runtime readiness remains blocked separately above.
