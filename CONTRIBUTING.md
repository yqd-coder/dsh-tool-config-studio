# Contributing to DSH Tool Config Studio

Thanks for your interest! The project is small on purpose — the bar for contribution is: **keep it dependency-free, keep the core DOM-free, and keep every change covered by a test.**

## Prerequisites

- **Node.js ≥ 22** (the test suite uses the built-in test runner and ES import attributes; the demo server has zero dependencies)
- No npm packages are required for development.

## Development loop

```sh
git clone https://github.com/yqd-coder/dsh-tool-config-studio.git
cd dsh-tool-config-studio

npm test        # node --test test/   — 37 tests, < 1s
npm run demo    # zero-dependency static server → http://localhost:4173/demo/
```

There is no build step: the source **is** the distribution. `lib/*.js` are one-line re-export shims for the DSH loader convention; edit `src/`, never `lib/`.

## Project rules

1. **`src/core` must stay pure** — no `document`, no `window`, no `localStorage`, no `fetch`. If a piece of logic needs the DOM, it belongs in `src/ui`.
2. **The catalog is the single source of truth.** All UI text about tools/parameters comes from `src/core/catalog.json` (plus `locale/*.json` for chrome labels). Never hard-code tool names or defaults in the UI.
3. **Validation at the write boundary.** Any new write path must go through `validate.js`. Errors are `ConfigValidationError` with a stable `code`; add the new code to the table in [docs/configuration-model.md](docs/configuration-model.md).
4. **The store keeps deviations only.** Do not introduce any representation of "the full settings" — it would break the exact-inverse guarantee of restore.
5. **Plain ESM, zero runtime dependencies.** `package.json` has no `dependencies` or `devDependencies` for a reason.
6. **Style.** 2-space indent, LF, no semicolon-omission experiments — follow the existing files. Public exports get JSDoc (the source is the type documentation).

## Adding a tool (or parameter) to the catalog

1. Add the entry to `src/core/catalog.json`:
   - the tool (or parameter) in **alphabetical position** (tools are sorted by `name`);
   - `type` / `required` / `default` / `enumValues` / `min` per [docs/configuration-model.md](docs/configuration-model.md#1-the-catalog-source-of-truth);
   - `configurable` only when the derived `!required` is wrong.
2. If the tool belongs to a new category: add the category (next free `order`) **and** a `categories.<id>` label in **both** `locale/en.json` and `locale/zh.json`.
3. If you changed the expected tool set, update the golden list in `test/catalog.test.js` ("the core dsh tool set is present" asserts exact equality with the catalog).
4. Run `npm test` — the structural invariants (sorted order, unique names, required ⇒ no default, enum membership, `min` on numbers) fail loudly on mistakes.

## Adding a UI feature

- Render logic goes in `src/ui/render.js` as a pure builder (no state mutation, no `document` global beyond `createElement`/`createTextNode`).
- Behavior (what an action does) goes in the `api` object in `src/ui/app.js`.
- If your feature is user-facing wording, add the key to **both** locale files.
- Extend `test/dom-smoke.test.js` (the DOM stub covers the surface the app uses; grow it only if your feature needs more).

## Pull request checklist

- [ ] `npm test` passes (all suites)
- [ ] `npm run demo` manually checked for the changed behavior (EN + 中文 if i18n touched)
- [ ] Docs updated when user-visible behavior changed (README / docs/)
- [ ] `CHANGELOG.md` has an entry under `Unreleased`
- [ ] No new runtime dependencies

## Issues

Report bugs with: DSH version (or demo), browser/Node version, the tool + parameter involved, and what you expected vs. what happened. For "restore didn't bring my setting back" reports, include the contents of `localStorage["dsh-tool-config-studio.v1"]` — those are almost always catalog-drift questions, and the document makes them diagnosable in seconds.
