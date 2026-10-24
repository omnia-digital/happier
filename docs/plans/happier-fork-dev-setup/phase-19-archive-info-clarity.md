# OH-52: Archive information clarity

## Source-backed problem

Accepted isolated Chrome r5 shows an archived session with a gray `online` detail-header label. `getSessionStatus` intentionally returns `shouldShowStatus:false` for archived sessions, but the real info screen renders status unconditionally. Both lines predate OH-52; archive/runtime assertions are correct. The same run shows the new unknown-work explanation truncated before its older-host guidance. These presentation defects remain tracked under OH-52, separate from accepted bounded archive/history behavior.

## Work and proof

- [x] 🟢 Add decisive regression assertions to the existing actual info/browser path: archived status respects canonical suppression, and the unknown-work explanation is readable. Retain owner PR controls and confirmed history.
- [x] 🟢 Correct existing consumers using their canonical contracts. Do not change runtime/ownership/permission semantics or add a parallel status classifier/test-only wrapper. Preserve live idle/unknown information.
- [ ] 🔴 Run affected checks/types and the canonical isolated Chrome workflow, inspect final captures, then commit/push exact source/test/plan paths for root review.

Use actual Astra/high, retaining cumulative OH-52 2failedSol/0Astra. No daily app, hosted account, real provider, native hotkey or cleanup action. Root owns Linear/tasks/phase9; worker owns this phase and coordinated UI/fixture source. Phase17 source and r5 evidence stay preserved.

## Execution evidence

The real info header now has a stable test ID, with no behavior change yet. Existing composed Chrome fixture asserts header suppression after archive and reload, retained status for inactive unarchived/unknown sessions, and actual subtitle scroll dimensions so hidden older-host guidance cannot pass merely by existing in DOM text. Soft presentation assertions allow both regressions to be observed in one run while preserving every prior archive/history/owner/preference assertion. Packages/tests typecheck passed before the RED run; production behavior correction is pending.

Root clarified the bounded consumer contract before the source correction: preserve the existing non-archived online-idle header too. `shouldShowStatus` also suppresses ordinary idle labels for compact consumers, so applying it unconditionally here would remove useful existing detail information. Reuse this screen's existing `isArchivedSession` classification to suppress only the archived header row; do not change the canonical status helper. The same real publisher/browser flow will check online idle before clean close as well as inactive and unknown-work status afterwards.

RED: pushed fixture `0c43d2e683`, system Chrome r6, exit1. Three intended assertions failed: archived header count1 instead of0 before and after reload, plus the unknown-work subtitle's actual `scrollWidth > clientWidth`. All existing owner controls/preferences/server archive/persisted history/open and unknown skips completed. Artifacts remain in `packages/tests/test-results-oh52-autoarchive-r6/`.

Minimal correction: info hides only the existing status row when its existing `isArchivedSession` is true; SessionPullRequests requests `subtitleLines={0}` from canonical Item so the complete existing explanation wraps. No status helper, runtime, ownership, archive or provider semantics changed. The same composed fixture additionally visits real live idle before acknowledged clean close and asserts the existing online label, then retains inactive/unknown header checks. Adjacent93 tests across mounted SessionPullRequests and canonical sessionUtils passed; UI and packages/tests typechecks passed. Deciding Chrome GREEN verification pending.

Intermediate GREEN: pushed `fb272fcd73`, system Chrome r7 passed (1 test,51.3s overall). It proves header suppression, real online-idle preservation and unclipped guidance through the complete existing journey. Self-review found the same statusText also rendered by the always-mounted lower Activity section (`SessionInfoActivityGroup`), outside the prior screenshot viewport. Root authorized completing the same archived-only correction there, preserving the Activity container, raw diagnostic content and non-archived status. Existing Session.archivedAt remains the classification owner. The final fixture now checks that row absent for archived/reload and retained for online-idle/unknown work. r7 proves its covered surface only; final coherent replay pending.
