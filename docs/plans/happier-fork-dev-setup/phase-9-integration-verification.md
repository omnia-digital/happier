# OH-56, OH-58 and OH-59: Integration verification

Josh explicitly chose **Keep native QA deferred** on October 24. This supersedes the pending macOS idle-window request and includes native hotkeys. Do not launch or automate native acceptance until he resumes it. Continue independent source/browser work without interacting with the daily native app. Remaining native checks are deferred and unverified; provider/remote-host acceptance stays open, and isolated browser evidence does not close those gates.

## OH-58 ticket linking

- 🟢 Protocol/CLI fixed-read reader remains opt-in and machine-only. Root independently passes reader/adapter 9 and encrypted machine/session authorization 4 (the latter overlaps OH-59).
- 🟢 Root independently passes status/transport/opener 14 in `/tmp/happier-oh58-ui-root-final.log`.
- 🟢 Save-race correction `35c3dbd44d` forwards the captured account and existing caller lifetime through the canonical metadata writer. Emission rechecks after awaited context/socket acquisition and uses the canonical credential guard immediately around emission. Root independently passes emitter/helper/real-Sync 89 in `/tmp/happier-oh58-metadata-root-independent.log`.
- 🟢 Isolated Chrome r4 passes 1/1 in 58.2s: actual opt-in daemon, encrypted settings/saved secret/MCP process; link/read; pinned row; shared custom status update; supported Linear scheme emission and explicit web destination; reload/unknown metadata preservation; change; revoked-access stale; concurrent real metadata writer prevents a stale editor overwriting the association; remove/reload. This uses a fixture provider, not real vendor authentication.
- 🟢 Final compact correction `5fa06d0543` puts freshness first so a long workflow name cannot hide Stale. Strict Chrome r6 passes 1/1 in 71s with DOM Range proof of the entire leading qualifier within its clip; root visually inspected the corrected image. Final artifacts are under `.project/logs/e2e/2026-10-24T03-10-22-879Z-ui-e2e-c61dccfe/session-ticket-linking/browser-proof-r6/`. Earlier loading and hidden-qualifier captures are retained as their actual states.
- 🟢 Root independently passes final label/access 4 (`/tmp/happier-oh58-label-root-final.log`). Whole locale integrity, relevant package typechecks and Tauri configuration pass. Source-reviewed App/MCP guidance passes content/types and is pushed in `fa3d670abd`. Final assessment VERIFY Sol/high; preserve one failed Sol / zero failed Astra rendered-review cycles. Actual vendor authentication/status changes and installed native-app receipt remain open; no daily service change.

## OH-59 machine monitoring

### Current refinement: one line per machine

Josh explicitly requests each machine's specifications on one line, expandable on click. Source `1f729bdb83` refines the existing row disclosure in `MachineMonitoringSection`: collapsed machine identity and compact metric summary, with full readings, metric definitions, unavailable/stale/offline explanations, storage volume and GPU identities when expanded. All five metrics, chosen machine identity, scoped polling and section-collapse behavior are preserved. Narrow and large-text summaries stay on one line; truncated information remains reachable through expansion and accessibility. Click/keyboard activation toggles each machine independently through canonical `PressableSurface` focus and press behavior. `SidebarView` remains the only consuming surface; no competing collector, transport, setting or expansion owner was added.

Owner regression RED1fail/2pass precedes implementation; adjacent12tests/4files and final component/hook5tests/2files pass. Root independently passes5/2 (`.project/logs/tests/oh59-compact-root-owner-review.log`) and observes8render commits for2fixture machines with zero global/session-store notifications; this is host-test React measurement, not browser/native timing or a speedup claim. UI and fixture typechecks pass at the final typography correction (`/tmp/oh59-compact-scaled-ui-types.log`, `/tmp/oh59-compact-scaled-fixture-types.log`).

Initial Chrome r1 passed34.6s but visual review found machine text remained14px at200% while surrounding chrome scaled. Strengthening the assertion gives meaningful browser RED14px instead of28. `1654b465d9` uses existing `Typography.rowTitle`/`rowMeta` tokens and preserves monospaced metrics. Strict corrected systemChrome1/1 passes35.3s (`/tmp/oh59-compact-chrome-scaled-r2.log`): actual summary text12px at100% and24px at200%, light/dark, narrow geometry/nooverflow, full name/readings/volume, pointer and Enter/Space toggles, and retained keyboard focus. Root independently inspects compact light, compact dark200%, expanded top dark200% and fully visible wrapped volume/load screenshots under `.project/logs/e2e/2026-10-24T21-45-51-378Z-ui-e2e-oh59-machine-monitoring-27fd66d8/machine-monitoring/`. Retain2failedSol/1failedAstra; the weaker earlier green is not final scaling proof. Published App guidance is updated; docs content/types/47guardrails pass.

This closes only the source/browser refinement. Native QA remains deferred and the request does not approve the earlier daily cloud-service trial. Source intents are (1) compact per-machine disclosure with full readings/presence, and (2) canonical typography with actual200% scaling and nooverflow. Both forward-port dispositions remain blocked: optional `../v0.3.x` and `../0.3` are absent and no verified destination checkout was supplied. No destination, daily service, installed app or host configuration changed.

### Installed-host gap: October 24 follow-up

Josh reports all online machines show dashes and “This machine CLI does not support host metrics.” Read-only daemon-state and live-process checks now establish this Mac's cloud/local daemons run0.2.17, Cassian's cloud daemon0.2.12, and Josh-PC's cloud daemon0.2.16. Installed entry points resolve to those versions. Immutable CLI tags0.2.12 (`a357c65536`),0.2.16 (`b8d1c449c4`) and0.2.17 (`a2c45c8680`) contain neither `tool.machineMetrics` nor `collectHostMetrics`. Their missing producer explains the displayed unsupported state; an ordinary update to the verified0.2.17 release would not add it.

Current `loadMachineMetrics` invokes through the canonical scoped capability RPC directly. Unknown capability/method responses become unsupported; transport or parsing failures become errors. `machineMetricsStore` retries unsupported entries on visible cadence/resume/target refresh, so no permanent negative-cache or advertisement bug was found. Current machine context registers the existing collector; session-only context intentionally does not. No second telemetry source or transport is needed.

The actual current Mac cloud receiver independently confirms this path: the normal CLI credential reader plus `callExactMachineRpc` sends only `capabilities.invoke`/`tool.machineMetrics`/`snapshot` to the daemon state's existing machine ID and receives `{ok:false,error:{code:'unsupported-capability'}}`. The request uses the canonical30-second invoke budget; no credential/key values are printed, copied or changed. This proves the actual installed-host rejection, not only an inference from version tags.

Two direct read-only samples from Josh-PC's existing source checkout (`746e43429e`, collector last changed at `c333678cd2`, matching the local owner) pass protocol schema validation: CPU6.46→7.54%, memory35.94→35.91%, storage88.17% used on `C:\`, two GPU identities at measured0%, and Windows load average unavailable/unsupported-platform. Collection took6379ms then1010ms. The successful probe used Node's TSX import with the program on stdin; an earlier TSX eval invocation exited0 without observations and supplies no collection evidence. These results verify the actual Windows collector, not encrypted remote capability delivery, existing machine attribution in the sidebar, or installed-host enablement.

This Mac's cloud daemon is managed by `com.happier.cli.daemon.default`; its LaunchAgent uses `AbandonProcessGroup=true` and `KeepAlive={SuccessfulExit:false}`. The separate localhost service must be preserved. A bare source-daemon takeover is not a safe rollout: the installed-service guard rejects competing manual startup, and the unchanged0.2.17 version alone does not distinguish the fork source. Prepare the existing service owner's cloud-only source-runtime selection and installed-runtime rollback before requesting activation. No daily daemon/service, credentials, host configuration or native app was changed. Native QA remains explicitly deferred. OH-59 stays In Progress; installed-host RPC/UI, Linux and remaining platform gates stay open. Retain2failedSol/0failedAstra.

The ordinary current checkout `yarn cli:build` passes in27.67s (`.project/logs/tests/oh59-current-cli-dev-build.log`), with existing empty-chunk, deprecation and circular-chunk warnings retained. No archive/installer/release artifact was produced. Canonical `service install --yes --dry-run --json` passes for both source selection and installed-runtime rollback. The source preview rewrites only the existing default-following plist, points it to the existing managed JavaScript launcher plus this checkout's `apps/cli/bin/happier.mjs`, and reloads its existing launchd label. Home, stable channel, at-login policy, desktop bundle ownership and process-group policy are preserved. The current persisted default is cloud; the legacy `com.happier.cli.daemon` plist and loaded job are absent. Its harmless legacy cleanup commands remain explicit in the preview; no localhost or other service is selected for removal. Rollback selects `/Users/Josh/.happier/bin/happier` through the same owner; re-preview immediately before applying because the currently observed installed pointer can change. Private previews: `oh59-mac-source-service-plan.json` and `oh59-mac-installed-service-rollback-plan.json` in `.project/logs/tests/`.

Activation is not authorized yet. A proposed bounded trial would replace/restart only this Mac's cloud service, read metrics through the normal authenticated machine RPC, then restore the installed runtime. It would briefly interrupt daemon control and new launches; existing runners are intended to survive but uninterrupted sessions are not guaranteed. All current fork daemon changes would become live, and rollback cannot undo persisted or outward effects. The localhost service, other hosts and native app stay outside this trial. Focused current service-reload/ownership/stop-session/metrics-authorization coverage passes19tests across4files (`oh59-source-service-admission-focused.log`). An initial shard-runner invocation ignored the requested file filters and was intentionally interrupted with exit130; its partial broader log is not a suite result. Documentation guardrails pass47/47.

### Earlier source and browser evidence

- 🟢 Root independently passes transport/store/render 8 in `/tmp/happier-oh59-ui-root-independent.log`, plus prior encrypted machine/session authorization 4. Render measurement: two fixture rows, eight commits, 12.81ms cumulative React duration, zero session/global store notifications. This is host-test measurement, not native/browser timing.
- 🟢 First Chrome functional assertions pass 1/1 in 413s: real 180-second cadence, changing actual local Mac readings, explicit older CLI, offline/reconnect and selected-session independence.
- 🟢 The first failed layout screenshot is preserved under `.project/logs/e2e/2026-10-24T02-48-45-482Z-ui-e2e-oh59-machine-monitoring-30d32f92/machine-monitoring/`. Placement correction `4d1498bdae` recovers strict Chrome3: 1/1 in 336s at `0a7820d92f`, including actual Start New Session navigation, nonoverlap, chosen cloud/blue glyph, changing actual Mac readings, real 180-second cadence, offline/reconnect and collapse. Root visually inspected both final screenshots under `.project/logs/e2e/2026-10-24T03-13-16-923Z-ui-e2e-oh59-machine-monitoring-930dc997/machine-monitoring/`.
- 🟢 `0a7820d92f` carries a metrics-only receiving collection budget in encrypted capability params, bounded by the shared existing 30-second invoke budget. Root independently passes three actual-process checks: a hanging native child exits at the supplied budget, invalid/unbounded budgets are rejected, and a normal one-second sample succeeds. This is not exact client-deadline cancellation across network delay. Relay/global effectful-RPC behavior stays unchanged.
- 🟢 The same checkpoint fixes a real target-churn cadence defect: changing one machine's presence no longer tears down/restarts the scope timer. The retainer updates targets in place. Root independently passes public-hook/store/transport 8 (`/tmp/happier-oh59-cadence-root-final.log`); native-query budget 3 pass in `/tmp/happier-oh59-budget-root-final.log`. Author UI/CLI/tests types, protocol build, locale integrity and scoped capability integration pass.
- 🟢 Final root review found hidden Tauri windows still collect because the global runtime-active policy intentionally permits background session sync. Test-only checkpoint `dfd33ac39c` proves three reads over 360 hidden seconds instead of the initial one. Actual Astra/high correction `af9989a914` uses the metrics-only `isRuntimeActive && isHostVisible` predicate and preserves global sync policy. Root independently passes lifecycle 9/9 (`/tmp/happier-oh59-visibility-root-final.log`), including foreground overdue refresh and collapse cleanup. Preserve two failed Sol / zero failed Astra cycles; accepted visible Chrome gates remain valid.
- 🟢 A same-ID profile URL replacement advisory was refuted through the real canonical profile owner. No speculative generation mechanism is added.
- 🟡 Actual read-only Mac IOAccelerator data refutes blanket Darwin GPU unavailability: this Apple M5 Pro exposes finite Device Utilization %. Source `dcb8567308` projects structured ioreg/plutil fields with exact registry identity, preserves the receiving cancellation budget, and reports missing/invalid statistics honestly. Root independently passes parser 8/8 (`/tmp/happier-oh59-mac-gpu-root-final.log`); author actual collector reads 29→30→31% in approximately 1.01 seconds. Real child cancellation/deadline checks passed below; targeted Chrome GPU presentation remains missing after setup failure. This observed driver property is not claimed as a universal Apple API.
- 🟢 Mac OS-boundary validation found a real large-pipe failure: killing plutil with a 120KB registry input produced uncaught EPIPE despite the initial four assertions passing. Correction `c333678cd2` owns the stdin completion/error through Node streams and terminates only the owned child on input failure. Root independently passes final actual OS 5/5 (`/tmp/happier-oh59-mac-gpu-root-boundary-final.log`), including both hanging native queries and early input closure, with no unhandled error. Root actual source collection reports Apple M5 Pro, exact registry ID, valid 0% and 1036ms (`/tmp/happier-oh59-mac-gpu-root-runtime.log`); earlier nonzero observations remain separate evidence. Targeted Chrome GPU presentation failed in setup after 836 seconds with a zero-millisecond test body: export fell back to Metro, whose primary script never became ready. The existing fallback swallowed the original export exception; no product assertion ran. Logs and fixture artifacts under `2026-10-24T03-56-53-938Z-ui-e2e-oh59-machine-monitoring-af27de84` are preserved, and owned fixture processes exited. No blind rerun or timeout increase.
- 🟢 Canonical App machine-monitoring guidance is source-reviewed by the author and pushed at `de11378bd7`. Docs content, types and 47 guardrails pass (`/tmp/happier-oh59-doc-content.log`, `-types.log`, `-tests.log`). It states capacity definitions, supported-interface GPU limits, visible/expanded cadence, older CLI and pending native/second-host acceptance.
- 🟡 Read-only Windows input has 363 valid GPU-engine rows that parse into two physical devices, both zero in that sample. This proves availability/parsing, not remote new-capability RPC or overall multi-host end-to-end acceptance. No remote files, service or daemon changed. Actual second-host, Linux runtime and native UI remain open.

Source review accepts the Mac collector and lifecycle recovery. The latest router assessment is VERIFY Astra/high with the strict actual-GPU Chrome gate below now passing. Full-issue behavior stays unverified because native, second-host and Linux gates remain missing. This does not close OH-59. Review counters remain two failed Sol / zero failed Astra.

After the OH-4 harness correction, targeted actual-GPU Chrome passes1/1 in140s (body11.7s), exit0 (`/tmp/happier-oh59-gpu-harness-fixed-r2-chrome.log`). Authenticated isolated fixture RPC uses the actual Darwin collector: Apple M5 Pro, `ioreg:4294969373`,28%. Root inspected the unique image/measurement under `.project/logs/e2e/2026-10-24T04-58-27-285Z-ui-e2e-oh59-machine-monitoring-d1fec20b/machine-monitoring/`. The percentage is visible, but details below the panel clip are only asserted as DOM text. The same canonical browser case now scrolls the exact detail into view and requires full viewport intersection before its screenshot; that stronger rendered-identity gate is pending. This is test-observation refinement, not a reproduced production defect. Earlier setup failure remains recorded; native/additional-host/Linux gates stay open.

The stronger case now passes1/1 in176s (body7.7s), exit0 (`/tmp/happier-oh59-gpu-visible-details-r3-chrome.log`). Root inspected the final unique image and JSON under `.project/logs/e2e/2026-10-24T05-08-47-416Z-ui-e2e-oh59-machine-monitoring-08bb33c0/machine-monitoring/`: Apple M5 Pro, `ioreg:4294969373`,24% are fully visible inside the scrollable panel. Exact detail viewport intersection is asserted before capture. Final `packages/tests` typecheck passes22.46s. The fixture transport remains authenticated plain machine RPC plus actual host collection, not an installed new daily CLI. Strict Mac GPU presentation is accepted; external/native/second-host/Linux limits and prior setup failures remain explicit.

## OH-56 indexed search

- 🟢 Partial content source `ecf1d2b66d` reuses the existing gated machine-memory status/search owner. Scope is explicitly one Home and machine; results are indexed summaries with message sequence navigation. No account-wide transcript coverage or automatic indexing enablement is claimed.
- 🟢 Scope controls/credential-event correction `c116edab2c` has author mounted 13/13 and current UI typecheck green. A held old result is discarded on the actual credential event; changing Home/machine clears old results and restores input focus.
- 🟢 Title and content Chrome cases pass individually; final content replay includes Change Home/machine and message navigation. Detailed new-copy localization is pushed at `eb86719ffd`; monitoring locale integrity passed separately at `50fd082671`.
- 🟢 Actual Astra/high correction `733e1c0327` replaces the internal scoped RPC mock with HTTP/Socket.IO boundaries, retaining real credentials, routing, key envelopes and encryption. Distinct active A/B and foreign secrets, held old response, scope clearing/focus/navigation pass. Disabling the real credential callback makes the deciding test RED; the exact mutation was restored and diff-verified. Author 48/12 files and UI types pass; root independently passes final mounted6 + actual crypto owner1 (`/tmp/happier-oh56-content-root-final.log`). The initial internal-mock proof was rejected, not relabeled as valid.
- 🟢 Final source assessment VERIFY Astra/high, retaining two cumulative failed Sol / zero failed Astra review cycles. Active Home unit transport is the canonical scoped fallback, not a hydrated direct socket. Native hotkey QA remains deferred and indexed coverage remains explicitly partial.

## OH-60 status organization

- 🟢 Source controls and live owners through `9dc80431a9` reuse canonical row status, the existing runtime clock, account sort settings and local grouping settings. Existing sort/layout/manual organization is preserved. Unknown workflow ranks are not compared as one global workflow; known workflow ordering and custom names are retained.
- 🟢 Root independently passes final projector9 + status inputs6 + embedded/shell association publication2, 17/17 (`/tmp/happier-oh60-root-final.log`), and shared demand3 within `/tmp/happier-oh52-oh60-root-contracts.log`. Later `d312c8d170` adds a coupled real-owner organization case (author projector10), without changing production: folders, Pinned, filtering, machine/repository presentation and current visible indices pass through their actual producers.
- 🟢 A held read proves one active process per configured reader source for 40 candidate tickets; retired queued work skips transport. The same demand owner serves list, row and header consumers. There is no coverage cutoff or added polling owner.
- 🟢 Measured 500-row unrelated and streaming notifications initially reclassified every row. A canonical overlay/clock reuse guard now performs zero classifier reads for both candidate and unrelated streaming records while runtime expiry still updates. Root measured workload output is host-test evidence, not native responsiveness timing. Integrated author UI typecheck passes; locale integrity includes the explicit Traditional Chinese override.
- 🟡 Chrome r1 failed fixture setup when an encrypted account correctly rejected a plaintext publisher machine. R2 catalog rows lacked sealed per-session data-key envelopes; the canonical loader intentionally hid their unavailable metadata. Fixture correction `e19d48e773` uses the existing seal/recipient/AES helpers and verifies all22 catalog envelopes. UI and tests types pass. Both setup failures remain recorded.
- 🔴 R3 reaches the real catalog, pinning and controls, then exposes a product gap: eager4/background0 metadata policy leaves older candidate ticket associations undiscovered, so only DEV4/5 reach the reader while DEV1–3 do not. Correct through the existing scoped/coalesced exact-shell metadata-demand owner, preserving bounded concurrency and unknown versus confirmed No ticket. The warm snapshot projection also omits the persisted association and is under deciding regression. Retain one failed Sol / zero failed Astra. Router returns VERIFY Sol/high even with the failed check and full behavior unverified; its advisory result cannot override the failed composed gate. Native/provider acceptance remains open.
- 🟢 Recovery through `9ce7947ee6` independently passes root69/5 files (`/tmp/happier-oh60-metadata-root-final.log`,87.15s), with author UI/tests types green. Deciding REDs reproduced foreign hydration overwriting an active same-ID record, presentation-order demand retiring/requeueing the same candidate set, and unreadable metadata staying Checking. The canonical boundary now limits explicit hydration to the active Home; concurrent Home cache remains fully hydrated/scoped and both same-ID associations group independently. Sorted/deduplicated candidate membership retains one demand lifetime; completion consults current canonical metadata and reports unavailable honestly. Metadata-first work joined by a real route preserves message demand. Root source review finds no remaining issue in that delta. Chrome r4's all-rendered DOM-absence setup assumption remains a fixture failure, and corrected composed r5 is still running; no browser acceptance inferred from these host checks.
- 🟢 Final strict Chrome r10 passes1/1 in69s, with prior complete r9 pass retained. Root inspected both desktop and settled390px captures under `.project/logs/e2e/oh60-status-organization-r10-playwright/sessionList.statusOrganiza-54011-d-restores-persisted-layout/`. The journey covers pre-visible discovery, independent/mixed choices, actual runtime/provider transitions, selection/current keyboard successor, filtering, reload settings, machine restoration, unique rows and encrypted unknown metadata preservation. R5–r8 separately exposed fixture event, Clear behavior, focus-zone and phone-surface assumptions; no production changes followed the accepted69 boundary. Final context `40a1593bc6` is pushed; assessment VERIFY Sol/high retains1failedSol/0Astra. Native/vendor and optional absent0.3 checkout proof remain open. Canonical App guidance now explains the controls and saved layout without claiming a stable release; content/types pass (`/tmp/happier-oh60-doc-content-final.log`, `/tmp/happier-oh60-doc-types.log`). Existing47 docs guardrails passed earlier with unchanged code.

## Next source lanes

Actual Sol/high continues OH-60 through the existing status/organization owners and [phase-8](phase-8-status-organization.md). Metadata recovery `e48cf42d9b` passes author62 plus UI/tests types, including metadata-first hydration joined by a real route request without losing message demand. Root advisory review requires stable identity-set demand and the canonical concurrent-Home cache path before accepting bulk foreign metadata hydration. Chrome r4's all-rendered web row policy invalidated its DOM-absence setup assertion; the original r3 product failure remains recorded, with one failed Sol / zero failed Astra.

OH-52 source slice1 through `f8b50926ef` is accepted at its bounded source boundary: final normal-tracing Chrome-r4 passes1/1 in1.9min, encrypted add/change/remove/reload assertions and both compact images independently inspected. Root independently passes UI20 and final GitHub case-alias protocol4/CLI1/UI2 delta. Diagnostic trace-on teardown failures remain separate evidence. Router assessment VERIFY Sol/high retains zero formal failed review cycles; this does not complete the full issue. Real provider authentication/read RPC, archive automation and safe cleanup remain open under [phase-10](phase-10-archive-automation.md); no actual archive/deletion or provider change is implied.

OH-4 browser-build correction `fa79cbb6e4` tracks shared runtime bytes and preserves both export/Metro errors. Independent checks and one affected OH-59 GPU browser replay follow [phase-12](phase-12-browser-build-reliability.md). OH-5 source release ownership through `c80443d75e` is under review, with Cargo found outside PATH and focused Rust compilation running. No native installation, release, provider or daily-service action is authorized by these source checks.

OH-4's final disposable-fixture correction through `f7b9906ec3` independently passes root35/35 in10.11s (`/tmp/happier-oh4-harness-root-isolated-final.log`). The prior root33/35 failure remains a fixture/lifecycle result: mocked export cases traversed changing live inputs, timed out at the existing5s budget and could overlap the next case. That budget remains unchanged. Default `app.local.js` absent/present is covered; an explicit external config override is unset/currentlane unaffected but uncovered. One existing-namespace OH-59 actual-GPU Chrome replay is running with unique output/report evidence.

OH-5 bounded source ownership is accepted through `321e54f01a`: root release/Tauri/Docker/Homebrew19 and web-updater9 pass. Root broad installer run independently reproduced the whitespace verifier bypass before its correction; current narrow shared-verifier and shell/PowerShell refusal2 pass (`/tmp/happier-oh5-trust-root-corrected-final.log`). Author full installer14 pass/2 Windows executable skips, source types, installer sync and actual Rust updater refusal1 pass. Router VERIFY Sol/high retains zero formal failed review cycles; earlier advisory bypasses were corrected within the source cycle. Registered identifiers, signer/feed ownership, Developer ID/notarization, configured candidate, installed update/coexistence and real Windows/Linux acceptance remain open. No installation, release or daily-app action occurred.

OH-52 slice2 through `f1f8bc0530` has author UI30/protocol history1/types/locale checks green, but independent source review identifies a real discovery failure: full eligibility is required before metadata hydration, so cold rows with no decrypted links and warm rows lacking live-work proof are missed. Correct the canonical cheap hydration gate versus final full-work/association gate through bounded metadata-only loading. Retain1failedSol/0Astra for this failed source boundary; router returns VERIFY Sol/high despite the failed check, which cannot override the failure. [Phase15](phase-15-autoarchive-source-review.md) owns ongoing independent review. The only foreground provider cadence is five minutes; disabled/hidden work stops, and metadata and provider limiting must not recursively acquire one limiter. Composed isolated archive/history and native/vendor gates remain pending.

OH-52 [phase13](phase-13-host-cleanup-proof.md) discovery through `6700744af1` is accepted as a source map, not a custody or process-use proof. [Phase14](phase-14-worktree-creation-custody.md) begins durable creation custody only, WIP `bff0ac12e2`; no deletion. Root advisory review reproduced ring record/bind mismatch and missing Home isolation, now corrected in author focused tests before its source boundary. Existing/unknown/resumed/unclaimed resources cannot acquire cleanup authority from a path or caller report. Exhaustive process and integration proof remain later gates.

OH-52 source3a is accepted through `1e5c2af051` at its bounded source boundary. Root independently passes canonical CLI owner84 and Claude startup integration27, exit0 (`/tmp/happier-oh52-custody-root-final.log`, `/tmp/happier-oh52-custody-claude-root-final.log`). Actual SCM capture and authenticated child API creation evidence bind only the correlated nonce/path/PID/account/machine/Home/ring; ordinary sessions create no custody storage. Author UI32/protocol4/types are green. Router VERIFY Sol/high retains the global OH-52 one failed Sol / zero failed Astra from source2; all custody advisory findings were corrected before this boundary. Cleanup, exhaustive resource users, Git integration proof, native and installed compatibility remain later gates; no resource was deleted.

OH-52 source2 is accepted through `5705bd9957` at its bounded source boundary. Actual encrypted warm/cold snapshot production, valid data-key envelopes and real metadata-only Sync loading reach the real observer with one metadata GET and provider read, without transcript loading. Root independently passes101/8 files (`/tmp/happier-oh52-producer-root-final.log`), plus final legacy/access15/2 (`/tmp/happier-oh52-legacy-access-root-final.log`); adjacent actual v2Sync and prior compat91/2 also pass. Independent reviewer passes final adjacent47 and actual producer2; the account-dispatch guard's82 remain accepted. Legacy share coercion no longer turns omitted or incomplete view roles into owner/admin; current server remains final archive permission authority. Router VERIFY Sol/high retains1failedSol/0Astra. Composed isolated Chrome, live vendor and native gates remain open; reason persistence is not atomic with server archive and its pending retry is not restart-durable. Source3b now implements only read-only cleanup preflight under [phase16](phase-16-cleanup-preflight.md).

OH-52 source2 acceptance above is reopened by a second real source boundary failure at the same `5705bd9957`. Root traced the actual user instructions and found global owner `share:null` to `accessLevel:admin` violates the Session contract (role and owner fields describe shares): actual info hides PR editing, fork and handoff, action contexts lose owner identity and Stop, and sharing delegation changes. The green producer/transport checks omitted these real consumers. Router ESCALATE selects actual Astra/high for [phase17](phase-17-autoarchive-owner-contract.md), retaining2failedSol/0Astra; the prior author pauses overlapping source edits. First composed Chrome failed isolated Corepack/Yarn setup before authentication/provider/archive; that fixture failure is separate from the product regression. Source correction and independent review precede its rerun. No App guide instructions were published for this flow, and no daily app changed.

OH-52 source2 correction through `51b056c992` is accepted at bounded source scope after actual Astra/high execution. Root independently passes105/6 producer/observer/component checks (`/tmp/happier-oh52-owner-correction-root-final.log`) and20/2 existing action/store-equality checks (`/tmp/happier-oh52-owner-adjacent-root-final.log`). Actual encrypted warm/cold/fully hydrated snapshot and detail producers reach unchanged owner action consumers. Owners keep absent shared accessLevel; separate full-Session account evidence comes only from a successful schema-valid authenticated direct detail read, never list/compat/cache/wire passthrough. Already hydrated sessions refresh through the same loader for missing proof; the mounted explanation uses its existing full-session subscription. Author adjacent86/8, UI types and final typed-helper replay3 pass. Router VERIFY Astra/high retains2failedSol/0Astra. The same Astra worker now owns only the isolated composed Chrome retry; no native/daily/live-provider/cleanup proof is implied.

OH-52 source3b through `e31e0359aa` is accepted as read-only preflight, with independent root19/3 files plus actual status parser14 green. The final assertion-only correction restores prior missing-head SHA coverage. Canonical claim/archived-session/Home/server/ring, real Git status/registrations, qualified PR state and live source publication feed independent skip reasons. Current publication is explicitly not a proven at-merge source snapshot; `integration_snapshot_unproven` blocks both Git resources, with process/protection/temp ownership unresolved. No deletion-ready result or runtime capability exists. Router VERIFY preserves overall Astra/high,2failedSol/0Astra. [Phase18](phase-18-cleanup-integration-proof.md) now assigns actual Astra/high report-only integration discovery; root read the existing origin-integration-v3 tool as reference and ran no cleanup. Its current-UID lsof observation is not exhaustive Happier host-user proof.

OH-52 canonical user guidance extends the existing published Pull requests page and adds one App cross-reference. It identifies unreleased fork availability, owned-session link add/change/remove, qualified reader/authentication needs, false-default Home-scoped foreground automation, explicit work/provider skip states, incomplete-history limitation and unavailable independent cleanup. Existing creation/checkout feature-gate wording is narrowed so read-only associations are not described as Git writes. Actual UI route/labels and producer/consumer source were traced. Docs content checks, MDX/types and47 guard tests pass (`/tmp/happier-oh52-doc-{content,types,guards}-final.log`). No navigation/rendering code changed; no docs build or native release claim follows. Router VERIFY retains overall Astra/high2failedSol/0Astra.

OH-52 source2 composed Chrome-r5 passes1/1 in47.8s (body18.7s) with fixture `231c5bd398`, evidence `aec7a352a0`. Root inspected all four images under `packages/tests/test-results-oh52-autoarchive-r5/session.autoArchiveLinkedP-8b09f-h-every-qualified-PR-merged/`: owned Add/Change controls, independent false-default/preferences opt-in, actual archive timestamp and encrypted qualified history retained on reload, open/unknown sessions untouched. Real clean-close event preserves explicit idle; bare disconnect correctly writes unknown. R1–r4 failed for Corepack setup, wrong fixture shutdown, switch selector and missing serialized-value decoding; all receipts remain preserved. Router VERIFY Astra/high retains2failedSol/0Astra. Existing gray online on archived detail predates OH-52; phase19 fixes only archived display and clipped unknown-work text, preserving non-archived idle/online/offline/working labels. No native/live-vendor/cleanup completion is implied.

OH-52 phase18 discovery `7ad9ff8d46` is accepted as a source-backed research boundary. Root independently checked primary Git/GitHub contracts and replayed the disposable graph probe in a fresh private root (`happier-oh52-root-integration-probe-42vvv7km`): nine expected outcomes pass, including later empty commits, fresh target rewind and replacement-ref false positives. This is a graph probe, not provider or app execution. Exact current source ancestry in a live permitted target is sufficient historical integration proof; squash/rebase source binding remains unproven. Phase13 carries the clarified scope. Actual Astra/high phase20 now implements only live-default-target/read-only evidence using local objects, retaining publication, process, protection, custody and all other blockers. No fetch or deletion is authorized by this increment.

## October24 source and browser follow-through

OH-70 known-state source/cache is validated through `6a02d6bafd` plus independent selector correction `0be29e28a9`. Shared row action-width ownership fixes real goal and machine hover-target movement without a second hover handler. Author row80 and goal Chrome1 pass. Root independently runs `sessionList.orderingMode.spec.ts` against current source in system Chrome:6/6, exit0,47.7s (`/tmp/happier-oh70-root-integrated-sidebar.log`); exact output is `packages/tests/.project/logs/e2e/oh70-root-sidebar-r1-20261024`. Pin/date, Custom order, agent-before-machine, Same Setup, selection/theme/density and menu hotkeys/reminders remain usable. Root also passes selector16 after independent Sol corrected stale completed/cancelled edit-primary masking the canonical active goal. Reviewer reports104 work-state/row checks plus focused cache/tag checks and UI types green. Both compact light and dark large-text captures were inspected; titles are ellipsized, with complete names in row accessibility labels. Red error/forced-stop policy, native QA and0.3 remain open.

OH-69 source through `0f666c760f` uses the existing authenticated by-local-id route when an ACK lacks stored creation time; API transport/schema and Sync state ownership stay separate. Lookup failure retains accepted pending content without a guessed committed timestamp, and delayed lookup cannot wake a session after account replacement. Independent Astra checks pass owner/API58, scoped auth13 and malformed/recovery3. No further production defect confirmed. The old-ACK browser test remains WIP/failing through `29203696e0`:r1 normal send queued, r2 shortcut settings targeted the wrong storage owner, r3 reached pending/resume instead of socket commit. None proves ACK transport. Stop retries per router BLOCKED; next action is a source-proven reachable UI fixture. Earlier Chrome-r8 proves visibility/history, not socket ACK compatibility. No actual hosted, native or0.3 completion is implied.

October24 read-only diagnosis now identifies why the current fixture cannot select
its claimed transport. The test creates CLI-version0.2.16 metadata on a fresh
session from a server that supplies numeric pendingVersion. `submitMode.ts` maps
that to supported Pending (minimum CLI0.1.0). Although forceImmediate produces an
agent_queue decision, the final `submitSessionUserMessage.ts` owner explicitly
enqueues that mode whenever Pending is supported. Its existing test, “persists
force-immediate input as send_now instead of bypassing Pending,” specifies the
same outcome. Thus the fixture comment that immediate-send on an inactive
session takes socket commit is false for these inputs; changing shortcut timing
cannot establish the expected message ACK or by-local-id lookup.

The exact immutable server-v0.2.17 source at
`a2c45c86804b24e60ac0b76146a3ef36dfcaa15b` also includes pendingVersion in
registerSessionCreateOrLoadRoute, registerSessionListingRoutes and v2SessionListRows.
Stripping that field merely to force direct submission would not emulate this
producer's contract. Both submit-port adapters still delegate to the same final
domain owner; no competing routing decision or production correction is needed
to explain this fixture failure.

No new test or browser run was performed, and no prior failure was relabeled
green. Routing classification retains BLOCKED/Astra-high and the cumulative
2Luna/2Sol/3Astra failed browser attempts. A valid next step needs evidence of a
supported UI/reader state that actually calls the socket-commit owner, or an
approved amendment to the compatibility proof. The existing WIP fixture remains
unchanged and failing. Current-server timestamp/history evidence does not prove
that missing direction; native/hosted acceptance and0.3 remain open.

OH-52 follow-through `c28df42b40` passes route/actions/PR68, UI/E2E types and composed Chrome-r9, with no empty archived Activity heading and both merged identities/reason retained. Read-only ancestry checkpoint `2a119f4899` passes25 disposable cases and CLI types; no executor exists and every cleanup resource remains skipped. Current macOS libproc permission gaps remain an explicit blocker. Canonical app/transcript guidance now labels the new goal/timestamp behavior development-only and keeps acceptance limits next to it.

## Whole-repository baseline and Windows development follow-through

Fresh root `yarn test` is active on root session71413 (`/tmp/happier-oh4-root-unit-current.log`).
Its initial shared failures are retained. Actual path defects were corrected through the existing
Windows identity and provider-install owners (`f9e76c43c3`, `d5209e4219`); lookup fixtures now supply
their ephemeral publisher public key (`eebfa75f6c`). Root complete CLI-common103files/602pass/5skip
and package types pass (`/tmp/happier-oh4-cli-common-{full,types}-current.log`). Bootstrap scope/trust
fixtures (`30a184d31a`) pass root full25files/248tests and types (`/tmp/happier-oh4-bootstrap-{full,types}-current.log`).
Website's independent CI discovery sources were missing, not a reason to weaken assertions. Source-only
archives of `packages/agents/src` from `cli-v0.2.17` (`a2c45c8680`) and `upstream/v0.3` (`7dd34021f8`)
now make all24files/184tests plus3script checks pass (`/tmp/happier-oh4-website-source-inputs.log`).
These are disposable CI registry inputs, not a 0.3 development checkout or port disposition. The next
root invocation must set both documented input variables; prior root failures remain failures.

Current UI fixture corrections retain behavior assertions: settings includes the Archive Automation
group, Inbox uses the real Icon/constants with native boundary mocks (`c037f67541`,25tests), and the
voice picker fixture supplies the stored settings scope already checked by the canonical favorite
writer (`dd8fb58848`,13tests). No guard was removed. Later full-root shards remain pending.

On Windows, the existing feature checkout fast-forwarded fromf82e6f3e to4b64e0e67d without branch
switches or overwriting its four dirty generated bundles. Canonical dependency admission converged;
its selector-only14/14 `yarn.lock` normalization remains uncommitted and preserved. Focused Windows
execution passes20/22skip, then4/6skip after existing Windows cases were made portable (`4b64e0e67d`):
both managed executable/PATHEXT choice and Desktop ownership cases run and pass on Windows. Logs:
`C:\Users\Admin\AppData\Local\Temp\happier-oh7-windows-{cli-common-focused,choice-verbose}.log`.

The release-style debug build refuses upstream ownership before Rust compilation. That result applies
to the `build` owner, not the canonical stack development path: read-only `tauri_dev.mjs --json`
proves the latter generates the isolated stack identifier and disables updater artifacts. Current
canonical Windows dev startup uses `--tauri --no-daemon --no-browser --no-dev-targets --loopback`,
with auth seeding off and preserved WebView assets. Actual compile/launch is pending with the existing
Windows agent; no release, native-visible-window, account pairing or session acceptance is claimed.

Both production path-correction intents'0.3 dispositions remain blocked on the missing destination.
No source branch, alias, release representation or new coordination owner was added.

## Parent maintenance

October24 follow-through: Windows process admission is corrected at one proc owner, shared by server
and Expo (`230f517d70` RED,`832e619be5` source,`746e43429e` platform fixtures). Live Windows proves a
wrapper child was rejected before the fix, then accepted while an independent listener remains rejected.
Author Windows29/1DarwinSkip and root Mac29/1WindowsSkip pass; a different reviewer independently
remeasures Windows19/19, checks CIM creation-time semantics, and finds no material admission defect.
Server inspection uses the remaining caller budget; Expo retains its existing4s observation budget.
This source intent's0.3 disposition remains blocked on the missing destination, with no new registry.

Canonical Windows development now reaches native compilation. Local Bun1.4.2 matches the official
release archive checksum, and Cargo finishes the dev profile in1m37s at source746e43429e, running the
scoped `tauri-target/debug/app.exe`. WebView2 setup exits101 with0x80070578 in the SSH context;
interactive Windows behavior is unverified, not inferred from compilation. Canonical stop observes
ports53651/53652/19727/9223 and recorded PIDs absent but reports runtime-finalization cleanup_incomplete
because server identity is unavailable. Four original dirty bundles and the selector-only lock change
remain byte-identical; Cargo adds15 generated tracked permission/reference files, preserved. No
daily CLI/service/account, installer, signing or updater change occurred. Desktop QA preference is pending.

UI baseline follow-ups are fixture corrections, preserving real scoped owners. Mounted list suites
pass144 (`e8facb4303`); verified worktree/automation fixtures50 (`8b07b0e9fc`); scoped voice/draft
fixtures66 (`a3d32d9b65`); old folder/publication and pinned hydration fixtures42 with final alias8
(`77655f9274`,`e5c0bc4d2e`); real attention store chain9 (`f8eee1c14d`). Counts overlap adjacent checks.
Root socket-gap10/10 now supplies active account scope and the current server ACK's stored timestamp;
the three prefix/retry assertions remain. The first timestamp-only correction still failed3/10 because
null account scopes correctly fail equality; adding the missing actor fixture reaches the real commit.
No message production code or legacy ACK browser test changed. Current UI typecheck passes.

The original root process71413 remains live with already-recorded failures. Its temporary log pathname
disappeared while the process still held stdout open; no cause is established. Earlier package/check
terminal observations remain recorded, but the temporary paths above are historical evidence pointers,
not a guarantee those files remain. New root checks use ignored repo `.project/logs/tests`, including
`oh4-socket-gap-scoped-fixture.log` and `oh4-ui-types-current.log`. The full root terminal result and
configured successor are still required; no full-suite green or stable-release verdict is claimed.

### Earlier selective adoption evidence

Final permitted integration boundary is GREEN: UI205pass/2skip; server144files/1058pass/1skip;
CLI8/8shards,113filespass/9skip and880testspass/61skip in296.91s; Stack35selectedregularfiles,
177/177 in289.59s. CLI uses both the pinned Bun executable override and its directory on PATH,
auth-bootstrap0 and the verified dedicated HOME. Reinspection finds only a test account-settings
cache; source settings.json and legacy/server access.key inputs remain absent. No cache/data was
removed. Logs are the final corresponding `.project/logs/tests/oh4-*-integration-*-current.log` files.
The first Stack selection attempt failed before test dispatch on a path callback argument; its log
is preserved, and the corrected invocation only filters existing collector results and consumes
the same environment/process owners. No new runner or product guard was introduced.

Current whole-root types also pass in18.27s (`oh4-root-types-final-current.log`). Whole-root units
remain applicable because later changes are only integration fixtures and documentation. The two
Stack archive cases remain [blocked] by AGENTS.md249 on release-owned artifacts/dispatch, and four
real-service files remain disabled. No full root integration, provider/account, old-ACK browser,
new native,0.3 port or release completion is implied. Archive-cleanup execution remains absent.
OH-4 remains open for the real isolated source-CLI session recipe; the overall project goal remains
active after this progress. Native idle-window and other recorded external prerequisites are pending.

Server integration delta now passes all144files,1058tests/1skip in271.30s; final servertypes pass.
UI205pass/2skip remains applicable. CLI fixture `59c9d1767f` passes150 but root's delta review finds
the original non-null third report-options assertion omitted and CLI types fail with tuple[] calls.
`22a7dd0ebb` restores the first3 exact positional checks while accepting optional trailing args and
types the OS/HTTP boundary spy from the real function. Final deciding2identity+1adjacent timeout
and CLI types pass. This bounded fixture task retains1failedLuna/0Sol/0Astra; unrelated OH69 counts
are unchanged. No production source or timestamp compatibility policy changed. Full CLI integration
rerun and35regular Stack source cases remain pending, serialized over shared build outputs.

Integration follows the unit/type gate. Canonical UI integration exits0: web160, Legend-native22,
Fabric23pass/2skip,205pass total. This is host execution, not device acceptance. Server first full
integration143files pass/1fail,1056pass/2fail/1skip. Both failures are exact ACK fixtures missing the
current producer's stored createdAt; `06a8c5db33` updates only those expected objects. Focused5,
adjacent41 and server types pass; full server recheck73907 is pending. No message production change
or legacy-ACK browser recovery is implied.

Independent safety inspection finds CLI's dotenv integration config overrides inherited HOME/server.
Root privately verifies dedicated `/tmp/happier-dev-test`, loopback3005 and no credentials/settings.
The canonical task-local auth-bootstrap0 guard returns before auth POST/profile read; live daemon
account cases skip but disposable daemon/fake-provider process cases still run. Real opt-ins and
OpenCode state override remain unset. First CLI integration has four compiler/probe failures from
bare Bun1.2.17 despite HAPPIER_BUN_PATH; prepending private1.4.2 resolves all4 with no source edit.
Two fixture files remain under correction. Do not infer provider/account acceptance from this lane.

Stack discovery identifies37regular/4real files. Two regular binary smoke files build release archives
if not supplied; `dist/release-assets` and prepared archives are absent. AGENTS.md249 forbids QA
producing a separate release representation, so those cases are [blocked] on release automation,
not silently skipped as green. Four OS-service real cases remain default-off. The remaining35
source cases may consume the existing collector/sanitizer/process owners after shared build outputs
are idle; there is no new runner, package, archive, lease or release representation. Full root
integration remains unverified. The native non-hotkey idle-window question is still pending.

Final current-source root unit gate is GREEN: source85707119e5, `yarn test` through hstack-exec,
both independent website inputs and private pinned Bun1.4.2, inherited default TMPDIR. Root session
95727 finishes exit0 in5869.40s. Durable log `.project/logs/tests/oh4-root-unit-final-current.log`
contains no FAIL/failed-test/root-suite-failure result. All shared packages, UI unit and downstream
checks, CLI shards/import cycles, server and Stack pass. Stack2069pass/6skip/0fail; three of those
skips are Linux-only broker cases, so no Linux broker runtime proof is claimed. Whole-root types
passed before the final fixture-only edits; final UI types also pass (`oh4-ui-types-final-fixtures.log`).
No production source changed after the complete typecheck, and the only newly typed fixture was
covered by that final UI check. Historical failed/interrupted runs remain in their original logs.
This closes the scoped source validation gate, not OH-4's real isolated-agent/integration contract
or a native/provider/0.3/release gate. A non-hotkey Mac QA idle-window question is pending; native
hotkeys and Embedded Terminal remain explicitly user-deferred. Project refresh still contains44
issues and no new item; current statuses and external prerequisites remain authoritative.

Pinned configured run6240 finishes exit1, preserving its complete durable log
`oh4-root-unit-pinned-current.log`. Shared packages, all CLI shards/import-cycle checks and server
pass. UI has one MCP picker fixture failure (missing captured settingsScope); Stack has13 failures
among2075total,2059pass and3skip. Pushed fixture-only corrections retain the current owners: MCP
`ac85bbbd02` passes7 with real home-aware preference assertions; Stack `8ff1f75fd5` passes18/3LinuxSkip
by comparing physical paths and running VM broker cases only where that route exists; Stack
`58dfb66f40` passes15 with explicit fake npm ownership, local-source default and fail-closed invalid
owner. No updater/registry/provider write or production guard change occurred. Linux broker execution
remains unvalidated here. The Stack worker disclosed using a forbidden hook-disabling commit option;
inspection found no active hook, and all subsequent commands must remain plain. No history rewrite
or test bypass was used to remedy that command-policy error.

Root inspects the current exact diffs and continues the final whole-root gate. The local routing
assessment remains RETRY Sol/high because that integrated evidence is still missing, not because
the focused checks failed. Prior blocked OH69 counters are unaffected. Complete current typecheck
evidence remains applicable except for the one newly typed UI fixture, whose UI lane is rerun.

Whole-root typecheck now finishes exit0 at source59b801280d with the durable log above. The original
unit process71413 finishes exit1. Fresh server Sharp reproduction fails under default Bun1.2.17;
all4 cases pass under CI-pinned private Bun1.4.2, including a second run with inherited default
TMPDIR (`oh4-server-sharpRuntime-bun142-default-tmpdir.log`). No shared build runner, fixture or
Sharp production source changed. The first configured successor18287 had website inputs but lacked
that compiler override, so root deliberately interrupts only its verified task process group24106
(exit130) rather than spending another full run on known configuration drift. Its partial log is
preserved as `oh4-root-unit-configured-current.log`; it supplies no whole-suite verdict. The next
successor includes both source inputs and HAPPIER_BUN_PATH, without a TMPDIR/global-tool override.

October24 baseline continuation: current UI fixture recheck passes22files/378tests with the package
working directory and root-installed Vitest3.2.4 (`.project/logs/tests/oh4-ui-corrected-package-cwd.log`).
The first root-cwd attempt failed only collection/setup-path resolution and is not behavioral RED.
All19 cached CLI candidates have fresh passing owner checks across the three lanes; counts include
adjacent cases: runtime/permission48, permission-adjacent78, provider/process76, IPC/adapters37 and
directSessions23. Logs are the corresponding `oh4-cli-*-final*`, `oh4-cli-five-green1.log` and
`oh4-direct-sessions-green.log` under `.project/logs/tests`. Final CLI typecheck passes after three
test typing corrections. Exact-path commits through `59b801280d` are pushed.

One production defect was reproduced: a retained permission request completing after its persisted
pending projection disappeared lost its assigned occurrence ID. `edd9f2e587` forwards that existing
identity through `permissionRequestCoordinator.buildEntryCompletion` to the canonical request store;
both normal completion and cancellation use that owner. Independent review remeasures the decisive
lost-projection case1/1 and adjacent replacement controls3/3, with no finding. Real asynchronous
SessionClient publication and native provider delivery remain separate gates. This changes no wire
shape or identity generation policy; its0.3 destination disposition remains blocked.

The update publisher tests keep real record writing, fact reading and relay publication but inject
only OS watch delivery through the existing watchRecord boundary. Actual watcher delivery varied
across isolated attempts; no timeout increase, polling or production watcher change was added.
The existing direct watcher integration remains in CLI-common. Process/IPC/path fixtures retain
real internal ownership and isolate actual filesystem/process boundaries. The original root run has
progressed into Stack; its missing temporary log still prevents reading that pathname. Server cache
identifies one Sharp runtime candidate for fresh reproduction. Current whole-root typecheck and a
configured successor unit run remain required before any full-suite claim.

October24 fetch advances parent dev from `413054f17c` to `2bf968563b` by29 commits, with128 files changed. Five coherent intents have now been selectively adapted through fork owners. This supersedes the earlier fetched-only state; no full parent merge, runtime/version upgrade or daily-app cutover occurred, and the rest of the parent-exclusive history is not certified compatible.

Systemd PATH-only drift uses the existing definition comparator/inventory (`1bb4a2a6c1`): RED2→GREEN20 and CLI types. Activated-binary repair (`5fabb5cb7b`) uses the canonical managed executable resolver, preserves fork update-source safeguards and ends the old guided plan after a successful update. Independent review corrected matching installed-service assessment even when the old plan is empty (`1dbf174d46`), stopped-service/manual-daemon conflation (`aae3956944`), and ambiguous multi-service PID attribution (`c6f9543e71`). Reviewer56 plus CLI types pass; root independently passes7 service/daemon report cases (`/tmp/happier-oh12-root-service-report.log`). No real update, OS service change or native platform execution ran. The private original repair RED log must not be printed/uploaded because its assertion dumped inherited environment; current tests project owned launch fields.

Typed RPC errors (`6747af9da3`) remain canonical `isRpcError` results rather than duck-typed carriers; independent review also corrected the displayed voice activity error (`50cf63a392`). Protocol47/voice57 and package types pass. Header Pin/Unpin and normal-mode Copy information (`c4b27663ee`, `57136399e2`) reuse the shared availability/execution/organization and information-formatting owners. Author139 focused, final Info53, UI/tests types, and normal action-rail Chrome1 pass with Developer mode disabled. Raw diagnostics remain gated. Final root sidebar/header Chrome is pending after the following account-scope fixes.

Foreground permission notifications use the canonical request store/settlement owner, additive occurrence RPC and shared UI permission dispatcher (`55b0b19580`, `54359800c9`, `6d864da329`, `4f3663c518`). Independent Astra reproduced missing sender-account authority and corrected the real remote push producer plus UI target resolver in `278e9e6c62`. Root independently executes UI15 (`/tmp/happier-oh12-root-permission-account.log`), push19 (`/tmp/happier-oh12-root-push-identity.log`), and composed source CLI/isolated relay encrypted RPC2 (`/tmp/happier-oh12-root-permission-composed.log`), all exit0. Actual API-client publication lock/ACK precedes push, and settlement tests cover stale/duplicate/valid/reused occurrence and retained legacy denial. External push delivery is replaced; this is not native notification acceptance.

The released in-app `permission` ABI intentionally remains request-id based and delegates to the same settlement owner. It has no new occurrence guarantee. The modern foreground notification path never downgrades to it. Existing UI-local alert producers omit account/occurrence identity and remain navigation/review-only; this batch adds no Android background execution capability. Immutable published release/source baselines and older-relay delegated-method limitations are documented in `docs/compatibility.md`; binaries/deployments were not exercised. Local rolling tags are stale and are not the release basis. Daily CLI0.2.16 and hosted preferences/services remain unchanged.

Root's post-header review reproduced a Pin request switching from A to B's bearer during credential resolution. The canonical organization resolver now captures the active actor; publisher guards protect Pin and six reached mutation siblings (`574aec525e`, `e58f5f6332`). Snapshot publication and applied-result continuations, reminder dedupe, tag-label reads and account-qualified folder-fetch coalescing follow the same owner (`205911c33b`, `d76812343f`, `d5e34daacc`). Author final87 across14 suites and UI types pass. Independent Sol delta review is pending. Legacy import has no local read/write after guarded refresh, so needs no second continuation policy. An explicit foreign target without an expected account can only select its currently saved credentials; original actor continuity is not proved there. No new authority/cache/coordinator was introduced.

Canonical CLI architecture, compatibility, notification setup/routing and session-organization guides distinguish development-only behavior and acceptance limits. Documentation content/type checks and47 guard tests pass (`/tmp/happier-oh12-docs-{content,types,tests}.log`).

Final account review found a public lifecycle defect beyond publication: disconnect/restore(B) on the same Home retained A's version/projection, and clearing visible maps still left A optimistic records that replayed during B rollback. `652ea4adfe` clears that Home through the existing sync reset/store owner and removes only its optimistic records. Reviewer67/UI types pass; root independently executes both public disconnect/restore regressions (including foreign Home preservation and no rollback replay),2pass/2skip,exit0 (`/tmp/happier-oh12-root-organization-reset.log`). This closes the pending independent account delta above.

Final root current-source system-Chrome run passes7/7 in112s: six sidebar cases plus normal header/action rail (`/tmp/happier-oh12-root-integrated-chrome2.log`, artifacts `packages/tests/.project/logs/e2e/ui-playwright/oh12-account-final2`). Root inspected final light/wide header and dark/narrow selected-row screenshots. The first combined run's6pass/1fail is retained: Pin click immediately hard-navigated before the asynchronous write completed. E2E-only `22b7ec9f58` now waits for actual Pin200, exact pinned request and returned session record, retaining all Pinned/Unpin/clipboard expectations. Tests-package types pass. No product workaround/timeout was added; the unrelated blocked legacy-ACK scenario remains excluded.

The newest-parent audit also found cached native permission responses entering the foreground executor. Bounded correction `50bd71b151` routes saved responses for review, even with valid identities, and ignores disposed late callbacks. The installed Expo Notifications0.32.16 async API wraps a synchronous native snapshot; that snapshot is classified before listener registration, with observable read/clear failures and fresh distinct live press recovery. This is not a replay journal or Android background implementation. Root independently passes24/3 routing/parser/root-layout checks (`/tmp/happier-oh12-root-saved-response.log`); author UI types pass. This refines the same notification source intent; its0.3 disposition remains blocked.

Other newest-parent work is not silently treated as adopted. Claude unified native prompts/one ingress/provider response-location settings (`6afa6f093c`, `2c5fb7c687`) are still missing and need a separate CLI/UI compatibility vertical while retaining daily CLI0.2.16. Android background execution, task-manager and native Expo patches remain deferred to a version-aware device gate. The manifest requests Notifications~0.32.11 but the lock/install resolves0.32.16; manifest range alone does not establish patch compatibility. Parent Windows realpath and daemon scope-proof fixture adjustments (`4f15a97be1`, `c517cc5728`) are validation follow-ups, not missing runtime owners. No full merge is warranted by this selective batch.

The separate v0.3 line advances `67f58e65e5`→`7dd34021f8` by one generated profile/share-viewer bundle commit (two changed files). Neither optional destination `../v0.3.x` nor `../0.3` is available; the destination question is already pending. Every adopted intent—systemd PATH drift, fresh-binary repair/inventory attribution, typed RPC/voice errors, header Pin/information including organization actor safety, and notification occurrence/account authority—has its destination disposition [blocked] on that location. No destination code, alias or branch was created. Native macOS acceptance, Linux/Windows service behavior and release gates remain open. OH-12 remains ongoing.

## Additional October24 parent input corrections

Fresh fetch advances parent `dev` from `2bf968563b` to `1b4cd388a0` by three commits;
the separate `v0.3` pointer advances `7dd34021f8`→`30144c3f23`. Current source already
contains the runtime settings, prompt settlement and effective-model owners needed
by the newest CLI patch, independently of pending unified prompt-location work.
No full merge or daily runtime/version replacement occurs.

`8b3203f59b` selectively adopts upstream `7b8bf2781b`: environment cards publish
input events directly, synchronize incoming draft values without echo writes, and
sanitize vault plaintext/fallbacks from the incoming value. Exact card/test bytes
match upstream. Meaningful RED is3fail/7pass (rapid edits missing, stale vault
fallback and external prop echo); GREEN47/5files and UI types pass. Real list and
preview-hook logic remain in the tests, with only daemon RPC replaced.

`fbac3197ac` adopts upstream `54f8e14b17`: the existing timeout/thinking fields use
step1 rather than30/100, matching the canonical positive-integer schemas. Owner
tests RED2→GREEN10/2files. Root resolves both immutable `cli-v0.2.16` and
`ui-desktop-v0.2.17` to `b8d1c449c46ab4dfa8637db36b66f643d149e66d` and reads its
same positive-integer/nullable schemas and defaults. This repairs existing UI
validation without changing format, keys or indefinite-wait behavior. Current
profile/provider broader checks pass22files/77tests; browser fixture types pass.

The browser fixture's first two iterations fail before reaching product acceptance:
an early optional readiness check misses the disabled Profile switch, and checkbox
input assumptions miss the dedicated web `Switch.web.tsx` role-based control. The
second Profile click actually enables Profiles, removing its own switch, so
`.check()` cannot subsequently observe it. `2f51ff75f5` corrects these fixture
contracts without forcing input or weakening persistence/vault/default assertions.
The next actual Chrome run passes2/2 in86s. `929bf22a6a` scrolls the actual numeric
fields into view for its screenshot; the exact final replay also passes2/2 in73s
(`oh12-upstream-ui-inputs-r4-chrome.log`). Root inspects both final images: the
reopened profile retains OH12_OTHER with vault enabled and no fallback editor;
provider settings retain900/1024 with indefinite waiting enabled. Disabling vault
in the reopened draft reveals an empty fallback, proving the old value was removed.
No production regression is inferred from the fixture failures.

`29083c2253` adopts upstream `1b4cd388a0` through the existing nine CLI files. A
refused queued-prompt settings update rejects before provider effect and returns
custody to the existing pending delivery owner. Metadata wakes apply permission
controls alone, without retrying the rejected model/thinking controls. Remote and
unified prompt acknowledgments stop guessing the running model; the existing
effective-model observer owns `sessionAppliedModelV1`, including effort-only
updates only after actual model evidence. Optional compatibility carriers still
forward explicit applied IDs but no longer infer them from requested selection.
The same immutable0.2.16 baseline already declares and reads this applied-model
record; its shape and version remain unchanged.

The fork lacks upstream's `logger.warnFile`; its existing file-only `infoFile`
with a warning prefix and the redacted completion event satisfy default file and
user observability without terminal output. Root verifies session default info
and daemon default debug in `logFileLevel.ts`. The first imported test run's
missing logger method is harness failure, not valid RED. The adapted deciding
test then fails because metadata wakes retry the refused model3times. GREEN82/4
and adjacent207/7 plus CLI types pass. Root independently passes113/4 runner and
real SessionClient delivery/outcome tests (`oh12-root-settings-refusal-delivery.log`).
Separate CLI review catches the failure event calling its requested/setter-acknowledged
snapshot `Current model`, without observed runtime evidence. `f7484f23d5` changes
only that label to `Model setting`; two existing refusal cases pass,60are filtered
(`/tmp/happier-oh12-claude-model-setting-label.log`). Independent delta review confirms
the finding resolved without a new model cache, state or callback. Retain1failedSol
review cycle for this CLI batch; UI browser retains2parentfixture iterations,
with no source implementation failure. Canonical docs guards pass47/47. Real provider/native and0.3 destination
acceptance remain open; no credentials, daemon, service, installed app or hosted
preference was changed.

Every new intent has its0.3disposition [blocked] on the requested destination:
profile event/sanitization authority, numeric schema-consistent inputs, and refused
prompt/observed-model authority. Fresh discovery confirms both optional aliases
absent; the additional registered worktrees are the immutable0.2.16 reader and an
OH59fixture checkout whose UI remains0.2.18, not a verified0.3destination. No port,
alias or worktree was created for this batch. Existing published profile/provider
documentation already describes the retained semantics, so no new published
feature claim is added; the canonical internal Claude matrix records the new
development-source refusal and authority behavior explicitly.

## Source CLI terminal pairing follow-through

OH-4's existing provider-auth browser case can exercise normal CLI terminal login
against a fresh isolated relay/account, then launch the live-source daemon and
read the explicit fake Codex's logged-out status. It uses current source symlinks,
not a packaged release. This is a source-pairing gate; actual vendor execution,
native restart and the persistent development stack remain separate obligations.

Pre-run source inspection finds fixture isolation incomplete: login inherits
Codex home/API-key variables, and normal post-authentication reconciliation
discovers installed services using the OS user home ahead of HOME. `6e6e32dcac`
sets fixture HOME/USERPROFILE and the existing explicit service user/Happier-home
overrides for both children, and removes Codex home/API auth overrides. It keeps
the source entrypoint and existing fake executable explicit; auth bootstrap and
real-provider/service flags stay disabled. Normal fresh-account authorization is
performed through the actual isolated UI rather than imported credentials.

Root independently traces service runtime precedence and macOS inventory:
`discoverInstalledDaemonServiceEntries` reads only the fixture user's absent
Library/LaunchAgents directory and returns empty before any OS manager command.
`reconcileDefaultFollowingBackgroundServicesAfterAuthentication` returns on empty
default-following modes, so no daily-service restart can be selected. Existing
inventory/discovery tests pass46/2files; fixture typecheck passes. The actual
browser run remains pending; private authentication logs/URL fragments are not
printed, uploaded or committed.

The actual system-Chrome source-pairing run now passes1/1 (37s test body,
109s total; `.project/logs/tests/oh4-auth-terminal-chrome.log`). The unchanged
user-flow assertions approve terminal login, await CLI exit0, observe the source
daemon online and create/select-session entry, then detect the explicit fake
Codex and its Missing credentials state without terminal auth controls.
The configured integration bootstrap remains disabled.

Root independently opens only the isolated SQLite database read-only and counts
one Account and one Machine. It verifies the CLI launch's src symlink resolves
to current repository source, settings select loopback, no Codex credential file
exists in the fixture home, and no retained daemon state files remain. It does
not print CLI auth stdout or query credential columns. This does not establish
all-host process absence or native/real-provider execution. Package fixture
typecheck and Playwright inventory pass; service inventory/discovery46/2 passes.

The bounded recipe is accepted, not the whole OH-4 issue. Persistent dev-stack
and real vendor/native/restart acceptance, release-owned Stack archive cases,
Windows/Linux and the unavailable0.3destination remain separate. No production
behavior, default CLI/profile, hosted account, daily service or native window
was changed by this fixture correction or its run.

Independent OH-10 revalidation finds the required `yarn ghops` read-only command
blocked by its unavailable bot credential. The connected commit-workflow tool
filters to PR events, so it cannot prove push CI status. A smaller successful
Linear query returns no OH release pipelines; the first broad pipeline query
exceeded server complexity and supplies no result. No workflow dispatch, personal
credential fallback, GitHub admin change or fictitious release was attempted.

### October 25: tool-unpacker natural exit

After the59-commit parent audit at `98c8b26691`, exactly its natural-exit intent
is adapted through the existing `apps/cli/scripts/unpack-tools.cjs` direct entry
and pushed as `0053d17620`. Successful unpacking drains the event loop; failure
keeps the existing error and sets `process.exitCode = 1`. No extraction or runtime
service policy changes. Verified human upstream author Leeroy Brun is credited;
the upstream AI trailer is not carried forward.

Tests execute the real child entry against tiny archive fixtures and record any
forced exit: both cases meaningfully fail RED, then the owner slice passes9
tests with2filtered archive checks. CLI typecheck passes. Root independently
passes the two entry cases and the checked-in archive checksum check (3passed,
8filtered; `.project/logs/tests/oh12-unpack-root-review.log`). Real shipped-archive
extraction smoke remains unrun; the actual Node24 shutdown deadlock reported by
upstream was not reproduced. Windows/Linux direct entry was not executed.
Neither optional sibling0.3 destination exists, so local forward-port verification
is blocked on its location; upstream describes this fix as already ported from
0.3, which is not evidence of a verified local destination. The other58 parent
commits remain unadopted, and no app, daemon, service or release changed.

### OH-72 sidebar provider usage

Source through `11e451172e` adds the authenticated account-owned usage collection
operation, shared credential-scoped native polling and Claude/Codex header. It
reuses connected-profile defaults, exact plain/sealed readers, the catalog service
resolver, gauge calculation and chat badge/formatter. Header display choice is
device-local and does not alter authentication or execution bindings. Native
accounts/scopes remain distinct; friendly labels load through the same exact-record
owner when the chooser opens. Empty records mean No usage data, not native sign-out.
Shared closed badges and details qualify stale values; failed refresh retains last
good values and keeps provider errors isolated. Collapsed rail exposes both providers.

Final isolated Chrome r11 passes3/3, exit0, Playwright28.9s/Yarn29.79s on current
source after the row fix. It covers native no-chat and friendly choices, headerA29/
chatB66 then same-account agreement, reload, 250px/collapsed/light/dark, browser
clock expiry with exact-read503 and retained66/Codex0, old-relay404/disabled, and
connected default73→native20→connected73. Artifacts:
`.project/logs/e2e/2026-10-25T18-36-45-970Z-ui-e2e-529f76fa/sidebar-provider-usage/`;
Playwright output is `packages/tests/.project/logs/e2e/oh72-sidebar-provider-usage-r11-full`.
The r11 terminal result is tool output, not a saved stdout log; do not invent a log.
OwnerUI48/server13/protocol14 and UI/server/protocol/E2E types pass. Root independently
passes server13, owner16 and shared badge9; API OS-storage fixture removes unsupported
native credential access while keeping the real HTTP/parsing path.

Earlier composed failures were fixture actionability, credential/provider-organization
identity or source-scope mismatches; the server/client correctly refused those vectors.
ENOSPC interrupted r4 before acceptance; capacity recovered externally with no deletion.
A proven stale empty Git lock was preserved by reversible rename; later lock collisions
were concurrent checkpoints. Native QA is deferred; real provider acceptance, hosted
relay operation availability and0.3port remain open. No provider configuration, app,
daily daemon, hosted relay or deployment changed. The published App guide and API/
compatibility pages describe this development boundary rather than a stable release.
