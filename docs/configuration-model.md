# Configuration Model

This document specifies the three artifacts of the plugin — the **catalog**, the **override store**, and the **storage document** — and the rules that relate them.

## 1. The catalog (source of truth)

`src/core/catalog.json` is a plain JSON document validated and deep-frozen at module load (`src/core/catalog.js` throws on any structural violation, so a bad catalog fails fast with a readable error).

```jsonc
{
  "$schemaVersion": 1,
  "categories": [
    { "id": "filesystem", "label": "Filesystem", "order": 10 },
    { "id": "search",     "label": "Search",     "order": 20 }
    // … 11 categories, sorted by `order`
  ],
  "tools": [
    {
      "name": "read",                  // wire name, unique across the catalog
      "title": "Read file",
      "summary": "Read a UTF-8 text file and return line-numbered content.",
      "category": "filesystem",        // must reference a category id
      "enabledByDefault": true,
      "parameters": [
        {
          "name": "file_path",
          "type": "string",            // string | number | boolean | array | object
          "required": true,
          "description": "Path to read, resolved by the filesystem backend.",
          // required parameters end here: no default, no enumValues, no min
        },
        {
          "name": "limit",
          "type": "number",
          "required": false,
          "description": "Maximum number of lines to return. Defaults to 2000.",
          "default": 2000,             // must match `type`; absent ⇒ "not set"
          "min": 1                     // only for number parameters
        }
      ]
    }
    // … 31 tools total, sorted by `name`
  ]
}
```

### Structural invariants (enforced at load and in tests)

- Category ids unique; tools sorted by `name`; every tool references an existing category.
- Parameter names unique within a tool.
- `required: true` ⇒ `default` is null and the parameter is **not configurable**.
- `enumValues`, when present, is a non-empty unique list of strings; a declared `default` must be a member.
- `min`, when present, is only on `number` parameters, and a declared `default` must respect it.

### Parameter types

| `type` | Accepts | Extra constraints | UI editor |
| --- | --- | --- | --- |
| `string` | strings | optional `enumValues` membership | text input, or select when `enumValues` is set |
| `number` | finite numbers | optional `min` | number input |
| `boolean` | booleans | — | checkbox |
| `array` | arrays | — | read-only (no configurable array params today) |
| `object` | plain objects | — | read-only (no configurable object params today) |

### Configurability

A parameter is **configurable** (i.e. eligible for a stored default) when `configurable` is explicitly declared, otherwise it is derived as `!required`:

```js
configurable = param.configurable ?? !param.required
```

The UI splits every tool's parameters into **Stored defaults** (configurable → editable) and **Per-call arguments** (non-configurable → shown read-only with their required flags).

## 2. Validation

`src/core/validate.js` is the only gate between user input and the store. Two predicates:

- `validateParamValue(param, value)` — value against one catalog parameter.
- `validateOverride(toolName, paramName, value)` — existence + configurability + value.

Both return `{ ok: true, value }` or `{ ok: false, error: ConfigValidationError }`; the store throws that error. Every error carries a **stable machine-readable `code`** plus a human-readable message:

| `code` | Meaning |
| --- | --- |
| `type-mismatch` | Value's type ≠ declared type (incl. `NaN`, `null`, non-finite) |
| `enum-violation` | String not in `enumValues` |
| `below-min` | Number < declared `min` |
| `unknown-tool` | Tool not in the catalog |
| `unknown-parameter` | Parameter not on that tool |
| `not-configurable` | Parameter is a required per-call argument |
| `unknown-type` | Catalog declares a type the validator doesn't know (defense in depth) |

Consequences: an invalid value **never** reaches the store or persistence; the UI renders the message inline and clears it on the next committed change.

## 3. The override store

`ToolConfigStore` (`src/core/store.js`) is an in-memory state machine over the catalog.

**Core invariant: the store contains deviations only.** A parameter is stored iff `value !== catalog default`; the `enabled` flag is stored iff it differs from `enabledByDefault`. Everything else is *derived*:

| Read | Computation |
| --- | --- |
| `isEnabled(name)` | `enabled` override, else `tool.enabledByDefault` |
| `effectiveParam(name, param)` | parameter override, else `param.default` (or `null`) |
| `hasParamOverride / hasEnabledOverride / isModified` | presence checks on the overrides table |
| `modifiedTools() / modifiedSummary() / overrideCount()` | aggregates for badges and the footer |

**Writes**

| Operation | Behavior |
| --- | --- |
| `setEnabled(name, bool)` | stores `enabled` when it differs from the default, deletes it when it matches; throws on unknown tool / non-boolean |
| `setParam(name, param, value)` | `null` ⇒ `clearParam`; otherwise validates, stores when `value !== default`, deletes when equal |
| `clearParam(name, param)` | removes the parameter override; silent no-op when absent |
| `restoreTool(name)` | deletes the tool's entire entry (no-op when unmodified; throws on unknown tool) |
| `restoreAll()` | replaces the whole table with an empty one |

Empty tool entries are pruned (`#maybeDelete`) so `toJSON()` never serializes noise.

**Events** — `subscribe(listener)` receives `{ kind, tool, param? }` synchronously on every mutation; `kind` is one of `param`, `enabled`, `restored-tool`, `restored-all`. Unmodified writes (e.g. `clearParam` with no override) emit nothing.

### Why overrides-only

"Restore" must be *the exact inverse of edit*, so a user who "broke" a setting is always one click from factory state. If the store held full copies of settings, restore would have to know which copy was the original — a second source of truth that can drift. With deviations only, the catalog is the only source of truth and restore is pure deletion: there is no state it can get wrong, and no other setting it can touch.

## 4. The storage document

Serialization target of `toJSON()` / `ToolConfigStore.fromJSON()`, persisted by the UI under the localStorage key **`dsh-tool-config-studio.v1`**:

```json
{
  "schemaVersion": 1,
  "tools": {
    "read":        { "params": { "limit": 500 } },
    "grep":        { "enabled": false },
    "list_agents": { "params": { "scope": "descendants" } }
  }
}
```

Rules:

- `tools` maps tool names to `{ enabled?: boolean, params: Record<string, value> }`. Both keys are optional; an entry appears only while it carries at least one effective deviation.
- `enabled` is serialized only when it differs from `enabledByDefault`.
- Values are JSON-safe (the current catalog stores strings, numbers, and booleans).

### Hydration is lenient by design

`fromJSON` never throws. It silently skips: unknown tools, unknown parameters, non-object entries, and values that no longer validate against the *current* catalog. Rationale: the catalog evolves (tools renamed, parameters removed, constraints tightened); surviving a catalog upgrade by reverting the affected entries to defaults is strictly safer than rejecting the whole document — or worse, accepting values the new catalog can no longer guarantee.

### Versioning

`schemaVersion` is checked by the persistence layer: a document with a different major version is **removed** and the store starts fresh (a deliberate, logged-by-omission reset, not a mis-parse). Bump it when the document shape changes incompatibly.

## 5. Putting it together

```
catalog.json ──(frozen, read-only)──►  effective values = override ?? default
                                           ▲
user edits ──► app api ──► validateOverride ──► ToolConfigStore ──► subscribe events ──► re-render
                                                                                     │
                                                                persistence.save(toJSON())
                                                                                     │
                                                                              localStorage
```

Any layer can be swapped: inject a different `store` (e.g. hydrated from a profile patch) or a different `persistence` (e.g. an in-memory double) through `mountToolConfigStudio` options, and the UI is unchanged.
