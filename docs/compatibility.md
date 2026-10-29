# Compatibility and version skew

This document defines when Happier preserves old behavior across UI, CLI, daemon, server, installers, and persisted state. The goal is safe upgrades and mixed-version operation without turning undeployed implementation history into permanent compatibility debt.

## Trigger

Apply this policy when a change affects a cross-component wire shape or semantic, persisted/session/settings data, schema or migration, feature/capability negotiation, installer or service state, upgrade/coexistence, or rollback. Routine internal refactors that leave these seams unchanged do not need a compatibility matrix or shim.

## Baseline classes

### Hard released obligations

- Active stable and preview releases count because both can exist on user machines or deployed infrastructure.
- Resolve each component independently. UI, CLI/daemon, server, desktop/mobile, and stack tags may point to different commits.
- Discover the current channel through rolling tags such as `cli-preview`, then record the immutable component version tag, commit, and relevant artifact/deploy evidence used by the check.
- Older releases count only when explicitly supported by policy or task scope; tag existence alone does not imply indefinite support.

### Non-obligations

- `dev`/`*-dev.*` builds, untagged commits, abandoned experiments, and undeployed internal module paths are not lasting compatibility contracts.
- Do not keep aliases or adapters solely for an atomic internal rename/move whose old path never shipped.
- Repository-specific predecessor rules may add a prospective baseline, but they do not convert every historical intermediate implementation into permanent support.

## Map the seam

For the changed concept, identify:

- the canonical domain owner;
- every producer, consumer, reader, writer, serializer, parser, and persisted artifact;
- the old/new component versions that can actually meet during rollout or rollback;
- the wire, semantic, persistence, and operational expectations at that seam;
- any existing split-brain, duplicate decision path, fallback, or compatibility adapter in the touched corridor.

An existing same-concept split-brain in the touched corridor must be consolidated at the canonical owner. A compatibility adapter may translate released shapes, but it must not independently decide domain behavior.

## Direction and rollout

### Self-hosted independent upgrades

Self-hosted operators can upgrade clients, daemons, relays, and persisted
state independently. Release evidence therefore covers the reachable
directions rather than imposing a fleet wait or a global cutover:

- current clients, CLI, and daemon against a supported older stable relay;
- bounded supported older client/daemon core flows against the current relay;
- persisted state from an older writer into current readers; and
- current writes into older readers only when supported rollback or
  coexistence makes that direction reachable.

The last direction is conditional, not an excuse to add dual writers or a
permanent fallback. The release agent derives the affected, reachable
directions from the actual diff and supported released baselines. Scripts prove
only named behaviors against exact artifacts; they do not issue a general
compatibility verdict. The named Docker relay-upgrade scenario is selected
automatically only when the release changes the server and a supported
published relay predecessor exists. Installer and broader Docker validation
remain risk-selected; deep certification owns cross-OS, provider, mobile, and
comprehensive review.
Product seams still own the actual compatibility implementation.

- New readers accept supported old shapes; new writes use the canonical current shape.
- Old readers need to accept new writes only when coexistence, independent component rollout, or rollback makes that direction reachable.
- New clients talking to old servers must capability-negotiate or degrade safely instead of assuming the new contract.
- Old clients talking to new servers retain released behavior for ordinary compatible changes and for every operation the new server can still execute safely. A major incompatible server change may require a newer client for the affected operation, but that support boundary is an explicit developer/product decision—not an agent-selected default.
- Persisted-state changes consider both old-writer → new-reader and, when rollback/coexistence is supported, new-writer → old-reader.
- Prefer operation-scoped graceful degradation over connection-wide rejection: admit the old client, keep unaffected reads and writes available, and return a typed upgrade requirement only when the requested operation cannot be performed safely. Reject the whole connection only when no authenticated operation can be made safe.
- For an incompatible transition, prefer prepare/expand → activate/migrate → contract when mixed-version coexistence or rollback is an approved requirement. Do not assume that old clients must read new writes merely because the server is self-hosted.

Before adding dual writers, parallel persisted formats, rollout modes, operator flags, socket-drain protocols, or a mandatory client floor, compare their lifetime cost with the actual user behavior required. If preserving old-client/new-server behavior for a major change would require substantial machinery, stop and obtain an explicit developer/product decision among: operation-scoped degradation, a documented client update requirement, or the heavier compatibility transition. An agent must not silently choose either forced upgrades or heavy compatibility machinery. This exception is for genuinely incompatible, high-cost transitions; routine server changes must remain compatible and must not manufacture client-update requirements.

### Connected-service reader support in 0.2 development

The Antigravity integration extends a released closed service enum. UI/server
0.2.15 (`88d45f33`) and CLI 0.2.14 (`df8241c8`) supplied the original failing
reader contracts; current UI 0.2.16, server 0.2.16 and CLI 0.2.15 stable/preview
releases are independently resolved at `22ac8263`. Their release records and
binary metadata establish the published component basis; they do not attest a
particular deployment.

`packages/protocol/src/connect/connectedServiceReaderSupport.ts` owns the
recognized-service policy. Authenticated HTTP requests advertise reader support
with the `happierConnectedServices` query, and sockets use `connectedServiceIds`
in their auth payload. Missing or malformed declarations retain the released
service set. This avoids adding a cross-origin request header that old relays
cannot accept.

Outward profile projection filters profiles/groups and credential revisions
together. Session-detail/list/turn and socket projections omit unsupported
optional service/quota references from runtime issues while retaining generic
failure, retry/reset and status facts. Stored identity is unchanged. Encrypted
transcript records and recovery metadata retain their existing per-record
degradation on older clients; the server cannot rewrite encrypted content.

New-service authoring requires the server's typed `supportedServiceIds` operation
declaration. Session launch separately requires the selected daemon's real
materialization support. Current clients reject unsupported operations before
effects, preserving existing services. Deploy server admission/projections before enabling
new-service authoring; this is an operation-scoped transition, not a fleet-wide
upgrade requirement.

The settings owner in `account/settings/connectedServicesSettings.ts` splits
saved defaults into disjoint service subsets: released services remain in
`connectedServicesDefaultAuthByAgentIdV1`; additional services use
`connectedServicesAdditionalDefaultAuthByAgentIdV1`. One reader/writer presents
the combined defaults. New bindings must not be inserted into the released map,
whose old parser would discard unrelated defaults too. Historical UI
read/edit/write retention is a required validation gate. An older local CLI
cannot honor the additional service default and needs an upgrade for that
operation.
Fetched settings that reject the canonical schema refuse launch defaulting;
they do not fall back to cached or native authentication. Ordinary network
failures retain the existing account-settings cache policy.

Remove these outward/default-carrier adapters when the supported closed-enum
readers retire, consolidating at their existing owners. The undeployed 0.3 line
uses qualified account services and its existing one-way upgrade boundary;
0.2-created Antigravity data still needs its storage-ingress mapping there.

### Quota recovery details (0.2 development)

Reset availability remains in the existing strict recovery-credit inventory.
Optional `recoveryCreditDetails` supplies quantities, applicability and display
reasons by provider credit id; these facts do not authorize redemption.

The inspected UI/server 0.2.16 and CLI 0.2.15 readers at
`22ac8263cfdbcdb845441b9044ff18199cf7652e` reject extra fields inside the strict
Provider Account Usage body. The canonical supplemental-facet splitter therefore
extracts both subscription facts and recovery details before writing that body.
Encrypted details use the existing account-scoped sealing owner and travel beside
the base ciphertext. The released non-strict sealed envelope ignores this optional
facet, retaining ordinary usage and the original recovery-credit shape.

Plain V3 writes place details in outer metadata only when the server explicitly
advertises `connectedServices.quotaRecoveryCreditDetails`. Its canonical dependency
is `connectedServices.quotas`. A missing or malformed bit keeps the released plain
body and metadata shape; saved quantities and display reasons are then omitted.
The current server admits, persists and projects that facet through the existing
usage-record owner and refuses it when disabled. Subscription gating does not
erase independently supported recovery details. Tests use the exact released
strict body and sealed-envelope declarations, rather than reconstructed readers.

### Account usage discovery (Omnia development fork)

The unreleased fork adds a read-only collection operation at
`GET /v3/connect/provider-account-usage`. The canonical usage-record storage owner
filters by authenticated account and projects only identity and freshness/status
metadata for plain and sealed records. Existing exact-record payload envelopes,
writers and encryption remain unchanged; no migration is required.

Inspected immutable `server-v0.2.17` has exact-record operations and connected-source
resolution, but no collection-root GET. New UI readers treat that operation's 404
as unavailable discovery, retain explicit unknown/incomplete states, and do not
infer no native subscription from a partial session catalog or cache. Other
request errors remain errors. Old clients continue using their existing exact
record references against the new server. The current hosted relay has not been
updated as part of this source work; native account discovery requires a server
with the collection operation before adoption. DB-backed route tests cover
account separation, exact-read denial, plain/sealed identity-only projection,
unauthenticated requests and the existing quota feature gate.

### Browser request headers and CORS

A new request header is both a wire-contract change and, for cross-origin web clients,
a browser CORS change. Before emitting one, verify the new client against the exact
supported predecessor relay: the browser's `Access-Control-Request-Headers` must be a
subset of that relay's `Access-Control-Allow-Headers`. Updating only the current server
allowlist cannot make a new browser client compatible with a relay that is already
deployed.

Prefer a CORS-safelisted request header, query/URL negotiation, or an existing typed
request body when those preserve the operation's semantics. If a custom request header
is necessary, emit it only when the peer has already advertised support, unless every
supported predecessor already allows it. Test the real `OPTIONS` preflight against a
provenance-pinned predecessor, including the exact requested header list. A custom
response header is a separate browser contract and must also appear in
`Access-Control-Expose-Headers` before browser code can read it.

### Self-hosted relay release checks

For stable releases, prioritize current UI, CLI, and daemon core flows against
the supported older self-hosted relay. Check the bounded reverse direction only
for core usability affected by the changed seam. Check released persisted state
against current readers/migrations, and current writers against old readers
only when rollback or coexistence makes that direction reachable.

The registry may automatically select the exact `docker-release-assets`
published-channel-to-current-source upgrade when the server changed and a
supported published predecessor exists. That proves one named SQLite/Postgres relay
upgrade; it is not a generic compatibility verdict. Release orchestration never
waits for client adoption, self-hosted relay upgrades, daemon drain, migration
cohorts, or a global cutover.

For desktop setup and managed-CLI/service state, the `desktop-setup` suite
(`scripts/release/release-assets-e2e/README.md`; it gates the production desktop
publish in `build-tauri.yml`, using the candidate CLI release) runs the
hsetup shipped in a Linux desktop artifact against a fresh systemd machine, and
upgrades a machine set up by the previous published stable desktop + CLI (pinned
immutable tags) to the candidate. It proves the Linux systemd user-service path
only; macOS launchd and Windows schtasks are not covered by it.

## Proportionate matrix

List all affected reachable directions and mark each `required`, `unreachable`, or `unsupported` with a reason. Direct seam tests cover each required direction. End-to-end rows are selected by risk and real deployment order.

Do not run a full Cartesian UI × CLI × daemon × server matrix for an internal or unrelated change. Require broader combinations when a shared protocol, persistence shape, installer/service state, or rollout ordering actually couples those roles.

## Evidence and tests

- Prefer real released/predecessor artifacts, serializers, clients, or provenance-pinned golden vectors.
- A fixture reconstructed from current types is not evidence that the released reader/writer behaves that way.
- Use the smallest discriminating test for each material direction, then add risk-selected upgrade, coexistence, rollback, and state-continuity flows.
- Do not multiply shallow permutations. A new test must distinguish a plausible incompatibility, reader/writer mismatch, semantic change, or rollout failure.
- Record the exact tag/commit/artifact, component roles, direction, command, and result.

## Compatibility path lifecycle

Every retained compatibility path records:

- the released or prospective source shape it supports;
- its producer and consumer;
- whether it exists for upgrade, coexistence, rollback, or persisted historical data;
- the canonical owner it delegates to;
- its removal condition.

Remove the path when its support window has ended and evidence shows no supported reader, writer, or stored shape still requires it. Do not remove a released-data reader merely because current writers stopped producing that shape.

### Native reminder picker on older mobile binaries (0.2.15)

The UI 0.2.12 source at `a357c65536ba89669422977d6f7daf9aa0d17e73`
does not include `@react-native-community/datetimepicker`, but shares the manual
`0.2.7-native` OTA runtime with later UI sources that include it. An OTA update
cannot add that compiled native module to an already-installed app.

The native `SessionReminderPicker` adapter therefore checks the installed
capability before loading the SDK: the iOS native view, or all four Android
modules eagerly required by SDK 8.4.4. The reminder modal consumes that same
availability decision and omits unsupported picker buttons. Its existing manual
date/time fields and submission rules remain available; equipped binaries retain
their native picker. Web uses its existing JavaScript picker unchanged.

This is an older-native/new-JavaScript compatibility path, not delivery of new
native code through OTA. Remove the guard only when no supported binary eligible
for these updates can lack the SDK. Native renderer fixes and app-link entitlement
changes still require a native app build.

### Android file actions native runtime (development)

The development UI's Android Save As, Open With, and Share actions require the
compiled `HappierFileActions` Expo module. Released binaries on the
`0.2.7-native` OTA runtime do not include it. Non-publicdev lanes use the new
`0.2.8-native` runtime train for this native surface; publicdev continues to use
the existing Expo fingerprint policy. Publish a new native build before updates
for this train, and do not force this JavaScript bundle onto older native runtimes
using the maintenance override.

This changes the local Android handoff only. Encrypted workspace transfers and
their daemon-owned limits retain their existing wire contracts. Web and iOS
downloads keep their existing platform actions.

### Herdr terminal metadata (development)

The released stable UI `ui-web-v0.2.12` and preview
`ui-web-v0.2.12-preview.4` at
`a357c65536ba89669422977d6f7daf9aa0d17e73` reject `herdr` in both
`terminal.mode` and `terminal.requested`. That failure rejects the Session's
entire metadata, not just its terminal attachment.

`packages/protocol/src/sessionMetadata/terminalMetadata.ts` owns the development
wire projection: Herdr uses the released `plain` enum value with additive
`hostKind: 'herdr'` and, independently, `requestedHostKind: 'herdr'` for a Herdr
preference. The existing Herdr terminal identity and control-serviceability
fields are preserved. New readers normalize these wire selectors immediately
to the canonical `herdr` domain values and remove the recognized selectors;
later domain mutations cannot retain competing host choices. All Session
metadata write boundaries apply the same projection, before either plaintext
serialization or encryption. Machine metadata and message bodies are unaffected.

Older UIs retain core Session metadata and can preserve the additive fields when
editing metadata; they do not acquire Herdr-specific authoring or attachment
controls. Current UIs and CLIs retain those controls. A provenance-pinned
released-reader fixture covers current writes through old reads/edits back into
new readers. The projection may be removed only when UIs with these strict enums
are no longer supported; readers of persisted additive projections remain needed
while such Session metadata can still be encountered.

### Terminal-host account settings (development)

The same released UI at `a357c65536ba89669422977d6f7daf9aa0d17e73`
strips unknown fields inside `sessionTmuxByMachineId` and its machine editor
writes the complete parsed map. Non-tmux machine choices therefore live in the
additive top-level `sessionTerminalHostByMachineId` setting, which its raw-baseline
writeback preserves when editing another machine. `terminalSettings.ts` owns the
effective host for both launch and presentation. Modern edits update that map and
the legacy tmux projection in one account-settings patch; none/tmux choices use
the released boolean settings and retain tmux names, isolation and temporary paths.

A released UI selecting tmux on the same machine remains authoritative through
`useTmux: true`. A false value also accompanies a non-tmux choice and cannot
distinguish a repeated old-client echo from an intent to disable Herdr. Older UIs
do not gain Herdr controls. Current readers normalize the development-only nested
`terminalHost` shape when the top-level map is absent; an explicit new-map clear
cannot revive it. Remove this development reader once retained nested development
settings are no longer encountered.

### Same-machine session handoff (development)

Same-machine session handoff extends the existing tracked handoff operation and target-path field; it adds no session identity, storage format or transport strategy. The v2 daemon capability response adds `sameMachineHandoff`. Admission requires that field to be exactly `true` for a local move and continues to accept older capability responses for cross-machine handoff. Local preparation reuses the source export through the existing direct-peer strategy without requiring a network transfer carrier.

Source start validates a distinct local destination before stopping the session. Once the target is committed, source cleanup preserves its v2 job and does not stop the resumed session on the same daemon. Cancellation addresses that shared job once through the existing abort owner. The v1 cleanup adapter remains available for source cleanup; it cannot mutate an uncommitted v2 target job.

### Existing-state session handoff (development)

The existing Start/Prepare handoff schemas accept optional `stateTransfer: 'existing'`. The public `session.handoff` CLI Action consumes the existing tracked source entry point, whose coordinator requires source and target daemons to advertise `existingState: true` through their v2 capability owner before source stop/export. The raw source handler independently checks target support before effects. Missing or older peer support refuses admission. Explicit `transfer` normalizes to omission on outgoing requests so default transfer retains its existing peer contract.

Existing-state preparation verifies the target's actual native session instead of publishing, receiving, or importing a provider bundle. Workspace transfer must be disabled. Claude requires a resolved transcript file; Codex requires its native index row and the indexed rollout file. The existing durable handoff records carry the selected mode through prepare/status/recovery, and the original target resume/confirm, binding, commit, and abort owners retain authority. A missing target session leaves the canonical source Machine binding intact; stopping the source remains recoverable through the same handoff lifecycle.

The CLI observes the shared Action Operations owner after its historical preparation receipt and reports success only at terminal handoff completion. A daemon restart can make that transient operation observation unavailable while the durable handoff recovery record remains. Inspect recovery before redelivery. This addition is development-only; an already-running predecessor daemon does not acquire support when its checkout changes.

The development picker exposes one default-on **Transfer session data** toggle for
cross-machine moves. Its Action adapter and delegated start preserve explicit `existing`;
that selection disables workspace transfer. Both peer capabilities must prove support
before the option can be turned off, and the shared Agent handoff policy must admit the
native-state mode. Source admission also requires the actual catalog resolver before it
stops the session. Missing target-native state is checked after that stop and produces
`existing_session_state_unavailable` through immediate and persisted prepare results and
launch-time revalidation. That refusal is
kept inline in the same picker, without retrying transfer automatically; turning the toggle
on and submitting again is a new explicit choice. Same-machine moves hide the toggle and
retain default transfer. The current 0.3 V3 capability is not a V2 compatibility proof.

### Direct-session import and takeover operations (development)

The released `cli-v0.2.14` and `cli-v0.2.14-preview.1` daemon at
`df8241c8b1068aa964ec7723000ff356ba3a00ef` executes
`daemon.directSessions.takeoverPersist` synchronously. Updated daemons retain that
method as a completion-waiting adapter to the shared daemon Action Operations
runner used by handoff, fork, and session creation. `takeoverPersist.start`
acknowledges admission with the shared operation snapshot. Direct takeover and
import admission share writer/auth/source checks and exclude competing requests
for the same linked session; repeat delivery joins the existing completion.
The runner owns both the early admission receipt and final completion for tracked
spawn, fork, handoff, and takeover requests. Reusing a request identity with changed
canonical input is rejected. Spawn admission uses the existing native nonce identity
(including trimmed padding) while preserving the forwarded nonce bytes. Handoff
does not keep a second admission receipt registry. These private changes add no
fields to the released operation snapshot.
The development-only `import.status` and `import.cancel` endpoints and dedicated
import operation store are removed. Status and Stop use the shared
`actionOperation.list.v1`, `actionOperation.get.v1`, and
`actionOperation.cancel.v1` methods.

Updated UIs start import through the asynchronous method and observe the daemon's
phase, message counts, cancellation eligibility, and terminal result through the
existing account-scoped Action Operations revision stream and connection-time
reconciliation. The footer and Activity read the same store; the footer does not
poll a separate import lifecycle. Reconciliation decisions use the newest shared
snapshot after merging transport responses: a delayed start acknowledgment or
status response cannot revive an older revision, hide a terminal refresh error,
or settle the pending send of a newer retry. A transport request deadline does not
set an import deadline. The existing transcript footer
also renders for empty imports and remains available through metadata conversion.
Observation retains the original daemon address until terminal refresh succeeds,
so conversion cannot strand a pending send; failed refresh remains recoverable
through the same Refresh action. If the start acknowledgement is
lost, the UI reconciles the shared operation by request identity without starting
a second import. A missing method on
an older daemon asks the user to update the daemon before starting work; it does
not fall back to the synchronous import path. Existing relay RPC routing requires
no server schema or persistence change.

Cancellation is cooperative during transcript reading and uploading. The current
page/media/upload effect may finish before cancellation settles; no next message
or runner startup follows. Accepted messages remain stored with the existing
stable import IDs, so retry deduplicates them. Cancellation becomes unavailable
when runner startup begins. Completion still requires the existing metadata
conversion. Operations follow the shared daemon-local retention and recovery
rules: reopening the session recovers status, while daemon restart loses the
operation record. An authoritative missing record marks status unavailable and
settles pending UI work without claiming completion. Retry uses a new request
identity and the existing importer IDs to preserve accepted history.

### ACP session-list browse source

The released `cli-v0.2.12` and `cli-v0.2.12-preview.1` daemon at
`a357c65536ba89669422977d6f7daf9aa0d17e73` does not register the ACP session-list
capability method and its direct-session source schema rejects `{ kind: 'acpSessionList' }`.
Updated UIs therefore probe `daemon.directSessions.acpSessionList.capability.get` through
the canonical machine direct-sessions operation before sending that source. A missing method
degrades only ACP candidate listing to `provider_unavailable`; legacy direct-session listing
continues unchanged. Updated daemons advertise protocol version 1 with `resumeOnly: true`.
That capability authorizes candidate listing for resume and nothing else: it does not imply
transcript import, following, takeover, terminal identity, linking, or writer safety.

The probe can be removed only when daemons predating this method are no longer supported.
Directory validation remains daemon-owned after successful negotiation, and a relative `cwd`
continues to return `invalid_request` rather than being reclassified as compatibility fallback.

### Priority-pool primary recovery (development)

The group active-member mutation records its cause in the existing
`state.lastSwitchReason` and `state.lastSwitchAt` fields. Runtime-state refreshes
preserve recorded provenance. Manual selections, including older clients that
omit a cause, replace an automatic cause with `manual`; removing or disabling
the active member does the same when it selects a replacement.

With priority strategy and `autoRestorePrimaryWhenReset` enabled, the canonical
candidate selector can restore an eligible primary from fresh healthy quota
observed after an automatic limit fallback, even without a provider reset time
or surviving member failure marker. Explicit manual provenance prevents this
override. Older persisted groups without provenance retain the landed-reset
proof; missing evidence is not treated as an automatic fallback.

The CLI sends the optional `x-happier-connected-service-switch-reason` header,
leaving the strict V3 mutation body unchanged. The stable and preview server
readers at `server-v0.2.16` and `server-v0.2.16-preview.1`
(`22ac8263cfdbcdb845441b9044ff18199cf7652e`) ignore that header and still perform
the switch, but cannot record its new provenance. The missing-marker recovery
therefore requires an updated relay. Browser clients do not send this header.

### Account-pool quota-reset opt-in (development)

`autoUseQuotaResetsWhenExhausted` is optional in the V1 pool policy; absence means
false. Do not materialize a default in the wire schema. The `connectedServices.autoQuotaReset`
server feature bit negotiates authoring; older servers do not advertise it, so updated
clients do not offer the opt-in there.

Updated group readers send `Accept: application/json; happier-connected-service-auto-quota-reset=1`.
This uses a CORS-safelisted header so updated browsers can still reach older relays.
The existing V3 group-route response boundary omits only this field for readers without
that header. Policy PATCH remains a merge, so older clients can edit the fields they
understand without erasing the opt-in. This projection preserves the strict readers in
`cli-v0.2.11` and `server-v0.2.11` (commit `98ea8fb76733b1dd785d38c31360179cafa84824`);
it can be removed when those strict response readers are no longer supported.

### Model-entitlement pool disable opt-in (development)

`autoDisablePlanInvalidAccounts` is optional and absent means false. Updated V3
clients negotiate the field independently with the CORS-safe
`happierAutoDisablePlanInvalidAccounts=1` query parameter; the response boundary
omits it for older strict readers without disturbing the existing quota-reset
Accept negotiation. Writes require the corresponding server feature bit.

Only the exact Codex ChatGPT-account unsupported-model response becomes
model-scoped `plan_invalid` evidence. The daemon records a 24-hour per-model
exclusion and, when the pool opt-in is true, disables that member. Manual
re-enable clears the automatic-disable marker and runtime blockers. Generic
`plan_invalid` evidence does not persistently disable an account.

Updated V3 clients persist the marker and disabled flag together through the
member PATCH's optional `state` plus `expectedRuntimeStateRevision` fields. They
send that shape only after observing the negotiated opt-in; older clients never
author it, and ordinary member PATCH requests retain their predecessor shape.

The same response boundary masks the opt-in while its server feature or dependencies
are disabled, without changing the stored policy. Existing recovery reads therefore
observe automatic spending as disabled; re-enabling the feature restores the saved choice.

This is forward coexistence, not an old-server rollback guarantee. An older server's
persisted-policy parser rejects the new field and falls back to its complete default
policy. Do not roll back a database containing this opt-in to that reader without a
separately validated, authorized data reconciliation. No database rewrite is performed
by the response projection.

### Account-pool quota-limit selection (development)

`quotaLimitSelection` is optional in the V1 pool policy and absence means all
provider-reported allowances. Updated clients author it only when the server
advertises `connectedServices.poolQuotaLimitSelection`; `selected` always
contains at least one unique provider allowance ID, while `all` contains none.

Updated group readers send the CORS-safe
`happierPoolQuotaLimitSelection=1` query parameter. The existing V3
group response boundary omits the field for strict predecessor readers while
preserving the independently negotiated quota-reset and plan-disable fields.
When the field is absent in storage, a negotiated reader receives the explicit
`all` shape. Older-client PATCH operations remain merges and cannot erase a
stored selection.

`windowDurationMs` is an optional additive quota-meter fact. Updated readers use
it for presentation and expiry-first ranking; absence preserves eligibility semantics and older
readers safely ignore it. Pool-selected usage projection filters only meters and
preserves account-, subscription-, freshness-, and recovery-credit fields.

Provider rejection codes (for example Claude's `rate_limit`) are not allowance
IDs. When the provider does not identify the exhausted allowance, recovery keeps
that identity unknown and uses the existing account-level recovery policy; only
an explicit allowance identity can be excluded by the pool selection.

The existing V1 runtime-auth recovery event's `cancelled` carrier also contains
terminal policy outcomes. Its existing `reason` distinguishes explicit
cancellation from recovery that stopped without an automatic retry. Current
readers use the shared protocol interpretation; no new event enum or persisted
recovery state is introduced. Primary-session failures remain visible even when
independently owned background runs continue.

### Account-pool expiry-first strategy (development)

The canonical V1 policy defaults to `expiry_first` for newly created or absent
policies. Explicitly persisted `least_limited`, `priority`, and `manual` choices
remain unchanged. The daemon's existing candidate selector first prefers fresh
headroom above the pool's soft-switch threshold, then the earliest future reset
of its longest selected usage allowance or independently fresh, non-renewing
subscription end. Ties and candidates without adequate headroom use the existing
least-limited ranking and priority tie-break. Missing, stale, renewing, and passed
subscription dates provide no urgency; eligibility, current-account stickiness,
switch budgets, and hot-auth application are unchanged.

Updated group readers negotiate `happierPoolExpiryFirst=1`. The existing response
projection represents this strategy as `least_limited` for older strict readers;
it does not rewrite storage. Unrelated older-client patches preserve the stored
strategy, while an explicit strategy patch remains an intentional choice. Updated
UI clients offer the new choice only when `connectedServices.poolExpiryFirst` is
advertised; this bit controls authoring, not runtime selection. Older daemons
continue their supported least-limited behavior. As with the other development
policy extensions above, rollback to a server whose persisted-policy parser
rejects this enum is not a preservation guarantee.

### Session draft rollout

The current development UI stores browser draft repositories and pending-message outboxes in
IndexedDB, outside Web Storage's small synchronous quota. Native clients retain MMKV. Browser
startup prepares drafts before restoring Sync or rendering draft consumers; a failed preparation
uses the existing app recovery boundary rather than treating saved drafts as absent.

The draft repository writes a compact local v2 envelope and reads both v1 and v2. Equal base/local
documents and pending fields are stored once and reconstructed on read; independent conflict
values are retained. This does not change the synchronized draft document or server wire format.
Older UI binaries cannot read this local v2 representation.

Legacy browser values are removed only after their IndexedDB transaction commits. Migration
preserves conflicting copies and reports a failure instead of silently choosing one. Reload older
open tabs when updating the UI so they stop writing the retired Web Storage records. Concurrent
editing from an unupgraded tab during migration is not supported: old Web Storage writers cannot
participate in IndexedDB transactions. Browser
outbox operations await local transaction completion before reporting local custody; enqueue
acknowledgements cannot retire a concurrently recorded cancellation.

Draft autosaves retain failed writes in memory, expose the existing error status, and retry through
the repository's flush owner. Browser draft updates preserve unrelated replicas written by another
tab and reject conflicting changes to the same replica. IndexedDB still has browser/disk limits:
an error is not permission to discard drafts or pending messages, and unsaved in-memory edits must
be preserved before reloading. These device-local stores are not substitutes for server acknowledgement.

Synchronized Session drafts are negotiated through the `sessions.drafts` server feature bit. A new
client fails closed when that bit or the typed routes are unavailable and retains the incumbent
local-only behavior; it does not send draft records through generic Account KV routes. A capable
server reserves the draft KV prefix so old generic-KV clients cannot read or overwrite typed draft
rows.

The first capable client imports the retired local existing-Session text/semantic stores and the
singleton new-Session draft into the canonical draft repository. It removes each legacy value only
after the corresponding canonical record is durably acknowledged, so an interrupted import remains
recoverable. The legacy readers are migration adapters, not parallel writers, and may be removed
when supported persisted local state no longer requires them.

During supported 0.2/0.3 coexistence, the draft authoring map remains closed except for explicitly
enumerated compatibility keys. The 0.2 reader accepts and preserves the 0.3 `executionTarget`,
`organizationPlacement`, `agentTarget`, `modelSelection`, and `runtimeDescriptorV1` fields but does
not treat them as 0.2 execution authority. The 0.3 reader validates and preserves the published 0.2
`machineId`, `serverId`, `agentId`, `backendTarget`, `modelId`, and `codexBackendMode` fields; its UI
projects only exact safe equivalents into canonical execution, Agent, and native-model selections.
Canonical 0.3 fields, including explicit clears, win over predecessor values, and each version's
writers continue to emit only their native catalog. Remove these reader bridges only after
0.2/0.3 coexistence and persisted drafts from the other catalog are no longer supported inputs.

Draft documents preserve unknown extension fields as JSON. This lets a client without a newer
composer contribution edit fields it understands without deleting newer semantic data; it does not
authorize that client to execute the unknown contribution. Raw files, handles, secrets, and other
device-only state remain outside the compatibility shape.

### Request notification previews (development)

`requestIncludeMessageText` extends the existing account notification preferences and
notification-channel objects. Remote readers default a missing field to true;
an explicit false omits request content. The device-local preview setting
is independent of account writeback and defaults to true. No session, permission
response, or webhook payload shape changes: richer text uses the existing body and
`request.toolDetails`, and disabling previews omits details from both.

The released `ui-mobile-v0.2.11` and `ui-web-v0.2.11-preview.186` readers at
`98ea8fb76733b1dd785d38c31360179cafa84824` strip unknown nested notification fields.
Their notification editor rebuilds both preference objects, and raw settings
writeback replaces those objects rather than merging their members. An old-client
edit can therefore erase this flag. The user-selected default is to show previews, so losing an explicit
opt-out restores previews; users can disable them again from an updated client. Older CLI senders ignore
the flag and retain their existing reduced hints. There is no new server operation,
migration, duplicate settings owner, or client-update requirement.

### Foreground permission notifications (Omnia development fork)

The development fork gives each pending CLI permission occurrence an opaque `occurrenceId`.
The canonical request store preserves it while that occurrence remains active and replaces it
when the request is replaced. The CLI waits for agent-state publication before sending the
notification. Its remote push transport stamps `accountId` from the authenticated token subject,
alongside the existing client-facing server URL; caller-supplied account identity cannot override it.

Foreground notification responses use `session.permission.respondToOccurrence.v1` only with a
request occurrence and a matching saved server/account credential. The settlement owner checks
the occurrence and returns an application acknowledgement. Missing identity, mismatched accounts,
stale occurrences or an unsupported method never downgrade to request-id-only approval: the user
opens the app to review. Existing UI-local alerts omit these identities and remain review-only.
The cached response returned at app startup is also review-only, even when both identities are
present. Only a fresh foreground callback can submit a decision. The installed Expo Notifications
0.32.16 async getter wraps a synchronous native snapshot; the hook classifies that snapshot before
subscribing, ignores late callbacks after disposal, and reports read/clear failures by default.
Delayed denial recovery checks the original occurrence before changing local request state, and
Stop retains its captured account scope.

The released `permission` operation remains available through the same settlement owner for
ordinary in-app controls and older clients; it does not gain occurrence guarantees. Source comparison
uses daily CLI `cli-v0.2.16` at `b8d1c449c46ab4dfa8637db36b66f643d149e66d`, stable
`cli-v0.2.17` and preview `cli-v0.2.17-preview.1` at
`a2c45c86804b24e60ac0b76146a3ef36dfcaa15b`, and stable `ui-web-v0.2.19` and preview
`ui-web-v0.2.19-preview.25` at `63829e3cd6a8f1f48b10891af0c8b2313e51ac7e`. Their published
GitHub release assets establish release provenance, not the installed or deployed version.
Older UI readers discard unknown notification/request fields and keep their released behavior.

The `server-v0.2.17` relay at `a2c45c86804b24e60ac0b76146a3ef36dfcaa15b` can forward the
new method for an owning account, but its delegated/shared-session allowlist does not include it.
That direction requires in-app review on the older relay rather than a legacy notification approval.
Current-source encrypted RPC tests exercise publication, settlement, stale/duplicate rejection and
the retained legacy operation; released binary peers and deployed relays were not exercised.

This batch adds no Android background execution capability. Native notification delivery/callback
acceptance and the required 0.3 destination disposition remain unverified; daily installations are
unchanged.

## Migration history

Migration source has a stricter authoring boundary than ordinary internal code:

- A migration is **local-only** while it has not shipped in a supported stable or preview artifact. Local-only migrations may be edited, renamed, consolidated, or removed before publication.
- Once a migration ships in a supported stable or preview artifact, its name and bytes are immutable. Correct later behavior with a new append-only migration; do not rewrite, rename, or delete the released migration.
- Shared development branches and `*-dev.*` artifacts are evidence that a development database may need explicit reconciliation, but they do not create a lasting product compatibility obligation. Before the next supported release, their migration source may be corrected or consolidated in place when the final transition is still unreleased.

Before publishing a feature, consolidate local-only migration churn into the smallest clear transition from the published schema to the intended final schema. Do not retain add-then-drop columns, temporary tables, renamed draft identities, checksum aliases, or corrective migrations solely because a developer database applied an earlier draft. Retain multiple migrations only when each step serves a real rollout, backfill, transaction, provider, or mixed-version requirement.

If a persistent development database applied a local-only draft that is later rewritten:

1. back up or snapshot the database;
2. compare its actual schema and migration ledger with the published baseline and intended final schema;
3. prepare a database-specific, reviewable reconciliation procedure;
4. obtain explicit approval before mutating a database that contains retained user or development data;
5. verify the reconciled schema and ledger against the canonical migration set.

The migration edit and its retained-development reconciliation are one work unit. Compare the complete physical schema—not only columns, but also indexes, constraints, and foreign keys—and test the procedure on a current backup or clone after the final migration edit. Any later edit to the migration invalidates earlier checksum/ledger reconciliation evidence and requires the procedure and proof to be refreshed before handoff.

That reconciliation is an operator/development action, not a shipped compatibility path. Do not add runtime checksum exceptions, migration-name aliases, duplicate no-op migrations, or automatic ledger repair merely to preserve unpublished development history.

Keep PostgreSQL, SQLite, and MySQL migrations aligned by intent. Before publication, validate both a clean migration from the published baseline and the approved reconciliation path for any retained development database. After publication, preserve the exact migration history and test upgrades append-only.

### Unistyles native bindings (development)

The development UI upgrades Unistyles from 3.2.4 to 3.5.3 and Nitro Modules
from 0.35.6 to 0.37.1. Non-publicdev lanes use the new `0.2.9-native`
runtime train, so this JavaScript cannot be delivered to binaries containing
the previous bindings on `0.2.8-native`. Publicdev retains Expo's fingerprint
policy. Rebuild the native development client after installing these dependencies;
a Metro reload alone cannot update the native bindings. Publish the matching
native build before publishing an OTA update for this train.
React Native's CocoaPods post-install owner marks glog's namespace-fragment
headers textual, so Swift can import Nitro's public Fabric headers without
Clang attempting a submodule import inside `namespace google`.
