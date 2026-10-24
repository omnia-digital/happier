# GitHub PR watches and session notifications

OH-61 investigation, 2026-10-23. This is a recommendation for a future capability, not a shipped feature or authorization to configure GitHub or deploy a service.

Happier has useful PR readers and authenticated session delivery primitives, but the inspected source does not implement a working webhook-driven PR watch. This cannot currently be established by replacing only the macOS UI while retaining the original hosted service and CLI 0.2.16.

## Existing support and missing connections

| Owner | Observed behavior | Missing for a PR watch |
| --- | --- | --- |
| [GitHub App handlers](../../apps/server/sources/app/auth/providers/github/webhooks.ts) and [server startup](../../apps/server/sources/startServer.ts) | App initialization registers log-only event handlers. Whole-server searches found no consumer of `getWebhooks()` or `verifyAndReceive()`. | No proven reachable inbound webhook route or session-event delivery. Hosted configuration was not inspected. |
| [PR protocol](../../packages/protocol/src/scmPullRequests.ts), [PR operations](../../apps/cli/src/scm/backends/git/operations/pullRequestOperations.ts), [provider adapters](../../apps/cli/src/scm/hostingProviders/providers/githubRestAdapter.ts), [status cache](../../apps/cli/src/scm/hostingProviders/prStatusCache.ts) | On-demand PR reads, branch/state summaries and a short cache. | No watch registration; summary lacks head SHA and workflow/check identity. OH-52 owns the planned durable session-to-PR association. |
| [Session idle wait](../../apps/cli/src/session/services/waitForSessionIdle.ts) and [execution-run wait](../../apps/cli/src/cli/commands/session/run/wait.ts) | Wait for agent idleness or an existing execution run. | Neither waits for GitHub progress. |
| [Session client](../../apps/cli/src/api/session/sessionClient.ts) | Transcript event writes originate from the Agent. Optional broadcast-safe `session` socket hints currently have a no-op consumer. | An inbound GitHub hint does not automatically reach an Agent or wake it. |
| [Authenticated message admission](../../apps/cli/src/session/services/sendSessionMessage.ts) | A key-holding client can admit an encrypted turn and choose runtime/resume delivery. | Automated PR delivery needs an explicit active-turn/idle-runner policy and compatible client/daemon consumer. Push notifications or a badge alone do not satisfy this requirement. |

The encryption boundary is material: [message writes](../../apps/server/sources/app/session/sessionWriteService.ts) and [pending-message materialization](../../apps/server/sources/app/session/pending/materializeNextPendingMessage.ts) enforce session mode/content-kind compatibility. An E2EE session needs ciphertext supplied by an authorized key-holding client; a webhook receiver cannot manufacture an encrypted transcript update from plaintext. Existing [account/session/machine rooms](../../apps/server/sources/app/api/socketRooms.ts) are routing primitives, not proof that a PR-watch consumer exists.

## Event coverage and permissions

Proposed subscriptions below use the current [GitHub webhook event reference](https://docs.github.com/en/webhooks/webhook-events-and-payloads). Request only the event families actually enabled.

| Purpose | Events | GitHub App repository permission |
| --- | --- | --- |
| PR lifecycle, new head, ready/draft, closed/merged | `pull_request` | Pull requests: read |
| Reviews, diff comments, resolved/unresolved threads | `pull_request_review`, `pull_request_review_comment`, `pull_request_review_thread` | Pull requests: read |
| General PR conversation, if selected | `issue_comment` | Issues: read |
| Actions run requested/running/completed | `workflow_run` | Actions: read |
| Check details, if needed | `check_run`; optionally `check_suite` | Checks: read; requested-action/rerequest events need write access and are unnecessary for the initial watcher |
| Other configured commit-status services | `status` | Commit statuses: read |

Repository/organization check webhooks have narrower action coverage than GitHub Apps. Fork check payloads can omit PR associations. Re-read the current PR to distinguish merged from closed-unmerged; do not route exclusively from payload PR arrays. Actions workflow-trigger recursion restrictions do not define external webhook receiver availability. [Actions event documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) also distinguishes run attempts and reruns; reconciliation must not depend on receiving a fresh `requested` event for every rerun.

### Actual fork CI sample

The fork's [CI Tests workflow](../../.github/workflows/tests.yml) runs on pull requests. Read-only GitHub inspection of merged PR #3 head `9b3e712f8f8eb5770df347b97d9969df5f494f3e` found 38 check runs, all `github-actions`. [Run 40039543555](https://github.com/omnia-digital/happier/actions/runs/40039543555) was successful, `event=pull_request`, attempt 1, yet its `pull_requests` array was empty. Root independently reproduced these facts through the connector and read-only REST API.

The combined commit-status response was `state=pending` with `statuses=[]`, despite that successful Actions run. Absence of legacy statuses must not be interpreted as failing or pending Actions CI. Use the relevant [workflow runs](https://docs.github.com/en/rest/actions/workflow-runs), [check runs](https://docs.github.com/en/rest/checks/runs) and [commit statuses](https://docs.github.com/en/rest/commits/statuses) owners separately. This is one verified fork sample, not an inventory of every repository Josh may watch.

## Smallest coherent implementation direction

This is an architectural recommendation, not an approved schema or deployment plan:

1. OH-52 owns the canonical session-to-PR association. Add explicit watch/unwatch intent there rather than a second session-link registry. Resolve provider installation, repository ID and PR number; retain current head SHA and CI identities as reconciled provider state.
2. A trusted hosted receiver validates the signature over the raw request body and accepts only authorized installations/repositories. Its server-readable routing association must include the owning Happier Home/account/session and watch state; opaque E2EE transcript content cannot serve as its lookup index. Revoke delivery when installation access, session access or watch intent is removed.
3. Treat a delivery as a scoped change hint, then read current PR/CI state. Compare PR head SHA, workflow/run ID/attempt and check SHA before announcing progress. Old-head results remain historical. Repeated or reordered deliveries must not roll current state backward. Use the GitHub delivery ID for ingress duplicate suppression; do not claim exactly-once Agent delivery from that alone.
4. Route the authorized hint through the existing account/session transport. A compatible key-holding client/daemon reconciles it and delivers the meaningful, encrypted update through the existing pending-input owner. An Agent waiting during an active turn needs an explicit watch-wait action; idle wake/resume behavior is a separate policy decision. Do not silently inject automatic user turns or claim a transcript-event write already implements this.
5. Initialize a baseline at watch start and reconcile after reconnect, unavailable/unknown state, or a chosen inactivity deadline. Preserve the watch while a client is offline; retained watch intent plus a current snapshot permits recovery without adding constant polling. Any promise to replay every intermediate transition would require additional retention not established by this investigation.

GitHub's [best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks) require prompt acknowledgment and signature verification. Event processing should not hold the request open while waiting for a machine or Agent. GitHub [does not automatically redeliver failures](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries); the implementation needs an explicit recovery path. Start with targeted reconciliation for the watch's actual current-state requirement, and separately authorize delivery-management access if automatic redelivery is required.

## Inactivity and unknown status

The user must choose an interval or deadline when enabling inactivity detection. Meaningful progress means a verified PR-head, review/thread, lifecycle or relevant current-head CI transition selected by that watch. Duplicate deliveries, refreshes and unchanged snapshots do not reset that clock.

At the chosen deadline, perform one targeted provider read. Announce inactivity only when current state is known and no qualifying transition occurred. An unavailable provider, revoked access or missing delivery is an unknown/access problem, not evidence that work stalled. Reconnect performs reconciliation before making a new inactivity claim. No default timeout, periodic polling loop or background scheduler was implemented or selected here.

## Setup and decisions required before implementation

- Establish operator authority over the actual hosted service and a reachable HTTPS receiver. Neither OAuth login nor local connected-account credentials prove a GitHub App installation or ingress on `api.happier.dev`. Keeping that service unchanged currently leaves the receiver/delivery capability unavailable; alternatives would require a separately authorized hosting/transport decision.
- Configure a GitHub App's URL/secret and selected read permissions/subscriptions, then install it only on chosen repositories. A [repository webhook](https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks) can serve one repository but still needs an authorized reachable receiver and repository administration access.
- Define watch visibility, active-Agent wait versus idle wake policy, permitted notification content, and the user-selected inactivity interval. Keep OH-52's opt-in archive/cleanup policy separate; a merge hint alone must not run cleanup.
- Deploy and verify the server plus a compatible UI/CLI/daemon or Agent action. The installed 0.2.16 runtime has not been qualified for this new protocol. Report unsupported capability honestly and preserve existing clients; a macOS UI-only update cannot supply missing server/daemon behavior.

No provider registration, settings/credential change, product implementation, runtime test or live webhook-to-Agent acceptance occurred. Hosted configuration/deployment access remains unverified.

## Validation recipe for a separately authorized implementation

1. Start and stop a watch through the real association owner; verify initial snapshot, correct Home/account/session and denied cross-account access.
2. Push a new commit; deliver old-head and current-head CI events in both orders. Verify requested/running/failing/passing, skipped/cancelled outcomes and rerun attempts without announcing stale work as current success.
3. Exercise review submission/dismissal, diff comments and thread resolution; include general comments only if enabled. Distinguish close-unmerged, reopen and confirmed merge.
4. Deliver duplicates, reordered events, empty PR arrays and fork events. Verify no duplicate meaningful update or wrong-session delivery; then revoke installation/session access and unwatch.
5. Disconnect and reconnect the client/daemon, including a missed delivery. Verify current-state reconciliation, honest unknown status and the explicitly promised retention limits.
6. Use a user-chosen deadline to prove both verified inactivity and provider-unavailable outcomes. Confirm unchanged snapshots do not extend the deadline.
7. Demonstrate an actual Agent wait receiving the correct update and the chosen idle wake/resume behavior through the loaded compatible runtime. A passive UI badge, push receipt or successful webhook acknowledgment is insufficient.

Related work: OH-52 owns links and archive/cleanup policy; OH-9 owns any later relay-hosting adoption. This investigation does not revive the deferred PR-review UI.
