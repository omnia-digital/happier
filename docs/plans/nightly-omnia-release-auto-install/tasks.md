# Tasks

| # | Task | Status |
| --- | --- | --- |
| 1 | Diagnose the stalled nightly | 🟢 Cassian runner stopped, no `KeepAlive` |
| 2 | Map build path, local runtime, contracts | 🟢 |
| 3 | Restore Cassian runner with `KeepAlive=true` | 🟢 Running, picked up queued run 41813506401 |
| 4 | Select newest green SHA, gate on release, admit ancestor SHA on Cassian | 🟡 Implemented, final test run pending |
| 5 | `HAPPIER_STACK_TAURI_BUNDLES`, Cassian app build step, publish job | 🟡 Implemented, real Cassian build pending |
| 6 | Mac update agent with tests | 🟡 Implemented, final test run pending |
| 7 | Update `docs/fork-production.md` | 🟢 |
| 8 | Probe bundle replacement under launchd on this Mac | 🟢 Rename and write allowed for an ad-hoc copy |
| 9 | Adversarial review and fixes | 🟡 Three reviews done, fixes applied, delta review pending |
| 10 | Open PR to `dev` | 🔴 |
| 11 | After merge: dispatch nightly, install agent, verify app and clones | 🔴 Merge pre-approved by Josh once checks pass |
