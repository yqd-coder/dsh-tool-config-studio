/**
 * DOM smoke test for the System Plugin Studio app (src/system/app.js).
 *
 * Installs the shared in-memory DOM stub, then drives
 * `mountSystemPluginStudio` the way the DSH shell would: mount against a fake
 * settings adapter, expand an entry, edit values, stage/flush saves, restore
 * to defaults, and tear down (verifying the pushed-refresh subscription is
 * disposed with the page).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Element, Node, makeDocument } from "./dom-stub.js";

// ------------------------------------------------------------ DOM stub

globalThis.Node = Node;
globalThis.document = makeDocument();
// window.confirm/prompt stubbed so restore/remove/add do not block.
globalThis.window = { confirm: () => true, prompt: () => "added-key" };

const { mountSystemPluginStudio } = await import("../src/system/app.js");

/** One tick: let the pending microtask chain (describe/mutate/load) drain. */
const tick = () => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------- fixtures

const AGENT_SCHEMA = {
  type: "object",
  dict: {
    provider: { type: "string", meta: { required: true } },
    model: { type: "string", meta: { required: true } },
    reasoningEffort: {
      type: "union",
      list: [
        { type: "literal", value: "off" },
        { type: "literal", value: "low" },
        { type: "literal", value: "high" },
      ],
    },
  },
};

const PI_AI_SCHEMA = {
  type: "object",
  dict: {
    providers: {
      type: "dict",
      inner: {
        type: "object",
        dict: {
          displayName: { type: "string", meta: {} },
          baseURL: { type: "string", meta: {} },
          models: {
            type: "array",
            inner: {
              type: "object",
              dict: {
                id: { type: "string", meta: {} },
                contextWindow: { type: "number", meta: {} },
              },
            },
          },
        },
      },
    },
  },
};

/**
 * A fake settings adapter shaped like the wire envelopes, with a log of
 * write calls and mutable entries so saves are observable.
 */
function makeAdapter() {
  const log = [];
  const state = {
    writable: true,
    hasDocument: true,
    entries: [
      {
        ns: "agent-default-model",
        schema: AGENT_SCHEMA,
        value: { provider: "vllm", model: "qwen3.8:27b", reasoningEffort: "high" },
        base: { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "low" },
        user: { provider: "vllm", model: "qwen3.8:27b", reasoningEffort: "high" },
        secrets: [],
        revision: 7,
      },
      {
        ns: "llm-pi-ai",
        schema: PI_AI_SCHEMA,
        value: {
          providers: {
            vllm: {
              displayName: "vllm",
              baseURL: "http://10.2.65.250:3000/v1",
              models: [{ id: "qwen3.8:27b", contextWindow: 256000 }],
            },
          },
        },
        base: undefined,
        user: undefined,
        secrets: [],
        revision: 12,
      },
    ],
  };
  const adapter = {
    log,
    state,
    onDocumentUpdated: (cb) => {
      log.push(["onDocumentUpdated"]);
      return () => log.push(["onDocumentUpdated-dispose"]);
    },
    describe: async () => {
      log.push(["describe"]);
      return { ok: true, value: state };
    },
    mutate: async (ns, ops, revision) => {
      log.push(["mutate", ns, ops, revision]);
      return { ok: true, value: state.entries.find((entry) => entry.ns === ns) };
    },
    replace: async (ns, section, revision) => {
      log.push(["replace", ns, section, revision]);
      const entry = state.entries.find((e) => e.ns === ns);
      entry.user = undefined;
      entry.value = JSON.parse(JSON.stringify(entry.base ?? entry.value));
      return { ok: true, value: entry };
    },
  };
  return adapter;
}

/** Mount a fresh system panel; resolves after the initial describe lands. */
async function mountFresh() {
  const adapter = makeAdapter();
  const host = new Element("main");
  const handle = mountSystemPluginStudio(host, { adapter, language: "en" });
  await tick();
  return { host, handle, adapter, root: host.children[0] };
}

function entryCard(root, ns) {
  return root.querySelectorAll(".sys-entry").find((card) => card.getAttribute("data-ns") === ns) ?? null;
}

/** Expand an entry by clicking its head. */
function expand(root, ns) {
  const head = entryCard(root, ns).querySelector(".sys-entry-head");
  head.dispatch("click");
  return root;
}

function leafInput(root, ns, pathSegments) {
  const card = entryCard(root, ns);
  const leaf = card
    .querySelectorAll(".sys-leaf")
    .find((row) => row.getAttribute("data-path") === pathSegments.join("."));
  return leaf.querySelector(".sys-input");
}

/** Find the action-row button whose className is EXACTLY `className`. */
function actionButton(root, ns, className) {
  const actions = entryCard(root, ns).querySelector(".sys-actions");
  return actions.querySelectorAll(".sys-btn").find((btn) => btn.className === className) ?? null;
}

// ---------------------------------------------------------------- tests

test("mount renders the entry list with badges after the initial describe", async () => {
  const { host, handle, root, adapter } = await mountFresh();
  assert.equal(adapter.log.filter((c) => c[0] === "describe").length, 1);
  assert.equal(root.querySelectorAll(".sys-entry").length, 2);
  // agent-default-model carries a profile override → modified badge.
  const agent = entryCard(root, "agent-default-model");
  assert.ok(agent.querySelector(".sys-badge"), "modified badge shown");
  assert.ok(!entryCard(root, "llm-pi-ai").querySelector(".sys-badge"), "unmodified entry has no badge");
  handle.unmount();
  assert.equal(host.children.length, 0, "unmount empties the host");
});

test("expanding an entry renders its schema-driven form", async () => {
  const { handle, root } = await mountFresh();
  assert.equal(entryCard(root, "agent-default-model").querySelector(".sys-group"), null);
  expand(root, "agent-default-model");
  const card = entryCard(root, "agent-default-model");
  assert.ok(card.querySelector(".sys-group"), "form group rendered");
  const provider = leafInput(root, "agent-default-model", ["provider"]);
  assert.equal(provider.value, "vllm");
  const effort = leafInput(root, "agent-default-model", ["reasoningEffort"]);
  assert.equal(effort.tagName, "SELECT", "enum renders as a select");
  // The provider's system default is shown as a hint.
  assert.match(card.querySelector(".sys-leaf-hint")?.textContent ?? "", /default:/);
  handle.unmount();
});

test("editing a field stages a change and lights up Save", async () => {
  const { handle, root, adapter } = await mountFresh();
  expand(root, "agent-default-model");
  const input = leafInput(root, "agent-default-model", ["provider"]);
  input.value = "newapi";
  input.dispatch("input", { target: input });

  assert.equal(handle.store.hasPending("agent-default-model"), true);
  const save = actionButton(root, "agent-default-model", "sys-btn sys-btn-primary");
  assert.equal(save.disabled, false, "Save enabled with pending edits");

  // Flushing the save writes a set op with the revision read at load time.
  save.dispatch("click");
  await tick();
  const mutate = adapter.log.find((c) => c[0] === "mutate");
  assert.deepEqual(mutate, [
    "mutate",
    "agent-default-model",
    [{ op: "set", path: ["provider"], value: "newapi" }],
    7,
  ]);
  handle.unmount();
});

test("invalid number input shows an inline error and stages nothing", async () => {
  const { handle, root } = await mountFresh();
  expand(root, "llm-pi-ai");
  const input = leafInput(root, "llm-pi-ai", ["providers", "vllm", "models", "0", "contextWindow"]);
  assert.equal(input.tagName, "INPUT");
  input.value = "not-a-number";
  input.dispatch("input", { target: input });
  assert.equal(handle.store.hasPending("llm-pi-ai"), false, "nothing staged");
  const leaf = entryCard(root, "llm-pi-ai")
    .querySelectorAll(".sys-leaf")
    .find((row) => row.getAttribute("data-path") === "providers.vllm.models.0.contextWindow");
  assert.ok(leaf.querySelector(".sys-leaf-error"), "inline error rendered");
  handle.unmount();
});

test("resetting a field stages an unset op (restore-to-default semantics)", async () => {
  const { handle, root, adapter } = await mountFresh();
  expand(root, "agent-default-model");
  const leaf = entryCard(root, "agent-default-model")
    .querySelectorAll(".sys-leaf")
    .find((row) => row.getAttribute("data-path") === "model");
  const reset = leaf.querySelectorAll(".sys-btn").find((btn) => btn.matchesClass("sys-btn-sm"));
  reset.dispatch("click");
  assert.equal(handle.store.hasPending("agent-default-model"), true);
  const pending = handle.store.pendingFor("agent-default-model");
  assert.deepEqual(pending, [{ kind: "unset", path: ["model"] }]);
  handle.unmount();
});

test("restore-to-defaults sends a replace with an empty section", async () => {
  const { handle, root, adapter } = await mountFresh();
  expand(root, "agent-default-model");
  const restore = actionButton(root, "agent-default-model", "sys-btn sys-btn-danger");
  restore.dispatch("click");
  await tick();
  const replace = adapter.log.find((c) => c[0] === "replace");
  assert.deepEqual(replace, ["replace", "agent-default-model", {}, 7]);
  handle.unmount();
});

test("discarding clears pending edits", async () => {
  const { handle, root } = await mountFresh();
  expand(root, "agent-default-model");
  const input = leafInput(root, "agent-default-model", ["provider"]);
  input.value = "zzz";
  input.dispatch("input", { target: input });
  assert.equal(handle.store.hasPending("agent-default-model"), true);
  const discard = actionButton(root, "agent-default-model", "sys-btn");
  discard.dispatch("click");
  assert.equal(handle.store.hasPending("agent-default-model"), false);
  handle.unmount();
});

test("the pushed-refresh subscription is disposed on unmount", async () => {
  const { handle, adapter } = await mountFresh();
  assert.deepEqual(adapter.log.filter((c) => c[0] === "onDocumentUpdated"), [["onDocumentUpdated"]]);
  handle.unmount();
  assert.ok(adapter.log.some((c) => c[0] === "onDocumentUpdated-dispose"), "the pushed-refresh disposer ran");
});

test("a failed save surfaces a banner and keeps the state consistent", async () => {
  const adapter = makeAdapter();
  adapter.mutate = async () => ({ ok: false, error: { code: "conflict", message: "stale revision" } });
  const host = new Element("main");
  const handle = mountSystemPluginStudio(host, { adapter, language: "en" });
  await tick();
  const root = host.children[0];
  expand(root, "agent-default-model");
  const input = leafInput(root, "agent-default-model", ["provider"]);
  input.value = "x";
  input.dispatch("input", { target: input });
  actionButton(root, "agent-default-model", "sys-btn sys-btn-primary").dispatch("click");
  await tick();
  assert.ok(entryCard(root, "agent-default-model").querySelector(".sys-banner-error"), "error banner shown");
  handle.unmount();
});
