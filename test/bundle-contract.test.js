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
 *      ref, flush mount effects, then tear down).
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
  assert.deepEqual(JSON.parse(JSON.stringify(entry.inject)), ["slots", "locale"]);
  assert.equal(entry.PANEL_ID, PANEL_ID);
  assert.equal(typeof entry.apply, "function");
  // The bundle must only require seeded platform singletons.
  assert.ok(required.every((spec) => spec === "react"));

  // CSS was injected exactly once, tracked by the loader via data-plugin-css.
  assert.equal(styleTags.length, 1);
  assert.equal(styleTags[0].getAttribute("data-plugin-css"), PACKAGE_ID);
  assert.match(styleTags[0].textContent, /--tcs-bg/);

  // Fake client context: record effects, locale dictionaries, and slots.
  const state = { effects: [], locale: [], slotInjects: [], registered: {} };
  const ctx = {
    effect: (fn, label) => {
      state.effects.push({ label, dispose: fn() });
    },
    locale: {
      register: (ns, dicts) => state.locale.push({ ns, dicts }),
      bind: (ns) => (key) => {
        const found = state.locale.find((e) => e.ns === ns);
        const dict = found && found.dicts.en;
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
  };

  entry.apply(ctx);

  assert.deepEqual(state.slotInjects, ["sidebar.panellist", "main"]);

  const [sidebar] = state.registered["sidebar.panellist"];
  assert.equal(sidebar.meta.id, PANEL_ID);
  assert.equal(sidebar.meta.order, 100);
  assert.equal(sidebar.meta.locale, PANEL_ID);
  assert.equal(sidebar.meta.label(), "Tool Config Studio");
  assert.equal(typeof sidebar.view, "function");
  assert.equal(sidebar.view().type, "svg");

  const [main] = state.registered["main"];
  assert.equal(main.meta.name, "main");
  assert.equal(main.meta.key, PANEL_ID);
  assert.equal(typeof main.view, "function");

  assert.equal(state.locale.length, 1);
  assert.equal(state.locale[0].ns, PANEL_ID);
  assert.equal(state.locale[0].dicts.en.panel, "Tool Config Studio");
  assert.equal(state.locale[0].dicts.zh.panel, "工具配置");

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
