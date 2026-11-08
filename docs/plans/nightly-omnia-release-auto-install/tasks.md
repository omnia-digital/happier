# Tasks

| # | Task | Status |
| --- | --- | --- |
| 1 | Diagnose the stalled nightly | 🟢 Cassian runner stopped, no `KeepAlive` |
| 2 | Map build path, local runtime, contracts | 🟢 |
| 3 | Restore Cassian runner with `KeepAlive=true` | 🟢 Running, picked up queued run 41813506401 |
| 4 | Select newest green SHA, gate on release, admit ancestor SHA on Cassian | 🟢 |
| 5 | `HAPPIER_STACK_TAURI_BUNDLES`, Cassian app build step, publish job | 🟢 First release published by run 42056243392 |
| 6 | Mac update agent with tests | 🟢 Installed; clones refreshed; deferring the swap while Josh is active |
| 7 | Update `docs/fork-production.md` | 🟢 |
| 8 | Probe bundle replacement under launchd on this Mac | 🟢 Rename and write allowed for an ad-hoc copy |
| 9 | Adversarial review and fixes | 🟢 |
| 10 | Open PR to `dev` | 🟢 PR 29 merged as da49cd8622 |
| 11 | After merge: dispatch nightly, install agent, verify app and clones | 🟢 Swap verified; Josh confirmed login and sessions |
| 12 | Install without waiting for idle time (Josh, 2026-11-08) | 🟡 |
| 13 | Install now prompt when a release lands (Josh, 2026-11-08) | 🟡 74 tests pass; two review lenses done and fixed. After its release lands, run `install` from happier-dev so the agent runs every 5 minutes |
