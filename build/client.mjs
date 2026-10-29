/**
 * Build the DSH browser module bundle (`lib/client.js`).
 *
 * DSH's web boot protocol serves each client row's `./client` export as a
 * classic <script> that must register with the shell's module loader:
 *
 *   window.__ModuleLoader__.load({ id: "<package name>", factory })
 *
 * The factory is a lazy CJS closure — `(require) => exports` — whose body
 * runs once at materialization (first import by the Loader). `require` is
 * the synchronous module-table require seeded with platform singletons
 * such as `react`. All module-body side effects — including the CSS
 * injection the shell tracks via `data-plugin-css` — must live inside the
 * factory closure, not at script-execution time.
 *
 * This build is dependency-free and deterministic: it resolves the static
 * import graph of the shipped ESM sources, wraps each module in a CJS-style
 * scope, inlines the JSON data files and the stylesheet, composes the DSH
 * entry (sidebar panel + main panel over `mountToolConfigStudio`), and
 * emits one classic script. The sources stay ESM — `node --test` runs them
 * directly; the built file is committed, the same way the official DSH
 * packages ship their prebuilt `lib/`.
 *
 * Supported ESM forms (the build fails fast on anything else, which keeps
 * the source simple):
 *
 *   import { a, b } from "./x.js";
 *   import name from "./y.json" with { type: "json" };
 *   export function f() {}    export const x = ...    export class C ...
 *   export * from "./x.js";
 *   export { a, b } from "./x.js";
 *
 * Usage:  node build/client.mjs        (or `npm run build`)
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const PACKAGE = packageJson.name;
const VERSION = packageJson.version;
const ENTRY = "src/client.js";

/**
 * Resolve a relative import specifier against the importer's module id.
 * Both are posix paths relative to the package root.
 */
function resolveId(fromId, spec) {
  if (!spec.startsWith("./") && !spec.startsWith("../")) {
    throw new Error(`${fromId}: bare imports are not supported in the client bundle (got "${spec}")`);
  }
  const id = path.posix.normalize(path.posix.join(path.posix.dirname(fromId), spec));
  if (id.startsWith("..")) {
    throw new Error(`${fromId}: import escapes the package root (got "${spec}")`);
  }
  return id;
}

/** Collect the static import graph from the entry, in deterministic BFS order. */
function collectModules() {
  const graph = new Map(); // id -> [dep ids in source order]
  const queue = [ENTRY];
  const order = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (graph.has(id)) continue;
    const file = path.join(root, ...id.split("/"));
    const source = readFileSync(file, "utf8");
    const deps = [];
    for (const match of source.matchAll(/^import\s+(?:\{[^}]*\}|[A-Za-z_$][\w$]*)\s+from\s+"([^"]+)"[^;]*;$/gm)) {
      const dep = resolveId(id, match[1]);
      deps.push(dep);
      if (!graph.has(dep) && !queue.includes(dep)) queue.push(dep);
    }
    graph.set(id, { source, deps });
    order.push(id);
  }
  return { graph, order };
}

/**
 * Transform one ESM source file into the body of a CJS-style module
 * function: `(module, __exports, __req, require) => void`.
 *
 * Export assignments are collected and emitted at the end of the module
 * body (not right after each declaration), so a multi-line `export
 * function f() {` keeps its assignment at module level, outside the body.
 */
function transform(id, source) {
  const out = [];
  const exported = [];
  const declared = new Set();
  for (const [index, line] of source.split("\n").entries()) {
    let m;
    if ((m = line.match(/^import\s+\{([^}]+)\}\s+from\s+"([^"]+)"\s*;\s*$/))) {
      const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
      for (const name of names) declared.add(name);
      out.push(`const { ${names.join(", ")} } = __req("${resolveId(id, m[2])}");`);
    } else if ((m = line.match(/^import\s+([A-Za-z_$][\w$]*)\s+from\s+"([^"]+)"\s+with\s*\{\s*type:\s*"json"\s*\}\s*;\s*$/))) {
      declared.add(m[1]);
      out.push(`const ${m[1]} = __req("${resolveId(id, m[2])}").default;`);
    } else if ((m = line.match(/^export\s+function\s+([A-Za-z_$][\w$]*)/))) {
      out.push(line.replace(/^export\s+function/, "function"));
      exported.push(m[1]);
    } else if ((m = line.match(/^export\s+const\s+([A-Za-z_$][\w$]*)\s*=/))) {
      out.push(line.replace(/^export\s+const/, "const"));
      exported.push(m[1]);
    } else if ((m = line.match(/^export\s+class\s+([A-Za-z_$][\w$]*)/))) {
      out.push(line.replace(/^export\s+class/, "class"));
      exported.push(m[1]);
    } else if ((m = line.match(/^export\s+\*\s+from\s+"([^"]+)"\s*;\s*$/))) {
      out.push(`Object.assign(__exports, __req("${resolveId(id, m[1])}"));`);
    } else if ((m = line.match(/^export\s+\{([^}]+)\}\s+from\s+"([^"]+)"\s*;\s*$/))) {
      const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
      // A name imported earlier in this module must not be re-declared.
      const fresh = names.filter((name) => !declared.has(name));
      if (fresh.length > 0) out.push(`const { ${fresh.join(", ")} } = __req("${resolveId(id, m[2])}");`);
      for (const name of names) {
        declared.add(name);
        out.push(`__exports.${name} = ${name};`);
      }
    } else if (/^\s*(import|export)\b/.test(line)) {
      throw new Error(`${id}:${index + 1}: unsupported ESM form in the client bundle: ${line.trim()}`);
    } else {
      out.push(line);
    }
  }
  for (const name of exported) out.push(`__exports.${name} = ${name};`);
  return out;
}

/** The DSH entry: two sidebar panels + two main panels. */
const ENTRY_SOURCE = `
  "use strict";
  var React = require("react");
  var client = __req("src/client.js");

  var PANEL_ID = "tool-config-studio";
  var SYS_PANEL_ID = "system-plugin-studio";
  var NS = "tool-config-studio";

  /** Sidebar icon: a settings gear (Feather-style 24px grid). */
  var PanelIcon = function PanelIcon() {
    return React.createElement("svg", {
      width: 20, height: 20, viewBox: "0 0 24 24", fill: "none",
      stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round",
      strokeLinejoin: "round", "aria-hidden": true
    },
      React.createElement("circle", { cx: 12, cy: 12, r: 3 }),
      React.createElement("path", { d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" })
    );
  };

  /**
   * Main panel: mounts the framework-free Tool Config Studio app into a
   * ref div; the host locale drives the sidebar label while the page
   * content uses the plugin's own dictionaries.
   */
  var ToolConfigStudioPage = function ToolConfigStudioPage() {
    var ref = React.useRef(null);
    React.useEffect(function () {
      if (!ref.current) return;
      var handle = client.mountToolConfigStudio(ref.current, {});
      return function () { handle.unmount(); };
    }, []);
    return React.createElement("div", { ref: ref, className: "tcs-root" });
  };

  /**
   * Sidebar icon for the System Plugin Studio: sliders (Feather-style 24px
   * grid) — distinct from the Tool Config Studio's gear.
   */
  var SystemIcon = function SystemIcon() {
    return React.createElement("svg", {
      width: 20, height: 20, viewBox: "0 0 24 24", fill: "none",
      stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round",
      strokeLinejoin: "round", "aria-hidden": true
    },
      React.createElement("line", { x1: "4", y1: "21", x2: "4", y2: "14" }),
      React.createElement("line", { x1: "4", y1: "10", x2: "4", y2: "3" }),
      React.createElement("line", { x1: "12", y1: "21", x2: "12", y2: "12" }),
      React.createElement("line", { x1: "12", y1: "8", x2: "12", y2: "3" }),
      React.createElement("line", { x1: "20", y1: "21", x2: "20", y2: "16" }),
      React.createElement("line", { x1: "20", y1: "12", x2: "20", y2: "3" }),
      React.createElement("line", { x1: "1", y1: "14", x2: "7", y2: "14" }),
      React.createElement("line", { x1: "9", y1: "8", x2: "15", y2: "8" }),
      React.createElement("line", { x1: "17", y1: "16", x2: "23", y2: "16" })
    );
  };

  /*
   * Adapter over the remote.settings service (the wire surface of the
   * dsh-settings Host service). Every call resolves to an envelope of the
   * shape { ok, value?, error? }, which the store unwraps.
   * onDocumentUpdated returns the remote subscription disposer, so the app
   * can tear it down with the page.
   * (No backticks in this comment: the entry source is a template literal.)
   */
  var makeSettingsAdapter = function makeSettingsAdapter(ctx) {
    var settings = ctx.remote.settings;
    return {
      describe: function () { return settings.describe(); },
      mutate: function (ns, ops, revision) { return settings.mutate(ns, ops, revision); },
      replace: function (ns, section, revision) { return settings.replace(ns, section, revision); },
      onDocumentUpdated: function (cb) { return ctx.remote.$on("settings/document-updated", cb); }
    };
  };

  /**
   * Main panel: mounts the framework-free System Plugin Studio app into a ref
   * div. The page closes over ctx to build the settings adapter; the host
   * locale drives the sidebar label while the page content uses the plugin's
   * own dictionaries.
   */
  var makeSystemPluginStudioPage = function makeSystemPluginStudioPage(ctx) {
    return function SystemPluginStudioPage() {
      var ref = React.useRef(null);
      React.useEffect(function () {
        if (!ref.current) return;
        var adapter = makeSettingsAdapter(ctx);
        var handle = client.mountSystemPluginStudio(ref.current, { adapter: adapter });
        return function () { handle.unmount(); };
      }, []);
      return React.createElement("div", { ref: ref, className: "sys-root" });
    };
  };

  /** Services the row fiber must have before apply runs. */
  __exports.inject = ["slots", "locale", "remote", "remote.settings"];
  __exports.PANEL_ID = PANEL_ID;
  __exports.SYSTEM_PANEL_ID = SYS_PANEL_ID;

  /**
   * DSH client entry: register the sidebar panel and the main panel.
   * @param ctx - client root context (slots, locale, effect).
   */
  __exports.apply = function apply(ctx) {
    // The host removes locale entries only through the disposer that
    // register returns, and ctx.effect calls the effect's return value on
    // module teardown — so the disposer must be returned, which is also
    // what makes an update re-materialize cleanly. Both panels' labels live
    // in this one namespace (re-registering an existing namespace throws,
    // so the two keys must share a single register call).
    ctx.effect(function () {
      try {
        return ctx.locale.register(NS, {
          en: { panel: "Tool Config Studio", systemPanel: "System Plugin Studio" },
          zh: { panel: "工具配置", systemPanel: "系统插件" }
        });
      } catch (error) {
        // One-time migration: a pre-v0.2.2 generation of this plugin did
        // not return the disposer, so its namespace survived until a full
        // shell reload. The stale dictionary still carries the panel key, so
        // the first label stays correct; the newer systemPanel key falls back
        // to the raw key only until the namespace is re-registered.
        if (!/already has locale/.test(String(error))) throw error;
        return null;
      }
    }, "tool-config-studio: dictionaries");
    var t = ctx.locale.bind(NS);

    ctx.slots.inject("sidebar.panellist", function () {
      return ctx.slots.register({
        name: "sidebar.panellist",
        id: PANEL_ID,
        order: 100,
        label: function () { return t("panel"); },
        locale: NS
      }, PanelIcon);
    });

    ctx.slots.inject("sidebar.panellist", function () {
      return ctx.slots.register({
        name: "sidebar.panellist",
        id: SYS_PANEL_ID,
        order: 200,
        label: function () { return t("systemPanel"); },
        locale: NS
      }, SystemIcon);
    });

    ctx.slots.inject("main", function () {
      return ctx.slots.register({
        name: "main",
        key: PANEL_ID,
        locale: NS
      }, ToolConfigStudioPage);
    });

    ctx.slots.inject("main", function () {
      return ctx.slots.register({
        name: "main",
        key: SYS_PANEL_ID,
        locale: NS
      }, makeSystemPluginStudioPage(ctx));
    });
  };
`;

/** Compose the emitted classic script. */
function renderBundle({ graph, order }) {
  const css = readFileSync(path.join(root, "src/ui/styles.css"), "utf8");
  const lines = [];
  lines.push(`/* ${PACKAGE} v${VERSION} — DSH client module bundle (browser classic script).`);
  lines.push(`   Generated by build/client.mjs from the ESM sources under src/ and locale/.`);
  lines.push(`   Registered as ${JSON.stringify(PACKAGE)} through window.__ModuleLoader__;`);
  lines.push(`   do not edit by hand — run \`npm run build\` after changing sources. */`);
  lines.push(`(function () {`);
  lines.push(`  "use strict";`);
  lines.push(`  var PACKAGE_ID = ${JSON.stringify(PACKAGE)};`);
  lines.push(`  if (typeof window === "undefined" || !window.__ModuleLoader__) {`);
  lines.push(`    throw new Error("dsh-tool-config-studio: the client bundle runs inside the DSH web shell only");`);
  lines.push(`  }`);
  lines.push(`  var __modules = {};`);
  lines.push(`  var __cache = {};`);
  lines.push(`  function __req(id, require) {`);
  lines.push(`    if (Object.prototype.hasOwnProperty.call(__cache, id)) return __cache[id].exports;`);
  lines.push(`    var module = (__cache[id] = { exports: {} });`);
  lines.push(`    var localReq = function (dep) { return __req(dep, require); };`);
  lines.push(`    __modules[id](module, module.exports, localReq, require);`);
  lines.push(`    return module.exports;`);
  lines.push(`  }`);

  for (const id of order) {
    const { source } = graph.get(id);
    if (id.endsWith(".json")) {
      const data = JSON.parse(source);
      lines.push(`  __modules[${JSON.stringify(id)}] = function (module, __exports) {`);
      lines.push(`    "use strict";`);
      lines.push(`    __exports.default = ${JSON.stringify(data)};`);
      lines.push(`  };`);
    } else {
      lines.push(`  __modules[${JSON.stringify(id)}] = function (module, __exports, __req, require) {`);
      for (const line of transform(id, source)) {
        lines.push(line.trim() === "" ? "    " : `    ${line}`);
      }
      lines.push(`  };`);
    }
  }

  lines.push(`  __modules[${JSON.stringify(ENTRY + ":entry")}] = function (module, __exports, __req, require) {`);
  for (const line of ENTRY_SOURCE.split("\n")) {
    lines.push(line.trim() === "" ? "  " : `  ${line}`);
  }
  lines.push(`  };`);
  lines.push(``);
  lines.push(`  window.__ModuleLoader__.load({`);
  lines.push(`    id: PACKAGE_ID,`);
  lines.push(`    factory: function (require) {`);
  lines.push(`      // Materialization side effect: inject the tracked plugin CSS.`);
  lines.push(`      var __style = document.createElement("style");`);
  lines.push(`      __style.setAttribute("data-plugin-css", PACKAGE_ID);`);
  lines.push(`      __style.textContent = ${JSON.stringify(css)};`);
  lines.push(`      (document.head || document.documentElement).appendChild(__style);`);
  lines.push(`      return __req(${JSON.stringify(ENTRY + ":entry")}, require);`);
  lines.push(`    }`);
  lines.push(`  });`);
  lines.push(`})();`);
  return `${lines.join("\n")}\n`;
}

/**
 * Build lib/client.js and return its absolute path.
 * Deterministic: identical sources always produce identical bytes.
 */
export function build() {
  const { graph, order } = collectModules();
  const bundle = renderBundle({ graph, order });
  const out = path.join(root, "lib/client.js");
  writeFileSync(out, bundle, "utf8");
  return out;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const out = build();
  console.log(`built ${path.relative(root, out)}`);
}
