# OH-52: Durable worktree creation custody

## Scope

Implement source slice3a from the reviewed phase13 discovery: a host-created, durable worktree claim tied to the existing launch nonce and trusted child session-creation result. This does not implement or authorize resource deletion. Existing manual, resumed, ambiguous or unclaimed resources remain unclaimed.

## Contract and design

- Extend the canonical new-session materialization, SCM worktree creation and daemon child/session identity owners. Reuse the host's authenticated account/machine scope and atomic locked persistence pattern; caller metadata cannot mint custody.
- Record only a worktree actually created by that host operation, with canonical checkout/common-dir/registered-path/branch identity and launch nonce. An existing branch is never claimed as newly created.
- Bind only a trusted tracked child for the same nonce, runner, canonical path, machine and account, retaining actual server `created` resolution. Existing/unknown response resolution can only rejoin an already verified durable binding; resumes, pre-created flows and arbitrary reported session IDs confer no new authority.
- Preserve old UI/CLI/relay compatibility: missing optional provenance remains unclaimed, ordinary session creation continues, unsupported old server proof never becomes success. Claim-persistence failure leaves the successful checkout/session usable and explicitly unclaimable; it must not trigger destructive rollback merely to repair provenance.
- Claims survive daemon restart and cannot borrow another Home/account's data. Ambiguous/corrupt/missing records fail closed. No retrospective adoption from path, PR, nonce alone or `share:null`.
- Keep deletion, process-user inventory, PR integration proof, filesystem cleanup, new capability execution and real resource cleanup outside this slice. Do not create a background service or another session registry.

## Tasks and deciding proof

- [ ] 🔴 RED/GREEN host creation capture and durable exact identity, including existing-branch semantics and persistence failure without losing user work.
- [ ] 🔴 RED/GREEN actual child `created` witness and binding; reject wrong account/machine/nonce/path/runner, shared/existing/unknown/resumed identity and caller forgery.
- [ ] 🔴 Reload/retry/reentry and old-client/server compatibility through canonical owners, with isolated configuration and disposable repositories only.
- [ ] 🔴 Affected protocol/CLI/UI types and adjacent owner tests, independent root source review and explicit remaining cleanup gaps.

Routing selects actual Sol/high, zero failed cycles. Worker owns this plan and exact source/test paths; root owns Linear, tasks and phase9. Coordinate shared protocol exports and metadata/foreground seams with slice2; no broad staging, external writes, native app or daily configuration changes.
