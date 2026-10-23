# Card layout, composer mode and repository grouping

Continue macOS-first source work under the current OH tasks. The existing hosted account, installed clients/daemon and active native window remain intact. Native hotkey QA is explicitly deferred; other native acceptance remains required. All source changes need meaningful RED/GREEN and independent review; tests/fixtures do not need separate approval.

## OH-54: Agent and machine identity placement

Move the existing agent icon from the title's left edge into the row's right-side identity group: agent, machine glyph, optional machine label, then existing remaining indicators/actions. Reuse the OH-47 glyph/color owner. Add local default-on **Show machine labels on session cards**, independent of the existing machine-identity visibility setting. Preserve the detail header's separate identity. Label-off rows retain icon, full-name hover/focus tooltip and accessible name. Propagate virtualized presentation inputs through the current extraData/row-model owner; preserve Pinned/ordinary/grouped rows, selection, status, title space and controls.

- [x] 🟢 Canonical row/preference/identity owners traced; deciding layout, icon-only tooltip/focus, local preference persistence and native extraData regressions added RED then GREEN.
- [x] 🟢 Source checkpoints `40fad2d505` and adjacent activity-time assertion follow-up `fa80a7be16` are pushed. Author focused 23, adjacent 56 and full native FlashList test suite 87 pass (overlapping counts); integrated UI typecheck passes. Root reviewed row layout, preference/cache propagation and tooltip behavior, and independently replayed the card/composer batch: 75 tests across five files pass (`/tmp/happier-card-composer-independent.log`). Isolated browser acceptance preparation continues; rendered/native acceptance remains pending.
- [ ] 🟡 Native multi-machine/custom appearance/narrow layout/restart acceptance remains pending separately.

## OH-53: Composer Build/Planning presentation

Rename only the existing relevant user-facing Default mode to Build; underlying provider mode values and availability stay unchanged. Active chip shows a distinct Build icon or recognizable Planning/checklist icon without persistent text. Reuse the mode selector, icon and tooltip owners; hover/focus and accessibility expose the current mode. Picker choices retain labels and switching behavior.

- [x] 🟢 Actual native mode and synthetic reset option traced through the canonical composer picker. New default-to-Build consumed-path assertions failed before the source correction; native option IDs remain unchanged. Planning uses the checklist glyph and localized label; arbitrary mode labels retain their meanings.
- [ ] 🟡 Source checkpoint `de6c718a1e` is pushed. Author six-file source/adjacent check passes 72 tests, plus the existing new-session static-mode regression. Root independently replayed resolver/consumed composer cases within the 75-test batch above and reviewed shared tooltip/popover anchoring. Actual RN-web DOM tests pass 6/6 across internal/external anchors, button/text roles, hover/focus and focus retention; final integrated UI typecheck passes after the moving fixture correction. The one-file DOM follow-up awaits checkpoint; native acceptance remains pending.
- [ ] 🟡 Native both-mode switching/compact layout/hover/focus acceptance remains pending.

## OH-14: Repository-view implementation design

Complete source-backed design from the phase-3 discovery before production edits. Required outcome remains equivalent repositories across machines plus persistent manual session ordering, alongside Original/Machine views. Workspace-subgroup order alone must not silently replace session ordering. Folders, pins, shared access, original action targets and server/account boundaries remain valid.

Known facts: installed CLI 0.2.16 supports existing SCM snapshots with root/remotes/worktrees, but list metadata lacks repo identity and snapshots are ephemeral/expensive. Reuse the SCM owner for explicit discovery and persisted scoped associations; do not fetch from each row. Current machine-path SCM service lacks explicit server input, so establish the transport/cache scope before extending it. Origin host/full namespace/repo and nondefault port are identity inputs; never basename or any common upstream. Unknown SSH aliases/local remotes need a predictable separate/manual path. Resolve project projection, ordering, folder/drag behavior and lifecycle together, without a parallel organization store.

- [x] 🟢 Astra/high source design completed against the actual owners. Root accepted the routine mechanism choices below under the existing OH-14 outcome; no user approval gate or contract reduction is needed.
- [ ] 🔴 Implement all required owners and deciding equivalent-repo, alias/worktree, same-basename, scope, persistence/order, folder/action and view-roundtrip regressions.
- [ ] 🟡 Validate source, independent review, native workflow and restart; keep OH-14 In Progress until the full requirement is proven.

### Selected implementation corridor

Add Repository alongside Original/Machine using the existing local view owner. Explicit selection/Refresh initiates list-level discovery, consumes matching caches and sequentially resolves missing distinct machine/workspace targets through the SCM service. Recheck after each root/worktree discovery; leaving the view stops further dispatch. Restored/mounted rows must not start discovery or write preferences by themselves. Known associations survive failed refresh; unresolved/offline states remain honest and retryable.

Capture server/account scope at the canonical service request boundary and namespace snapshot, alias, in-flight/enrichment caches consistently, migrating current callers rather than adding a separate cache/transport. Persist local scoped workspace-to-repository associations and manual override through one owner. Prefer origin fetch URL, with a single unambiguous alternate remote only when origin is absent; normalize conventional SSH/HTTPS/scp forms and transport defaults while preserving full namespace and nondefault ports. Unknown aliases/local/missing repos remain separate unless explicitly associated; credentials never enter stored identities.

Project roots flatten equivalent checkout sessions so real A(machine1), B(machine2), A2(machine1) interleaving is possible; actual folder subtrees and empty folders retain workspace references, hierarchy, focus and IDs. Repository headers have presentation identity separate from a physical workspace. Actions choose a real checkout when ambiguous. Preserve Pinned/access/activity/server bands and row targets; never change actual host/path/folder just to reorder the view.

Use existing organization group order scopes, optimistic rollback/hydration and real session IDs, with opaque namespaced digest keys. Custom ranks remain stable through activity and view switching; unranked fallback is deterministic. Extend the canonical writer with explicit display-scope reorder policy because current removal from every scope would erase unrelated orders. Retain full cleanup for real structural moves. Separate tree sibling-order identity from workspace-safe nesting, and migrate dependent menu copy now that Repository also offers supported ordering.

Deciding tests include origin/shared-upstream distinctions, aliases/ports/same basenames/worktrees/manual reset; scope and in-flight isolation, dedup/cancel/retry/account switch/late response; actual A/B/A2 drag and organization reload, unchanged Original/Machine scopes/assignments, folders/pins/shared/actions, view roundtrip and activity stability. No new CLI/server deployment or protocol enum is required. Native two-machine/same-basename/restart acceptance remains open after source validation.

## Inventory and routing

Refreshed project now also contains OH-59 machine monitoring; it remains open and must be read before implementation. Other open tasks retain their original scope. Parent `dev` fetched this continuation is unchanged at `a487b2ec48`; no blind merge.

Selected lanes: OH-54 Sol/high (0 failed formal review cycles); OH-53 Luna/medium (0); OH-14 remaining Repository source Astra/high (1 failed formal review cycle: active-Home scope and public project-key semantics, corrected together). Initial RED tests and in-progress self-attacks are not additional formal failures. The route executor remains unable to start due to invalid `model_routing` transport; matching native workers are running. Root owns these execution docs; workers coordinate only actual source hunks and serialized staging/commit/push transactions.

The early OH-14 SCM batch is pushed as `8872024dea`: snapshot/alias/in-flight/enrichment caches are namespaced by server/account and RPC authority is captured. Root review reproduced an owning-Home session receiving the active Home's project path; the canonical target adapter now excludes foreign active machine/project records and retains session metadata. A self-attack also reproduced an account switch during async scope resolution; the correction rejects replacement metadata before dispatch. Daemon-owned tilde expansion remains available without borrowing another Home's local directory. Final author checks pass service 50, resolver 10 and outer transport/target 44 (overlapping with the earlier adjacent 119). Root independently replayed six scope/Home/account cases with 94 unrelated cases filtered (`/tmp/happier-oh14-scope-independent.log`) plus the exact captured-account session transport case, 1/1 with 12 unrelated filtered (`/tmp/happier-oh14-session-transport-independent.log`). The integrated typecheck caught the concurrent OH-53 anchor-ref fixture; its final corrected run passes. This is prerequisite source work, not completion of repository projection/order/folders. Native two-machine/restart proof is still required.

The required 0.2-to-0.3 source disposition cannot be inspected because the verified sibling `../v0.3.x` checkout is absent. Do not invent an alias or report a port complete. Preserve validated 0.2 work and its intent for later disposition; this does not block independent source improvements.
