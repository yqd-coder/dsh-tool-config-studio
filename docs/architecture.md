# Architecture

Tool Config Studio is a browser plugin with a strict layering rule:

> **`src/core` is pure JavaScript — no DOM, no `localStorage`, no browser globals.**
> Everything that touches the page lives in `src/ui` and the client entry.

This is what makes the entire domain logic unit-testable on plain Node, and what lets the same store run in a DSH web client, the standalone demo, or a future Electron surface without changes.

## Layering

```
        ┌────────────────────────────────────────────────────────────┐
        │  demo/            standalone page + static server          │
        └───────────────▲────────────────────────────────────────────┘
                        │ imports /src/client.js over http
        ┌───────────────┴────────────────────────────────────────────┐
        │  src/client.js        public API: mountToolConfigStudio    │
        │  lib/client.js        DSH loader shim (re-export)          │
        │  src/index.js / lib/index.js   host entry (browser-only)   │
        └───────────────▲────────────────────────────────────────────┘
                        │
        ┌───────────────┴────────────────────────────────────────────┐
        │  src/ui/app.js      controller: view state + api callbacks │
        │  src/ui/render.js   pure DOM builders (el() + fragments)   │
        │  src/ui/i18n.js     locale lookup + interpolation          │
        │  src/ui/styles.css  theme                                  │
        └───────────────▲────────────────────────────────────────────┘
                        │ calls
        ┌───────────────┴────────────────────────────────────────────┐
        │  src/core/store.js        overrides-only state machine     │
        │  src/core/validate.js     value predicates + error codes   │
        │  src/core/persistence.js  localStorage adapter (injectable)│
        │  src/core/catalog.js/.json  single source of truth         │
        └────────────────────────────────────────────────────────────┘
```

Dependency rule: arrows only point down. `core` imports nothing from `ui`; `render.js` imports from `core` but never mutates state (it receives callbacks); `app.js` is the only place that coordinates the two.

## Data flow

```
 user input (change event)
        │
        ▼
 app.api.setParam(tool, param, value)
        │  clears the stale inline error first
        ▼
 store.setParam ──────────────► validateOverride (validate.js)
        │ throw: ConfigValidationError            │ pass
        │                                          ▼
        ▼                                    #overrides updated
 api catches → state.errors[key] = msg        event emitted
        │                                          │
        └──────────────┬───────────────────────────┘
                       ▼
              app.refreshAll()  (list + count + footer)
                       │
                       ▼
              persistence.save(store.toJSON())   (subscription in client.js)
                       │
                       ▼
                    localStorage
```

Key property: **there is exactly one re-render path** — store events (or an explicit `refreshList()` for validation errors, which produce no store event). The list region is rebuilt wholesale; the header (with the search box) and the footer chrome are static, so focus and scroll never jump while typing a query.

## Design decisions

### 1. The catalog is the single source of truth

`src/core/catalog.json` declares all tools, parameters, types, defaults, enums, and minimums. `catalog.js` validates it at import time (fail-fast: a malformed catalog crashes the module load with a readable error) and deep-freezes the result. Nothing downstream ever mutates catalog data, and the UI reads *everything* it displays from it — tool names, titles, summaries, parameter hints, category labels (with i18n fallback to `categories.<id>`).

Adding a tool to the product = one JSON entry. The tests enforce the invariants (unique names, sorted order, required params have no defaults, enum defaults are members, `min` only on numbers).

### 2. The store keeps overrides only

The core safety guarantee: **restore is the exact inverse of edit**, which is only possible because the store never stores "a copy of the settings" — it stores *deviations*:

```js
{
  "schemaVersion": 1,
  "tools": {
    "read": { "params": { "limit": 500 } },     // value ≠ default 2000
    "grep": { "enabled": false }                // default is true
  }
}
```

Effective value = `override ?? catalog default`. Storing a value equal to the default clears the override; disabling an enabled-by-default tool records `enabled: false`; re-enabling deletes the entry. `restoreTool(name)` and `restoreAll()` are deletions. There is no second state to drift out of sync with, nothing to "restore to" that isn't the frozen catalog.

### 3. Validation happens at the write boundary

`validate.js` exposes two predicates (`validateParamValue`, `validateOverride`) returning `{ ok, value } | { ok, error }`. The store is the only writer and it throws `ConfigValidationError` (stable `code`: `type-mismatch`, `enum-violation`, `below-min`, `unknown-tool`, `unknown-parameter`, `not-configurable`, `unknown-type`) on invalid input. The UI catches it and renders the message inline — an invalid value can never reach persistence, and a stale error clears on the next committed change.

### 4. Commit-on-change, not commit-on-keystroke

Editors commit on the `change` event (blur / Enter / selection), not on `input`. Combined with the wholesale list re-render, this means the active input is never destroyed mid-edit, search typing stays live (the search box lives in the static header), and the store sees at most one mutation per user action.

### 5. Framework-free rendering

`render.js` is a set of pure builders over a 20-line `el(tag, props, ...children)` helper. No virtual DOM, no framework: 31 tools × a handful of nodes is trivially cheap to rebuild, and "re-render the list" is a complete, honest description of the view's update strategy. `app.js` owns view state (`query`, `expanded: Set`, `errors: Map`) and exposes an `api` object — the render layer can never mutate state directly.

### 6. Persistence is a contract, not an implementation detail

`createLocalPersistence(storage?, key?)` wraps *any* Web-Storage-shaped object (the real `localStorage` by default). Contract: **never throws**. `load()` returns `null` on missing/corrupt/wrong-version data and removes the stale entry; `save()` returns a boolean; storage errors degrade the session to in-memory mode. The document is gated on `schemaVersion` (current: 1) — a future breaking change bumps the version and old documents are dropped deliberately instead of mis-parsed. `ToolConfigStore.fromJSON` is additionally lenient: unknown tools, unknown parameters, and values that no longer validate are skipped, so surviving a catalog update (tools renamed/removed) is safe by construction.

### 7. i18n with a fallback chain

Dictionaries are plain JSON (`locale/en.json`, `locale/zh.json`), imported with `with { type: "json" }`. Lookup: requested locale → English → the key itself, so a missing translation renders the key rather than crashing. `detectLanguage()` reads `navigator.language` (browsers) or `LANG`/`LANGUAGE` (Node) and maps any `zh*` to `zh`.

## Testing strategy

| Layer | Approach |
| --- | --- |
| `core/catalog.js` | Structural invariants + golden tool set (the 31 registered tools) |
| `core/validate.js` | Per-type accept/reject cases, stable error codes |
| `core/store.js` | Full behavior matrix: defaults, overrides, both restore levels, serialization round-trips, lenient hydration, event order |
| `core/persistence.js` | In-memory Web-Storage doubles: round-trip, version gating, corrupt JSON, throwing storage, missing storage |
| `ui` (integration) | `test/dom-smoke.test.js` installs a ~100-line in-memory DOM stub (the exact surface the app uses) and drives the real app end-to-end: mount → expand → edit → validation error → correction → disable → restore-all → unmount cycles |

Running: `npm test` (`node --test test/`). No fixtures, no network, no build step; the whole suite runs in under a second.

## DSH integration surface

The published entry points follow the convention of DSH's shipped web packages:

- `package.json` → `dsh.client = { platform: "web", inject: [] }`; `exports` maps `.`, `./client`, `./src/*`, `./locale/*.json`.
- `lib/index.js` re-exports `apply()` from `src/index.js` (a no-op: this plugin has no host-side behavior).
- `lib/client.js` re-exports the full public API from `src/client.js`.
- `locale/{en,zh}.json` are importable dictionaries in the DSH locale-dictionary shape.

The supported integration is `mountToolConfigStudio(container, options)` from a DSH web client (or any page): it wires persistence → store → i18n → app and returns `{ store, app, unmount }`. Because every collaborator is injectable, a host that already keeps settings elsewhere (e.g. in a profile patch) can pass its own `store` and `persistence` and reuse the whole UI.
