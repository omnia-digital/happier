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

- [x] 🟢 Host SCM capture records the real linked-worktree identity, exact branch returned by Git, and whether the operation created the branch. A changed branch, ambiguous identity, corrupt record, or failed claim write leaves the checkout usable and unclaimed.
- [x] 🟢 Bind requires a correlated daemon child, exact launch nonce, machine, Home, path, runner PID, server `created` result, and the account subject of the child's successful authenticated session-create request. Different/missing child account, pre-created/resumed/unknown/existing creation, wrong path or runner cannot mint a binding.
- [x] 🟢 Claims are atomically stored in the active server and release-ring scope; restart reads and same-session retry preserve the binding. Another Home with the same account/machine/nonce cannot borrow it. Old clients or servers omit optional proof and keep session creation functional without minting custody.
- [x] 🟢 Root accepts the bounded source boundary through `1e5c2af051`. Independently replayed CLI owner tests 84/84 and Claude integration 27/27, exit0 (`/tmp/happier-oh52-custody-root-final.log`, `/tmp/happier-oh52-custody-claude-root-final.log`). Reviewed actual SCM capture, authenticated create-result propagation, tracked child binding and durable scope. Author UI new-session and SCM tests 32/32, protocol SCM contract 4/4, CLI/UI types passed. These are source and disposable-Git checks, not native-app or cleanup proof.

No cleanup capability, process-use inventory, branch/worktree removal, provider integration proof, or real-resource deletion is part of this slice. Session creation remains usable if ownership evidence or claim persistence is unavailable; such a checkout stays unclaimable. Normal sessions without a recorded worktree do not create claim storage during binding.

Routing selects actual Sol/high; final assessment is VERIFY at the bounded source boundary. OH-52 cumulative counters retain one failed Sol / zero failed Astra from slice2; the advisory creation-custody corrections were resolved before this handoff. Worker owns exact source/test paths; root owns Linear, tasks and phase9. Coordinate shared protocol exports and metadata/foreground seams with slice2; no broad staging, external writes, native app or daily configuration changes.
