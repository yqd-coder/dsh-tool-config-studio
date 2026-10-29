# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/yqd-coder/dsh-tool-config-studio/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/yqd-coder/dsh-tool-config-studio/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/yqd-coder/dsh-tool-config-studio/releases/tag/v0.1.0
