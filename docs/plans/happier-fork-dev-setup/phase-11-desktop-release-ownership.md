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

- [x] 🟢 Trace canonical effective variant configs, updater calls, installer destinations and fork/dev build consumers; distinguish inert documentation from executable source defaults.
- [x] 🟢 Record smallest source-backed ownership design before edits, including coexistence and unavailable ownership inputs.
- [ ] 🔴 RED/GREEN effective fork config/update destination/trust guards, stack overrides, release refusal when ownership is unconfigured, and affected CLI/sidecar source contracts.
- [ ] 🔴 Validate required generated/config artifacts without launching or replacing the running app. Use isolated output paths and preserve existing artifacts/work.
- [ ] 🔴 Relevant typechecks/tests and independent source review. Keep actual signing/notarization/installation/platform acceptance separate.

Routing selected Sol/high, zero failed cycles. The source worker completed discovery and design; implementation and validation remain pending. Full OH-5 remains broader than this macOS-first source slice.

## Source corridor and ownership decision (2026-10-23)

- Observed: `desktop_fetch_update` in `apps/ui/src-tauri/src/lib.rs` calls the Tauri updater plugin. Its effective base plus publicdev/preview JSON chooses identifier, feed and verification key; `desktopUpdater.ts` is the one UI scheduler. The repo-local dev command merges the publicdev overlay and applies a stack-scoped identifier through `buildStackTauriDevConfig`; that path must continue unchanged.
- Observed: `scripts/pipeline/tauri/channel-config.mjs` chooses release channel overlays; `build-updater-artifacts.mjs` produces Tauri bundles, while `prepare-publish-assets.mjs --repo` creates update manifests. The standalone `apps/ui/scripts/runTauriCli.mjs` is another build entry point. Current `validate-updater-pubkey.mjs` rejects only an empty/placeholder key, so the upstream key passes today.
- Observed: executable first-party downloads have independent owners: CLI self-update, relay runtime/doctor, stack self-host runtime, standalone shell/PowerShell installers and the relay-server runner. Some have an override but default to the upstream repository and/or upstream minisign trust. Stack source clone defaults are used by bootstrap when no repo is supplied; help/provisioning references are separate.
- Decision: preserve the current dev stack and its identifiers. Reject distributable desktop preparation while the fork's Tauri identifier, matching fork feed and distinct updater trust are unconfigured. Put that check at the canonical Tauri build/preparation entry points rather than rewriting the live dev configuration. For binary/update paths, align executable defaults with the fork only together with fork-owned signature trust; when that trust is unavailable, refuse the update instead of treating the upstream key as fork authority. Preserve explicit user-supplied source overrides and upstream reference text.
- Missing external ownership evidence: registered macOS bundle identifiers, an Omnia updater public key with securely stored private signer, fork release feeds/assets, and Developer ID/notarization credentials. Source checks can prove fail-closed preparation and coexistence, but cannot establish those external facts or an installed native receipt.
