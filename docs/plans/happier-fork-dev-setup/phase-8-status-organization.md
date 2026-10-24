# OH-60: Independent status sorting and grouping

## Context and scope

Continue the authorized Happier project on the existing feature branch. OH-60 adds Agent Status and Ticket Status to independent sidebar grouping and sorting choices. OH-57 owns runtime meaning, OH-58 owns provider ticket status, and OH-14 owns organization. Reuse those owners; do not add another classifier, reader, persisted status cache or organization store. Preserve the running daily app. Native acceptance remains a separate gate.

## Design constraints

- Extend existing grouping controls. A status group replaces machine/repository presentation while retaining saved organization for restoration. Preserve the applicable Pinned section and folder intent; document their exact interaction after inspecting current projection owners.
- Keep sorting independent: Ticket Status groups can sort by Agent Status. Reuse existing preference storage/default conventions; current ordering is an account preference, so do not invent a competing local setting.
- Reuse OH-57 canonical states and labels. Prefer attention first: error and needs input before working, queued/transient states, idle and finished. Name every supported state in the final deterministic ordering and preserve stable ties.
- Preserve custom ticket workflow names and provider-supplied order within the same provider/workspace/workflow. Across workflows use deterministic provider/workspace/workflow ordering; unrelated numeric ranks are not one global workflow.
- Keep No ticket distinct from linked-unavailable. Loading, stale and revoked states remain honest and agree with row badges.
- Reuse OH-58 shared scoped status projection. List demand cannot depend on a row already being visible in a status group. Define bounded demand and account invalidation through that owner before coding; no second request owner.
- Preserve selection, visible-index keyboard navigation, filters, manual ranks and machine/repository identity. Updates can move rows without duplicating sessions or rewriting manual organization.

## Tasks and validation

- [ ] 🟡 Discover grouping, ordering, preferences and the OH-58 subscription boundary; record the concrete design before edits.
- [ ] 🔴 RED/GREEN all four options, mixed group/sort, custom multi-workflow order, stable ties, No ticket versus unavailable, and selected-session continuity.
- [ ] 🔴 Verify Pinned, filters, folders and machine/repository restoration through real projection/preference owners.
- [ ] 🔴 Mounted controls and isolated system Chrome using fixture machine RPC; persist and reload preferences. Preserve meaningful assertions.
- [ ] 🔴 Independent review, relevant typechecks, focused/adjacent checks and router assessment. Source/browser evidence does not establish native completion.

Routing selects Sol/high, zero failed cycles. Actual dispatch follows available capacity and OH-58 integration; classification alone is not execution. The previously reported route-and-execute transport error requires the explicitly selected native worker fallback.
