# Tasks: Happier fork development setup

### [x] Establish checkout and platform workflow
**Description:** Clone the fork, configure remotes, verify development and native build entry points.
**Context:** Existing installed Happier must remain usable during fork development.
**Status:** 🟢 Green — full clone, feature branch, origin/upstream and pushed checkpoint verified. Canonical mobile, desktop, repo-local and CI entry points reviewed.

### [ ] Verify local setup
**Description:** Install locked dependencies when capacity allows and execute relevant setup checks.
**Context:** Native builds require sufficient disk space and platform toolchains.
**Status:** 🟡 Yellow — CocoaPods 1.17.0 and Rust/Cargo 1.94.1 now verify successfully (OH-3 done). Two Mac dependency-install attempts were interrupted before disk exhaustion; Yarn cache cleanup restored about 15 GiB free. The SSD worktree attempt failed with permission denied on a Time Machine volume. Windows SSH is verified with about 165 GiB free; a separate clone/install is underway on `josh-pc` at `C:\Users\Admin\Developer\Projects\Omnia\happier`. Prior launcher checks still need rerunning after installation. Full builds and device acceptance remain unrun.

### [x] Document and checkpoint the development process
**Description:** Write the fork runbook, review source-backed commands and signing requirements, commit and push.
**Context:** Future sessions need a repeatable route to platform acceptance and safe daily-use cutover.
**Status:** 🟢 Green — runbook committed and pushed; independent source review found no material errors in commands, isolation, identity or release caveats. All three local runbook links resolve; `git diff --check` passes. Runtime readiness remains blocked separately above.

### [x] Establish OH planning in Linear
**Description:** Create a fork-adoption project, three milestones, and actionable issues with acceptance criteria and dependencies in the new Happier team.
**Context:** Team OH is verified and initially empty. Track development readiness, native platform validation, safe daily-use adoption, release tracking and ongoing upstream maintenance. Do not set invented dates, mark untested builds done, or mutate GitHub outside feature-branch pushes.
**Status:** 🟢 Green — project P-OH-57 created with three milestones and issues OH-1 through OH-12; issue statuses and milestone assignments read back. Completed clone/docs are OH-1; storage/dependencies remain blocked in OH-2; OH-10 tracks release-pipeline setup; OH-12 tracks ongoing upstream maintenance. No release pipeline or release date is claimed configured.
