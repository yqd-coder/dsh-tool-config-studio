/**
 * Tests for the System PluginStore (src/system/store.js) using a fake
 * settings adapter that records calls and returns canned envelopes.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  SettingsRemoteError,
  SystemPluginStore,
  pendingToOps,
  pathKey,
} from "../src/system/store.js";

/** A describe() result shaped exactly like the settings/describe remote. */
const DESCRIBE_RESULT = {
  ok: true,
  value: {
    writable: true,
    hasDocument: true,
    entries: [
      {
        ns: "agent-default-model",
        schema: { type: "object", dict: { provider: { type: "string" } } },
        value: { provider: "vllm" },
        base: { provider: "deepseek" },
        user: { provider: "vllm" },
        secrets: [],
        revision: 7,
      },
      {
        ns: "llm-pi-ai",
        schema: { type: "object", dict: { providers: { type: "dict", inner: { type: "object" } } } },
        value: { providers: {} },
        base: undefined,
        user: undefined,
        secrets: [],
        revision: 12,
      },
    ],
  },
};

/** Build a fake adapter with a mutable log and canned responses. */
function makeAdapter(overrides = {}) {
  const log = [];
  const adapter = {
    log,
    describe: async () => {
      log.push(["describe"]);
      return overrides.describe ? overrides.describe() : DESCRIBE_RESULT;
    },
    mutate: async (ns, ops, revision) => {
      log.push(["mutate", ns, ops, revision]);
      return overrides.mutate
        ? overrides.mutate(ns, ops, revision)
        : { ok: true, value: { ns, revision: (log.length) } };
    },
    replace: async (ns, section, revision) => {
      log.push(["replace", ns, section, revision]);
      return overrides.replace
        ? overrides.replace(ns, section, revision)
        : { ok: true, value: { ns, revision: 999 } };
    },
  };
  return adapter;
}

// --------------------------------------------------------------------- load

test("load: populates entries and flags from the describe envelope", async () => {
  const store = new SystemPluginStore(makeAdapter());
  await store.load();
  assert.equal(store.state.status, "ready");
  assert.equal(store.writable, true);
  assert.equal(store.state.hasDocument, true);
  assert.equal(store.entries().length, 2);
  assert.equal(store.entry("agent-default-model").revision, 7);
  assert.equal(store.entry("llm-pi-ai").revision, 12);
  assert.equal(store.entry("nope"), undefined);
});

test("load: a refused describe records an error state", async () => {
  const store = new SystemPluginStore(
    makeAdapter({ describe: async () => ({ ok: false, error: { code: "boom", message: "no settings" } }) }),
  );
  await store.load();
  assert.equal(store.state.status, "error");
  assert.match(store.state.error, /no settings/);
  assert.deepEqual(store.entries(), []);
});

test("load: a superseded stale load does not clobber a newer one", async () => {
  let firstResolve;
  const adapter = makeAdapter();
  const slowDescribe = new Promise((resolve) => {
    firstResolve = () => resolve(DESCRIBE_RESULT);
  });
  adapter.describe = async () => {
    adapter.log.push(["describe"]);
    if (adapter.log.filter((c) => c[0] === "describe").length === 1) return slowDescribe;
    return { ok: true, value: { writable: true, hasDocument: false, entries: [{ ns: "later", revision: 1 }] } };
  };
  const store = new SystemPluginStore(adapter);
  const first = store.load();
  const second = store.load();
  firstResolve();
  await first;
  await second;
  assert.equal(store.entries().length, 1);
  assert.notEqual(store.entry("later"), undefined); // the newer load won
  assert.equal(store.entry("agent-default-model"), undefined); // the stale load did not clobber
});

// --------------------------------------------------------------------- pending

test("stage/unstage: pending edits tracked per entry and per path", () => {
  const store = new SystemPluginStore(makeAdapter());
  store.stageSet("agent-default-model", ["provider"], "vllm");
  assert.equal(store.hasPending("agent-default-model"), true);
  assert.equal(store.hasPending("llm-pi-ai"), false);
  assert.equal(store.pendingFor("agent-default-model").length, 1);

  store.stageUnset("agent-default-model", ["model"]);
  assert.equal(store.pendingFor("agent-default-model").length, 2);

  store.unstage("agent-default-model", ["provider"]);
  assert.equal(store.pendingFor("agent-default-model").length, 1);

  store.clearPending("agent-default-model");
  assert.equal(store.hasPending("agent-default-model"), false);
});

test("stageSet overwrites an earlier stage for the same path", () => {
  const store = new SystemPluginStore(makeAdapter());
  store.stageSet("a", ["x"], 1);
  store.stageSet("a", ["x"], 2);
  assert.equal(store.pendingFor("a").length, 1);
  assert.deepEqual(pendingToOps(new Map([[pathKey(["x"]), store.pendingFor("a")[0]]])), [
    { op: "set", path: ["x"], value: 2 },
  ]);
});

test("pendingToOps: preserves order and distinguishes set/unset", () => {
  const pending = new Map([
    [pathKey(["a"]), { kind: "set", path: ["a"], value: 1 }],
    [pathKey(["b"]), { kind: "unset", path: ["b"] }],
  ]);
  assert.deepEqual(pendingToOps(pending), [
    { op: "set", path: ["a"], value: 1 },
    { op: "unset", path: ["b"] },
  ]);
  assert.deepEqual(pendingToOps(new Map()), []);
});

// --------------------------------------------------------------------- save

test("save: flushes pending ops with the entry's revision, then reloads", async () => {
  const adapter = makeAdapter();
  const store = new SystemPluginStore(adapter);
  await store.load();
  store.stageSet("agent-default-model", ["provider"], "newapi");
  await store.save("agent-default-model");

  const mutateCall = adapter.log.find((c) => c[0] === "mutate");
  assert.deepEqual(mutateCall, [
    "mutate",
    "agent-default-model",
    [{ op: "set", path: ["provider"], value: "newapi" }],
    7, // the revision read at load time
  ]);
  assert.equal(store.hasPending("agent-default-model"), false);
  // a trailing reload happened (describe called again)
  assert.ok(adapter.log.filter((c) => c[0] === "describe").length >= 2);
});

test("save: with no pending edits it is a no-op (no wire call)", async () => {
  const adapter = makeAdapter();
  const store = new SystemPluginStore(adapter);
  await store.load();
  await store.save("agent-default-model");
  assert.ok(!adapter.log.some((c) => c[0] === "mutate"));
});

test("save: a refused write resyncs and rethrows a SettingsRemoteError", async () => {
  const adapter = makeAdapter({
    mutate: async () => ({ ok: false, error: { code: "conflict", message: "stale revision" } }),
  });
  const store = new SystemPluginStore(adapter);
  await store.load();
  store.stageSet("agent-default-model", ["provider"], "x");
  await assert.rejects(
    () => store.save("agent-default-model"),
    (error) => error instanceof SettingsRemoteError && error.code === "conflict",
  );
  assert.equal(store.state.status, "ready"); // resynced (re-describe succeeded)
});

test("save: unknown entry throws without a wire call", async () => {
  const adapter = makeAdapter();
  const store = new SystemPluginStore(adapter);
  await store.load();
  store.stageSet("ghost", ["x"], 1);
  await assert.rejects(() => store.save("ghost"), SettingsRemoteError);
  assert.ok(!adapter.log.some((c) => c[0] === "mutate"));
});

// --------------------------------------------------------------------- restore

test("restoreAll: sends a replace with an empty section and the entry revision", async () => {
  const adapter = makeAdapter();
  const store = new SystemPluginStore(adapter);
  await store.load();
  await store.restoreAll("llm-pi-ai");
  const replaceCall = adapter.log.find((c) => c[0] === "replace");
  assert.deepEqual(replaceCall, ["replace", "llm-pi-ai", {}, 12]);
});

test("restoreAll: a refused replace resyncs and rethrows", async () => {
  const adapter = makeAdapter({
    replace: async () => ({ ok: false, error: { code: "conflict", message: "nope" } }),
  });
  const store = new SystemPluginStore(adapter);
  await store.load();
  await assert.rejects(() => store.restoreAll("llm-pi-ai"), SettingsRemoteError);
  assert.equal(store.state.status, "ready");
});

// --------------------------------------------------------------------- subscribe

test("subscribe: listeners fire on state changes and can unsubscribe", async () => {
  const adapter = makeAdapter();
  const store = new SystemPluginStore(adapter);
  const seen = [];
  const unsubscribe = store.subscribe((state) => seen.push(state.status));
  await store.load();
  assert.deepEqual(seen, ["loading", "ready"]);

  // Staging an edit is a state change too (the Save control must light up).
  store.stageSet("agent-default-model", ["provider"], "x");
  const lengthAfterStage = seen.length;
  assert.ok(lengthAfterStage > 2, "staging should emit");

  unsubscribe();
  store.stageSet("agent-default-model", ["model"], "y");
  assert.equal(seen.length, lengthAfterStage, "no emissions after unsubscribe");
});

test("constructor: requires an adapter with describe()", () => {
  assert.throws(() => new SystemPluginStore({}), /describe/);
  assert.throws(() => new SystemPluginStore(null), /describe/);
});
