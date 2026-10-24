# OH-52: Archive automation and safe local resource cleanup

## Authorized outcome

Implement the existing OH-52 request under the project goal: independent opt-in cleanup-on-archive and auto-archive-after-all-linked-PRs-merge preferences; reviewable multi-repository PR associations; canonical archive lifecycle; safe machine-owned cleanup with per-resource outcomes and retry. Do not revive deferred PR-review/board features.

## Initial constraints and decisions

- Begin with bounded source discovery and a concrete implementation decomposition through existing owners. Root owns Linear and integration review; the assigned worker owns this plan's discoveries and decisions.
- Do not archive real sessions, delete real host resources, stop daily services, change shared preferences, or write provider/GitHub/Jira/Confluence state during development. Use disposable isolated fixtures for destructive behavior tests.
- Both preferences start off and remain independent. Reuse the existing settings owner and explain its scope. Cleanup applies only after archive succeeds, whether manual or automatic.
- Auto-archive needs at least one linked PR and fresh verified merged evidence for every association, with provider/host/repository/PR identity. Unknown, inaccessible, open, draft and closed-unmerged never qualify. Merge status does not prove later local work is merged.
- Preserve active-session safeguards. The conservative proposed automatic path skips active/ongoing work and explains why; it must never force-stop merely because a PR merged. Settle this through canonical lifecycle discovery before implementation.
- Initial cleanup scope is local worktrees/branches and provably session-owned directories only. Remote branch deletion is excluded and must be stated in Preferences; current external-write policy does not authorize it.
- Preserve main/protected/default/shared checkouts and branches, modified/untracked/ignored user data, unpublished/unmerged work and resources used by other sessions/processes. Establish actual ownership and recheck eligibility immediately before each removal. Treat worktree, branch and directory separately.
- Squash/rebase merges need current source-backed integration proof; branch ancestry alone is insufficient. Ambiguous ownership/integration/process visibility must fail closed with a useful skip reason and retry route.
- Use current PR provider adapters/read operations, archive deadline/stop owners, Git/worktree and filesystem owners. Older relays/CLIs must retain honest unsupported behavior; no new daily daemon installation is implied.

## Tasks and evidence

- [ ] 🟡 Discover actual PR discovery/get/cache/auth, association metadata, archive entry points, host ownership/process knowledge, worktree/branch removal and settings/lifecycle owners. Record gaps rather than inventing a second authority.
- [ ] 🔴 Split implementation into source slices with concrete acceptance, file ownership and checks. Classify safety-sensitive implementation separately after discovery.
- [ ] 🔴 RED/GREEN independent preferences, multiple/cross-repository PRs and partial/unavailable merge states, active-session handling and canonical manual/automatic archive.
- [ ] 🔴 Disposable Git proof for dirty, untracked, ignored, unpushed, later commits, squash/rebase, protected/main/shared resources, offline/failure/retry and immediate pre-delete revalidation.
- [ ] 🔴 Composed isolated Preferences → merge-state read → archive → safe host cleanup, plus relevant macOS/Windows/Linux evidence and explicit unavailable platform gaps.
- [ ] 🔴 Independent source review, required types/adjacent tests and rendered UI checks. No stable/native/production completion claim from source fixtures alone.

Source pointers already confirmed: UI `sessionArchiveLifecycle.ts` and `sessionStopArchiveFlow.ts`; server `registerSessionArchiveRoutes.ts`; CLI `worktreeOperations.ts` and `pullRequestOperations.ts`. Current PR backend has GitHub REST/CLI and GitLab CLI adapters, so provider scope must be discovered explicitly.
