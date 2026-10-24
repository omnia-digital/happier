# OH-5: macOS-first fork release ownership

## Scope

Prepare source configuration needed before an Omnia macOS adoption candidate can be distributed safely. Preserve the running repo-local app, its stack identity/storage and the original installed Happier app. iOS/Apple App Store and Expo registration work remains deferred by Josh; do not request or change those accounts now.

## Confirmed starting evidence

OH-55 changed display names and artwork while explicitly preserving existing identifiers. Current Tauri base/variant files still contain `dev.happier.app` identifiers and upstream updater trust/endpoints. Repository source-install/update helpers also contain upstream defaults. These are discovery inputs, not proof that every path automatically installs an update. Trace actual consumers before changing them.

## Constraints and decisions

- Reuse canonical variant, stack, release-manifest and updater/installer owners. Keep fork differences localized and maintainable for upstream sync; no broad brand-string replacement or parallel release harness.
- A proposed bundle identifier is not a registered Apple identity. Source preparation may require explicit fork-owned configuration or fail release preparation when it is absent. Do not invent verified ownership or silently ship an upstream identifier/key/feed as Omnia's.
- Keep the exact approved display names Omnia Happier and (Dev) Omnia - Happier and the existing distinct artwork. Existing scoped dev stack identifiers/auth/storage must continue to work without migration/restart during source edits.
- Trace automatic and explicit update paths for desktop, CLI and setup sidecars. A fork build must not silently become upstream. Preserve upstream source/reference metadata where it is documentation, not an executable update destination.
- Keep credentials/private keys out of Git. No signing-key/account/credential changes, provider registration, GitHub release/settings/workflow write, install, service activation or daily cutover in this source task. Current policy permits only feature-branch git pushes outside Linear.
- Prepare concrete reviewable configuration and validation first. Record actual remaining macOS signing/update inputs afterward; iOS inputs remain deferred. Do not equate local metadata/artifact tests with notarization, installed-native receipt or a stable release.

## Tasks and validation

- [ ] 🟡 Trace canonical effective variant configs, updater calls, installer destinations and fork/dev build consumers; distinguish inert documentation from executable source defaults.
- [ ] 🔴 Record smallest source-backed ownership design before edits, including coexistence and unavailable ownership inputs.
- [ ] 🔴 RED/GREEN effective fork config/update destination/trust guards, stack overrides, release refusal when ownership is unconfigured, and affected CLI/sidecar source contracts.
- [ ] 🔴 Validate required generated/config artifacts without launching or replacing the running app. Use isolated output paths and preserve existing artifacts/work.
- [ ] 🔴 Relevant typechecks/tests and independent source review. Keep actual signing/notarization/installation/platform acceptance separate.

Routing selects Sol/high, zero failed cycles. Actual worker dispatch is pending capacity; classification alone does not mean implementation occurred. Full OH-5 remains broader than this macOS-first source slice.
