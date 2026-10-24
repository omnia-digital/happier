# OH-52: Autoarchive source boundary review

## Basis and scope

Independently review coherent slice2 through `f1f8bc0530`, against phase10 and OH-52. Source slice1 is accepted; slice3a creation custody is separate moving work. Author has focused UI30, protocol history1, UI types and locale integrity green. No real provider, archive, cleanup, native or daily-state actions.

Review the full affected corridor: account preferences, catalog/warm/shell metadata projection, current local work eligibility, qualified fresh provider reads, foreground five-minute scheduling and concurrency, current Home/account/association guards, canonical archive admission/deadline, confirmed history and retry, manual/bulk neighbors, and old-client/server behavior. Assess actual owner-level test value rather than mock call counts.

## Highest risks and QA coverage

- No archive with zero/partial/draft/unknown/inaccessible PRs, current activity/pending work, changed association, disabled preference, hidden app or stale account.
- Stable remote merge is eventually detected without interaction; bounded queued work cancels and does not duplicate, deadlock or disturb global session synchronization.
- 409/failed archive never records successful history or triggers cleanup. Confirmed archive plus history failure remains understandable/retryable; disabling future automation does not lose audit completion.
- Preserve manual/bulk archive, selection/history, unknown metadata and older clients; do not claim atomic encrypted metadata/archive updates or restart durability without proof.

## Tasks

- [ ] 🟡 Independent source/test review; high-confidence findings with deciding evidence only.
- [ ] 🔴 Root adjudication, focused corrections and required checks.
- [ ] 🔴 Composed isolated Preferences/provider fixture/archive/history receipt, then rendered inspection.

Routing selects actual Sol/high, zero failed cycles. Reviewer owns this report only and may run existing focused tests. Author owns fixes/tests. Root owns Linear, tasks, phase9 and final verdict. No source edits in the review lane.
