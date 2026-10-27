# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/yqd-coder/dsh-tool-config-studio/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yqd-coder/dsh-tool-config-studio/releases/tag/v0.1.0
