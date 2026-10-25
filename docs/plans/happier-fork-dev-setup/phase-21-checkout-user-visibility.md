# OH-52: Read-only checkout-user visibility discovery

## Scope

Determine what the ordinary macOS fork CLI can actually prove about a claimed checkout's users before any future removal. Existing account-visible sessions and current-UID lsof paths do not establish exhaustive host visibility. Reuse daemon session/runner/marker/terminal/execution owners; establish native permission limits without installing a helper or changing services. Windows/Linux remain unverified, not inferred from macOS.

## Tasks

- [ ] 🔴 Trace canonical session markers, runner probes, terminal hosts and execution runs, including other Happier accounts/Homes under the same OS user. Preserve incomplete/unknown versus proven absence.
- [ ] 🔴 Check installed primary OS interfaces and actual current permission limits. If useful, use only owned disposable child processes to demonstrate cwd/file-handle coverage, hidden/inaccessible cases and races. Never print unrelated commands, paths or secrets.
- [ ] 🔴 Report whether a practical nonprivileged complete observer exists, exact unsupported cases, minimal canonical seams and deciding future tests. Do not silently equate current-UID coverage with all host users or treat a test fixture as global completeness.
- [ ] 🔴 Commit/push only this report and evidence references for root review. No source execution/capability/deletion, privileged helper, process stop outside owned fixtures, daily app, account preference or service change.

Actual Astra/high discovery retains OH-52 cumulative2failedSol/0Astra. Root owns Linear/tasks/phase9; this worker owns only phase21. Phase19 UI and phase20 Git source are independent workers' paths. A concrete platform limit is a useful finding; do not manufacture a green permission claim to keep the project moving.

## Recovered execution evidence

The interrupted delegate reported broad libproc/lsof permission observations, but did not finish this report. Root independently rechecked the deciding current permission boundary through installed libproc APIs without exposing unrelated process data: the nonroot task process can read its own cwd/FD inventory; PID1 returns `EPERM` for cwd (`PROC_PIDVNODEPATHINFO`), FD list and fileport list. Constants were verified in the installed macOS SDK's `sys/proc_info.h`. No process was stopped and no privilege, service or account setting changed. This proves a visibility gap, not a complete census; the delegate's earlier exact process counts are not independently verified here.

Cleanup therefore retains `process_visibility_unknown`. Existing account/Homes/marker inventories cannot turn an OS permission failure into proven all-host absence. A privileged helper or a weaker process policy would change the authority/tradeoff and is not implicitly authorized. This blocks automatic cleanup, not independent source/UI work. No additional observer implementation or new plan is created under the updated instructions.
