# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-10-29

### Added

- **System Plugin Studio panel** — a second sidebar/main panel pair (`system-plugin-studio`) that scans the live DSH settings document and visualizes every system plugin whose parameters are exposed as *volatile* (editable per profile): model adapters (`llm-pi-ai` providers and models), the active profile's `llm-deepseek` adapter, `agent-default-model`, and any other plugin that declares volatile fields.
- **Schema-driven forms** — each entry renders from its schemastery schema: nested objects as labeled groups, dictionaries as keyed sections with Add/Remove, arrays as indexed items, enums as selects, booleans as selects, numbers/strings as validated text inputs, JSON as a textarea, literals as read-only values, and secrets as masked inputs that only ever show "set / not set" state.
- **Staged edits with live working values** — edits are staged per entry (never written until Save), applied to a working copy so Add/Remove and in-progress fields are visible before flushing; invalid input fails inline and never reaches the store. Targeted "stage" updates refresh only the entry's badges/action row, so typing never rebuilds focused inputs.
- **One-click restore** — per-field "Reset" (an `unset` op that falls back to the schema default) and per-entry "Restore defaults" (`replace` with an empty section), both confirmation-guarded. System defaults are preserved by the Host beneath the profile override, so restore is exact.
- **Pushed refresh** — the panel subscribes to `settings/document-updated` and re-describes when another editor (or the shell itself) changes the document; the subscription is disposed with the page.
- **New modules**: `src/system/schema.js` (schemastery traversal, leaf parsing/formatting, ops application), `src/system/store.js` (envelope unwrapping, staged edits, revision-checked `mutate`/`replace`, resync-on-conflict), `src/system/app.js` (framework-free DOM app, `mountSystemPluginStudio`).
- **Locale**: ~29 `system.*` keys in `locale/en.json` and `locale/zh.json`; both panel labels (`panel`, `systemPanel`) now share one `tool-config-studio` locale registration.
- **Styles**: `sys-*` theme reusing the existing `--tcs-*` design tokens.
- **Tests**: 41 new cases — schema (17), store (14), a DOM smoke suite for the system app (9), and a bundle-contract test that mounts the system panel against a fake settings remote. Suite 42 → 83.

### Changed

- `apply(ctx)` now injects `["slots", "locale", "remote", "remote.settings"]` and registers two `sidebar.panellist` entries (orders 100/200) and two `main` panels.
- `build/client.mjs` entry source: second icon, page factory, and settings adapter for the system panel.
- Package version 0.2.2 → 0.3.0.

### Notes

- **Personas and system prompts are not editable in this panel.** `dsh-persona`, `dsh-system-prompt`, and `dsh-agent-instructions` expose zero volatile fields, so their parameters are deployment-level and outside the per-profile settings surface this panel edits. The panel's note (and the README) state this explicitly rather than pretending otherwise.
- The panel is read/write only where the Host reports the settings document `writable`; otherwise it degrades to a read-only browser.

## [0.2.2] - 2026-10-29

### Fixed

- **Updating the plugin in a running shell failed** with `locale namespace "tool-config-studio" already has locale "en"`. The host removes locale entries only through the disposer `ctx.locale.register` returns, and `ctx.effect` calls the effect's return value on module teardown — but the dictionary effect swallowed that disposer, so the namespace was never released and the next materialization's registration threw, aborting the sync. The effect now returns the disposer, and tolerates the one-time migration from a disposer-less build (identical dictionaries) instead of failing the whole sync.
- **Bundle contract tests** now mirror the host's non-idempotent `locale.register` (it throws on a held locale and hands back the only disposer), and two regression tests cover an update re-materialization and the stale-registration migration. Suite 40 → 42.

## [0.2.1] - 2026-10-29

### Fixed

- Main panel did not scroll inside the DSH shell — content taller than the viewport was clipped. The panel root (`.tcs-root`) is now the scroll container (`height: 100%`, `overflow-y: auto`, `overscroll-behavior: contain`), following the main-page convention of DSH's own plugin manager. Standalone pages (no definite container height) are unaffected.

## [0.2.0] - 2026-10-29

### Added

- **DSH bundle** — the package now declares `dsh.bundle.patch` (`cordis.patch.yml`) and installs as a first-class plugin from the Plugins page (paste the repository URL); it inserts one web row, `tool-config-studio`.
- **Built browser module bundle** (`lib/client.js`, new) — a committed classic script following DSH's client module contract: registers with `window.__ModuleLoader__` under the package id, lazily materializes through a `(require) => exports` factory, injects the CSS as a tracked `data-plugin-css` style tag, and exposes `inject` + `apply(ctx)`.
- **Sidebar + main panel** — `apply(ctx)` registers a `sidebar.panellist` entry (host-localized label via a registered locale namespace) and a `main` panel keyed `tool-config-studio` that mounts the existing `mountToolConfigStudio` UI (React is the shell, 15 lines of glue).
- **Zero-dependency build** (`build/client.mjs`) — deterministic ESM → classic-bundle transform of the shipped sources (JSON + CSS inlined); fails fast on unsupported ESM forms.
- **Bundle contract tests** — `test/bundle-contract.test.js` (3 tests) rebuilds the bundle in-process and executes it under a `__ModuleLoader__` stub, a fake client context, and minimal React + DOM stubs: registration, lazy materialization, CSS injection, slot registrations, and a real UI mount/unmount.
- Bundle display `meta.title` in both locale files.

### Changed

- `lib/client.js` is now the built loader bundle (previously a re-export shim). Custom hosts should import the ESM source at `/src/client.js` instead of `/client`.
- Package version, description, `exports`/`files` (`./cordis.patch.yml`), and `build` script.
- Test count 37 → 40.

### Docs

- README (EN/中文): install-from-Plugins-page instructions, updated wiring table and layout.
- `docs/architecture.md`: full client module contract + build section.
- `CONTRIBUTING.md`: build step, supported-ESM-forms rule, updated checklist.

## [0.1.0] - 2026-10-27

### Added

- Initial release.
- **Tool catalog** (`src/core/catalog.json`) covering all 31 registered DSH tools across 11 categories, with per-parameter type, required flag, defaults, enum values, and minimums; validated and deep-frozen at load.
- **Override-only configuration store** (`ToolConfigStore`): stored values are deviations from catalog defaults, so restoring is the exact inverse of editing; enable/disable toggles; per-tool and global restore; change events; JSON (de)serialization with lenient hydration.
- **Strict validation** (`validate.js`) with stable error codes (`type-mismatch`, `enum-violation`, `below-min`, `unknown-tool`, `unknown-parameter`, `not-configurable`, `unknown-type`); invalid values never reach storage.
- **Safe persistence** (`createLocalPersistence`): localStorage under `dsh-tool-config-studio.v1`, schema-version gating, corrupt-data removal, and in-memory degradation when storage is unavailable or failing.
- **Web UI**: searchable tool list grouped by category, expandable tool detail with per-type editors (number + min, boolean, string, enum select), enabled switch, inline validation errors, modified badges, per-parameter reset, per-tool restore, and confirm-guarded "Restore all defaults"; dark theme.
- **i18n**: English and Simplified Chinese dictionaries with auto-detection and locale → English → key fallback.
- **Public client API** (`mountToolConfigStudio` + injectable `store` / `persistence` / `i18n` / `language`).
- **Standalone demo** (`npm run demo`) with a zero-dependency static server.
- **Test suite**: 37 tests on `node --test` — catalog integrity, store behavior matrix, validation, persistence (in-memory storage doubles), and an end-to-end UI smoke test on a minimal in-memory DOM.
- **Documentation**: bilingual README, architecture and configuration-model docs, contributing guide.

[Unreleased]: https://github.com/yqd-coder/dsh-tool-config-studio/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/yqd-coder/dsh-tool-config-studio/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/yqd-coder/dsh-tool-config-studio/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/yqd-coder/dsh-tool-config-studio/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/yqd-coder/dsh-tool-config-studio/releases/tag/v0.1.0
