# Tasks: Happier fork development setup

### [x] Establish checkout and platform workflow
**Description:** Clone the fork, configure remotes, verify development and native build entry points.
**Context:** Existing installed Happier must remain usable during fork development.
**Status:** 🟢 Green — full clone, feature branch, origin/upstream and pushed checkpoint verified. Canonical mobile, desktop, repo-local and CI entry points reviewed.

### [x] Verify Mac dependency and launcher setup
**Description:** Install locked dependencies and execute the relevant launcher checks.
**Context:** macOS desktop is the immediate priority; iOS is deferred.
**Status:** 🟢 Green — locked Mac installation completed in 471.66 seconds using a temporary RAM cache, which was detached afterward. Free disk now verifies around 55 GiB. Shared dependencies are already current; all 22 launcher/provider/stack-identity checks pass. No simulator data, tests or app source were changed. Native/live acceptance remains a separate next step.

### [ ] Run and validate the macOS desktop app
**Description:** Start the isolated source stack and real Tauri window, then verify core session behavior.
**Context:** OH-4 and OH-6 own live/native acceptance. Preserve the existing daily installation and accounts.
**Status:** 🟡 Yellow — canonical dry run resolves repo-happier-42a434c316. Automatic account seeding and credential migration are disabled in its environment; desktop title is Happier Omnia Dev. Native target uses persistent scoped storage. Startup is running its first stack-specific dependency admission. Locked Cargo fetch completed and 21 Tauri launcher/configuration checks passed. Native compilation, window behavior and real-session acceptance remain unverified.
**Live findings:** The first stack admission completed; the unauthenticated daemon stopped that launch. Guided-auth startup now keeps server/UI available and defers daemon pairing. Server health passes on 52263; Metro is on 18339. Native compilation succeeded in 2m 35s and launched the scoped debug executable. UI bundling is blocked because the unanchored workspace-node_modules exclusion matches the checkout's own `/apps/happier/node_modules` directory. Both failed module files exist, are under watchFolders, and match that regex. Fix the canonical Metro exclusion with regression RED/GREEN, then replay the native flow. No app usability claim yet.

### [x] Document and checkpoint the development process
**Description:** Write the fork runbook, review source-backed commands and signing requirements, commit and push.
**Context:** Future sessions need a repeatable route to platform acceptance and safe daily-use cutover.
**Status:** 🟢 Green — runbook committed and pushed; independent source review found no material errors in commands, isolation, identity or release caveats. All three local runbook links resolve; `git diff --check` passes. Runtime readiness remains pending separately above.

### [x] Establish OH planning in Linear
**Description:** Create a fork-adoption project, three milestones, and actionable issues with acceptance criteria and dependencies in the new Happier team.
**Context:** Team OH is verified and initially empty. Track development readiness, native platform validation, safe daily-use adoption, release tracking and ongoing upstream maintenance. Do not set invented dates, mark untested builds done, or mutate GitHub outside feature-branch pushes.
**Status:** 🟢 Green — project P-OH-57 created with three milestones and issues OH-1 through OH-12; issue statuses and milestone assignments read back. Completed clone/docs are OH-1; Mac dependencies and launcher checks now pass in OH-2; OH-4/OH-6 own the next live and native checks; OH-10 tracks release-pipeline setup; OH-12 tracks ongoing upstream maintenance. No release pipeline or release date is claimed configured.
