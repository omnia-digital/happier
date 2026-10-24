# OH-52: Archive information clarity

## Source-backed problem

Accepted isolated Chrome r5 shows an archived session with a gray `online` detail-header label. `getSessionStatus` intentionally returns `shouldShowStatus:false` for archived sessions, but the real info screen renders status unconditionally. Both lines predate OH-52; archive/runtime assertions are correct. The same run shows the new unknown-work explanation truncated before its older-host guidance. These presentation defects remain tracked under OH-52, separate from accepted bounded archive/history behavior.

## Work and proof

- [ ] 🔴 Add decisive regression assertions to the existing actual info/browser path: archived status respects canonical suppression, and the unknown-work explanation is readable. Retain owner PR controls and confirmed history.
- [ ] 🔴 Correct existing consumers using their canonical contracts. Do not change runtime/ownership/permission semantics or add a parallel status classifier/test-only wrapper. Preserve live idle/unknown information.
- [ ] 🔴 Run affected checks/types and the canonical isolated Chrome workflow, inspect final captures, then commit/push exact source/test/plan paths for root review.

Use actual Astra/high, retaining cumulative OH-52 2failedSol/0Astra. No daily app, hosted account, real provider, native hotkey or cleanup action. Root owns Linear/tasks/phase9; worker owns this phase and coordinated UI/fixture source. Phase17 source and r5 evidence stay preserved.

## Execution evidence

The real info header now has a stable test ID, with no behavior change yet. Existing composed Chrome fixture asserts header suppression after archive and reload, retained status for inactive unarchived/unknown sessions, and actual subtitle scroll dimensions so hidden older-host guidance cannot pass merely by existing in DOM text. Soft presentation assertions allow both regressions to be observed in one run while preserving every prior archive/history/owner/preference assertion. Packages/tests typecheck passed before the RED run; production behavior correction is pending.
