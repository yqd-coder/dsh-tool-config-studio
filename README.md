# DSH Tool Config Studio

English | [中文](README.zh.md)

A client-side plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) that turns the tool catalog into a settings surface: **browse every registered tool, expand any one of them to edit its configuration, and — when you've made a mistake — restore the defaults with a single click.**

```
┌──────────────────────────────────────────────────────────────────────┐
│  ⚙ Tool Config Studio                     [  search tools…  ]  [Restore all defaults] │
│  Edit stored defaults for every registered DSH tool.                 │
│                                                                      │
│  FILESYSTEM                                    6                     │
│  read    Read file        Read a UTF-8 text file…     [2 conf.] Enabled ▸
│  edit    Edit file        Edit an existing file…      [3 conf.] Enabled ▾
│          ┌─────────────────────────────────────────────────────────┐ │
│          │  ✓ Enabled   Edit an existing UTF-8 text file…         │ │
│          │  STORED DEFAULTS                                        │ │
│          │  replace_all  boolean   [✓] false                      │ │
│          │  reset        → reverts to the catalog default          │ │
│          │  PER-CALL ARGUMENTS (read-only)                         │ │
│          │  file_path   string   required per call                 │ │
│          │                                    [↺ Restore this tool] │
│          └─────────────────────────────────────────────────────────┘ │
│  …                                                                   │
│  1 tool, 1 parameter customized          v0.1.0        31 tools     │
└──────────────────────────────────────────────────────────────────────┘
```

## Why

Every DSH tool takes parameters, and a meaningful share of them have tunable, *stored* behavior: how far `read` goes by default, whether `pwsh` jobs run in the background, which scope `list_agents` starts from, how `job_output` waits, the minimum interval a schedule may tick, and so on. Before, the only way to discover or change those defaults was to dig through source or profile patches. Tool Config Studio gives each tool a proper settings page, and — more importantly — guarantees you can always undo a change.

## Features

- **Full tool catalog** — all 31 registered tools, grouped into 11 categories, each with a description and a complete parameter reference (type, required flag, default, enum values, minimums).
- **Stored-default editing** — expand any tool and change its configurable parameters: numbers with minimums, booleans, free strings, and enum selects.
- **Enable / disable** — toggle a tool on or off with a switch.
- **Inline validation** — every value is validated against the catalog (type, enum membership, minimum bounds) *before* it is stored. Invalid input never persists; the error is shown right next to the field.
- **Restore at every level** — reset a single parameter, restore one tool to factory state, or **Restore all defaults** (with confirmation). The store keeps only *deviations* from the catalog, so restoring is an exact inverse and can never lose anything else.
- **Persistent** — changes survive reloads via `localStorage` under `dsh-tool-config-studio.v1`; storage-less environments degrade to in-memory mode without errors.
- **i18n** — English and Simplified Chinese, auto-detected (`navigator.language`, or `LANG` under Node), overridable at mount time.
- **Zero dependencies** — plain ESM, no build step. Runs in any modern browser and on Node ≥ 22 (test suite, demo server).

## Quick start

### Try the demo (no DSH required)

```sh
git clone https://github.com/yqd-coder/dsh-tool-config-studio.git
cd dsh-tool-config-studio
npm run demo
# → http://localhost:4173/demo/
```

The demo imports the real plugin source, so it must be served over `http://` (ES import attributes are not available from `file://`). `npm run demo` starts the bundled zero-dependency static server; set `PORT` to change the port.

### Run the tests

```sh
npm test
```

The suite uses Node's built-in test runner (`node --test test/`) — no framework, no installation step. 37 tests cover catalog integrity, the store, validation, persistence, and an end-to-end UI smoke test.

### Embed in the DSH web client

```js
import { mountToolConfigStudio } from "dsh-tool-config-studio/client";

const handle = mountToolConfigStudio(document.getElementById("app"));
// ...
handle.unmount();
```

Options: `{ store, persistence, i18n, language }` — each is injectable for testing or custom hosts (see [docs/architecture.md](docs/architecture.md)).

### Install as a DSH plugin

The package follows the client-plugin conventions used by DSH's own web packages:

| File | Role |
| --- | --- |
| `lib/index.js` | Host loader entry (browser-only plugin → no-op `apply()`) |
| `lib/client.js` | Client entry exposing `mountToolConfigStudio` and the core API |
| `locale/{en,zh}.json` | UI string dictionaries |
| `package.json` | `dsh.client.platform: "web"`, entry-point `exports` map |

The tested, supported surfaces are the standalone demo and `mountToolConfigStudio`; profile-bundle installation depends on your DSH build's plugin pipeline.

## The configuration model, in 30 seconds

1. **The catalog** (`src/core/catalog.json`) is the single source of truth: every tool, parameter, type, default, enum, and minimum.
2. **The store keeps overrides only** — a value is stored only when it differs from the catalog default; the effective value is `override ?? default`.
3. **Restoring is deleting** — "reset", "restore tool", and "restore all" simply drop overrides, which is the exact inverse of editing.

The full specification — including the storage document format and the validation error codes — is in [docs/configuration-model.md](docs/configuration-model.md).

## Project layout

```
├── demo/            Standalone demo page + zero-dependency static server
├── docs/            architecture.md, configuration-model.md
├── lib/             Published entry shims (DSH loader convention)
├── locale/          en.json, zh.json UI dictionaries
├── src/
│   ├── client.js    Client entry: mountToolConfigStudio + full public API
│   ├── index.js     Host entry (browser-only → no-op)
│   ├── core/        catalog, store, validate, persistence — no DOM, pure logic
│   └── ui/          i18n, render (pure DOM builders), app (controller), styles.css
└── test/            node --test suites, incl. a DOM smoke test on a mini DOM stub
```

## API at a glance

| Export (from `/client`) | Purpose |
| --- | --- |
| `mountToolConfigStudio(container, options?)` | Mount the whole UI; returns `{ store, app, unmount }` |
| `ToolConfigStore` | The overrides-only state machine (`setParam`, `setEnabled`, `restoreTool`, `restoreAll`, `toJSON`, `fromJSON`, `subscribe`) |
| `createLocalPersistence(storage?, key?)` | localStorage-backed persistence with safe failure modes |
| `createI18n(language?)` / `detectLanguage()` | UI translation bundle / language detection |
| `createToolConfigApp({ root, store, i18n })` | The DOM controller, usable without `mountToolConfigStudio` |
| `validateParamValue(param, value)` / `validateOverride(tool, param, value)` | The validation predicates with stable error codes |
| `listTools()`, `listCategories()`, `getTool(name)`, `getParameter(tool, param)`, … | Catalog accessors |

Full JSDoc ships with the source (ESM, no build step — the source is the distribution).

## Documentation

- [docs/architecture.md](docs/architecture.md) — layering, data flow, and design decisions
- [docs/configuration-model.md](docs/configuration-model.md) — catalog schema, validation rules, storage format, versioning
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute (including "how to add a new tool to the catalog")
- [CHANGELOG.md](CHANGELOG.md) — release history

## License

[MIT](LICENSE) © yqd-coder
