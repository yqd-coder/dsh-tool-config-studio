/**
 * Contract test for the built DSH client bundle (`lib/client.js`).
 *
 * The bundle must:
 *   1. be a classic (non-ESM) script,
 *   2. register itself with `window.__ModuleLoader__` under the package id
 *      with a lazy `(require) => exports` factory,
 *   3. at materialization, inject its CSS via a tracked `data-plugin-css`
 *      style tag and expose `inject` + `apply(ctx)`,
 *   4. through a fake client context, register the sidebar panel and the
 *      main panel keyed `tool-config-studio`,
 *   5. actually mount the real UI — driven through the shared DOM stub and
 *      a minimal React stub the way the DSH shell would (render, attach the
 *      ref, flush mount effects, then tear down),
 *   6. stay re-applicable across module teardown — the fake locale service
 *      mirrors the host's non-idempotent `register` (it throws when the
 *      namespace already holds a locale and hands back the only disposer),
 *      so a plugin update re-running `apply` cannot collide with a stale
 *      registration.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "../build/client.mjs";
import { Element, Node, makeDocument } from "./dom-stub.js";
import { TOOL_COUNT } from "../src/core/catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE_PATH = path.join(root, "lib/client.js");
const PACKAGE_ID = "dsh-tool-config-studio";
const PANEL_ID = "tool-config-studio";

/** Build the bundle in-process (no child process) and return its source. */
function bundleSource() {
  build();
  return readFileSync(BUNDLE_PATH, "utf8");
}

/** Minimal React stub: function components, refs, and mount-time effects. */
function makeReact() {
  const pending = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useRef: (init) => ({ current: init }),
    useEffect: (fn) => {
      pending.push(fn);
    },
  };
  return { React, pending };
}

/** A sandbox with the browser globals the bundle may touch. */
function makeSandbox() {
  const registrations = [];
  const styleTags = [];
  const document = makeDocument();
  document.head = { appendChild: (el) => styleTags.push(el) };
  document.documentElement = { appendChild: (el) => styleTags.push(el) };
  const window = {
    __ModuleLoader__: { load: (reg) => registrations.push(reg) },
  };
  return {
    // Node is a browser global used by the app for instanceof checks.
    sandbox: { window, document, navigator: { language: "en-US" }, Node },
    registrations,
    styleTags,
  };
}

/**
 * Fake client context mirroring the host contract:
 *   - `locale.register` is NOT idempotent: it throws when the namespace
 *     already holds a locale, and returns the only disposer that removes
 *     the entry again (the host has no separate unregister API);
 *   - `ctx.effect(fn, label)` runs `fn` synchronously and calls whatever
 *     it returns when the effect is disposed (module teardown).
 */
/** A minimal volatile-settings snapshot for the system panel mount test. */
const SYSTEM_SETTINGS = {
  writable: true,
  hasDocument: true,
  entries: [
    {
      ns: "agent-default-model",
      schema: {
        type: "object",
        dict: {
          provider: { type: "string", meta: {} },
          model: { type: "string", meta: {} },
        },
      },
      value: { provider: "vllm", model: "qwen3.8:27b" },
      base: { provider: "deepseek", model: "deepseek-chat" },
      user: { provider: "vllm", model: "qwen3.8:27b" },
      secrets: [],
      revision: 3,
    },
  ],
};

function makeClientContext() {
  const localeStore = new Map(); // ns -> Map(locale -> entries)
  const state = { effects: [], slotInjects: [], registered: {} };
  const settingsCalls = [];
  const settingsView = () => SYSTEM_SETTINGS.entries[0];
  const ctx = {
    effect: (fn, label) => {
      const cleanup = fn();
      state.effects.push({ label, dispose: () => { if (typeof cleanup === "function") cleanup(); } });
    },
    locale: {
      register: (ns, dicts) => {
        let locales = localeStore.get(ns);
        if (!locales) { locales = new Map(); localeStore.set(ns, locales); }
        const keys = Object.keys(dicts);
        for (const locale of keys) {
          if (locales.has(locale)) throw new Error(`locale namespace "${ns}" already has locale "${locale}"`);
          locales.set(locale, dicts[locale]);
        }
        return () => {
          for (const locale of keys) {
            const owner = localeStore.get(ns);
            if (owner && owner.get(locale) === dicts[locale]) owner.delete(locale);
          }
        };
      },
      bind: (ns) => (key) => {
        const dict = localeStore.get(ns)?.get("en");
        return dict && Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key;
      },
    },
    slots: {
      inject: (slot, cb) => {
        state.slotInjects.push(slot);
        cb();
      },
      register: (meta, view) => {
        (state.registered[meta.name] ??= []).push({ meta, view });
        return { meta, view };
      },
    },
    remote: {
      settings: {
        describe: async () => { settingsCalls.push(["describe"]); return { ok: true, value: SYSTEM_SETTINGS }; },
        mutate: async (ns, ops, revision) => { settingsCalls.push(["mutate", ns, ops, revision]); return { ok: true, value: settingsView() }; },
        replace: async (ns, section, revision) => { settingsCalls.push(["replace", ns, section, revision]); return { ok: true, value: settingsView() }; },
      },
      $on: (event) => {
        settingsCalls.push(["$on", event]);
        return () => settingsCalls.push(["$on:disposed", event]);
      },
    },
  };
  return { ctx, state, localeStore, settingsCalls };
}

test("the build emits a classic (non-ESM) client bundle", () => {
  const code = bundleSource();
  assert.match(code, /window\.__ModuleLoader__\.load\(/);
  assert.doesNotMatch(code, /^\s*import\s/m, "no ES module import statements");
  assert.doesNotMatch(code, /^\s*export\s/m, "no ES module export statements");
});

test("the bundle registers one factory under the package id and nothing else", () => {
  const code = bundleSource();
  const { sandbox, registrations, styleTags } = makeSandbox();
  vm.runInNewContext(code, sandbox, { filename: "client.bundle.js" });

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].id, PACKAGE_ID);
  assert.equal(typeof registrations[0].factory, "function");
  // CSS injection is a materialization side effect, not a registration one.
  assert.equal(styleTags.length, 0);
});

test("materialization exports the DSH entry and apply registers the panels", () => {
  const code = bundleSource();
  const { sandbox, registrations, styleTags } = makeSandbox();
  vm.runInNewContext(code, sandbox, { filename: "client.bundle.js" });

  const { React, pending } = makeReact();
  const required = [];
  const hostRequire = (spec) => {
    required.push(spec);
    if (spec === "react") return React;
    throw new Error(`unexpected host require: ${spec}`);
  };

  const entry = registrations[0].factory(hostRequire);
  // Round-trip through JSON: the bundle runs in a separate vm realm, so its
  // arrays carry a foreign Array.prototype and deepStrictEqual would fail.
  assert.deepEqual(
    JSON.parse(JSON.stringify(entry.inject)),
    ["slots", "locale", "remote", "remote.settings"],
  );
  assert.equal(entry.PANEL_ID, PANEL_ID);
  assert.equal(entry.SYSTEM_PANEL_ID, "system-plugin-studio");
  assert.equal(typeof entry.apply, "function");
  // The bundle must only require seeded platform singletons.
  assert.ok(required.every((spec) => spec === "react"));

  // CSS was injected exactly once, tracked by the loader via data-plugin-css.
  assert.equal(styleTags.length, 1);
  assert.equal(styleTags[0].getAttribute("data-plugin-css"), PACKAGE_ID);
  assert.match(styleTags[0].textContent, /--tcs-bg/);

  // Fake client context mirroring the host's non-idempotent locale contract.
  const { ctx, state, localeStore } = makeClientContext();

  entry.apply(ctx);

  // Two sidebar rows and two main views, one per panel.
  assert.deepEqual(state.slotInjects, ["sidebar.panellist", "sidebar.panellist", "main", "main"]);

  const [sidebar, sidebarSys] = state.registered["sidebar.panellist"];
  assert.equal(sidebar.meta.id, PANEL_ID);
  assert.equal(sidebar.meta.order, 100);
  assert.equal(sidebar.meta.locale, PANEL_ID);
  assert.equal(sidebar.meta.label(), "Tool Config Studio");
  assert.equal(typeof sidebar.view, "function");
  assert.equal(sidebar.view().type, "svg");

  assert.equal(sidebarSys.meta.id, "system-plugin-studio");
  assert.equal(sidebarSys.meta.order, 200);
  assert.equal(sidebarSys.meta.label(), "System Plugin Studio");
  assert.equal(sidebarSys.view().type, "svg");

  const [main, mainSys] = state.registered["main"];
  assert.equal(main.meta.name, "main");
  assert.equal(main.meta.key, PANEL_ID);
  assert.equal(typeof main.view, "function");
  assert.equal(mainSys.meta.key, "system-plugin-studio");

  assert.equal(localeStore.size, 1);
  assert.equal(localeStore.get(PANEL_ID).get("en").panel, "Tool Config Studio");
  assert.equal(localeStore.get(PANEL_ID).get("zh").panel, "工具配置");
  assert.equal(localeStore.get(PANEL_ID).get("en").systemPanel, "System Plugin Studio");
  assert.equal(localeStore.get(PANEL_ID).get("zh").systemPanel, "系统插件");

  // The locale registration runs inside a tracked effect (disposable).
  assert.equal(state.effects.length, 1);
  assert.match(state.effects[0].label, /tool-config-studio/);

  // ---- Mount the main panel like the shell would ----
  globalThis.Node = Node;
  const container = new Element("div");
  const element = main.view();
  assert.equal(element.type, "div");
  assert.equal(element.props.className, "tcs-root");
  element.props.ref.current = container;

  const cleanups = [];
  for (const fn of pending.splice(0)) cleanups.push(fn());

  assert.ok(container.childElementCount > 0, "the page mounted the app");
  assert.ok(container.querySelector(".tcs-search"), "search input rendered");
  assert.equal(container.querySelectorAll(".tcs-tool").length, TOOL_COUNT);

  // Tear down: the effect cleanup unmounts the app completely.
  for (const cleanup of cleanups) if (typeof cleanup === "function") cleanup();
  assert.equal(container.children.length, 0);
});

/** Materialize the entry against a fresh sandbox + React stub. */
function materialize() {
  const code = bundleSource();
  const { sandbox, registrations } = makeSandbox();
  vm.runInNewContext(code, sandbox, { filename: "client.bundle.js" });
  const { React, pending } = makeReact();
  const hostRequire = (spec) => {
    if (spec !== "react") throw new Error(`unexpected host require: ${spec}`);
    return React;
  };
  return { entry: registrations[0].factory(hostRequire), pending };
}

test("apply is re-runnable: teardown releases the locale namespace", () => {
  const { entry } = materialize();
  const { ctx, state, localeStore } = makeClientContext();

  entry.apply(ctx);
  assert.equal(localeStore.get(PANEL_ID).size, 2);

  // The module record is torn down (plugin unload or an in-place update).
  for (const effect of state.effects) effect.dispose();
  assert.equal(localeStore.get(PANEL_ID).size, 0, "the register disposer released the namespace");

  // Re-materialization must not collide with the old registration.
  entry.apply(ctx);
  assert.equal(localeStore.get(PANEL_ID).get("en").panel, "Tool Config Studio");
});

test("apply tolerates a stale registration left by a disposer-less build", () => {
  const { entry } = materialize();
  const { ctx, localeStore } = makeClientContext();

  // An older generation of this plugin registered these dictionaries but
  // swallowed the disposer, so the namespace survived its teardown.
  ctx.locale.register(PANEL_ID, { en: { panel: "Tool Config Studio" }, zh: { panel: "工具配置" } });

  // The new apply must not fail the sync over the stale, identical entries.
  entry.apply(ctx);
  assert.equal(localeStore.get(PANEL_ID).get("en").panel, "Tool Config Studio");
  assert.equal(ctx.locale.bind(PANEL_ID)("panel"), "Tool Config Studio");
});

/** One macrotask tick: let the async describe/mutate chain drain. */
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("the system panel mounts against the settings remote and disposes on teardown", async () => {
  globalThis.Node = Node;
  const { entry, pending } = materialize();
  const { ctx, state, settingsCalls } = makeClientContext();
  entry.apply(ctx);

  const [, mainSys] = state.registered["main"];
  assert.equal(mainSys.meta.key, "system-plugin-studio");

  const container = new Element("div");
  const element = mainSys.view();
  assert.equal(element.type, "div");
  assert.equal(element.props.className, "sys-root");
  element.props.ref.current = container;

  const cleanups = [];
  for (const fn of pending.splice(0)) cleanups.push(fn());

  // The initial describe is async; let it land before asserting.
  await tick();

  assert.equal(settingsCalls.filter((c) => c[0] === "describe").length, 1);
  assert.equal(container.querySelectorAll(".sys-entry").length, SYSTEM_SETTINGS.entries.length);
  assert.ok(container.querySelector(".sys-entry"), "the volatile entry card rendered");

  // The pushed-refresh subscription was taken on the document-updated event.
  assert.ok(
    settingsCalls.some((c) => c[0] === "$on" && c[1] === "settings/document-updated"),
    "subscribed to settings/document-updated",
  );

  // Tear down: the page effect cleanup unmounts the app and disposes $on.
  for (const cleanup of cleanups) if (typeof cleanup === "function") cleanup();
  assert.equal(container.children.length, 0);
  assert.ok(settingsCalls.some((c) => c[0] === "$on:disposed"), "the pushed-refresh subscription was disposed");
});
