/**
 * ToolConfigStore behavior tests: defaults, overrides, restore,
 * serialization, and change events.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ToolConfigStore, SCHEMA_VERSION } from "../src/core/store.js";
import { ConfigValidationError } from "../src/core/validate.js";
import { listTools } from "../src/core/catalog.js";

test("fresh store: every tool sits at its catalog defaults", () => {
  const store = new ToolConfigStore();
  for (const tool of listTools()) {
    assert.equal(store.isEnabled(tool.name), tool.enabledByDefault, tool.name);
    assert.equal(store.hasEnabledOverride(tool.name), false);
    assert.equal(store.isModified(tool.name), false, tool.name);
    for (const param of tool.parameters) {
      assert.equal(store.effectiveParam(tool.name, param.name), param.default, `${tool.name}.${param.name}`);
      assert.equal(store.hasParamOverride(tool.name, param.name), false);
    }
  }
  assert.deepEqual(store.modifiedSummary(), { tools: 0, params: 0 });
  assert.equal(store.overrideCount(), 0);
  assert.deepEqual(store.modifiedTools(), []);
  assert.deepEqual(store.toJSON(), { schemaVersion: SCHEMA_VERSION, tools: {} });
});

test("setParam stores an override and reports modification", () => {
  const store = new ToolConfigStore();
  store.setParam("read", "limit", 500);

  assert.equal(store.effectiveParam("read", "limit"), 500);
  assert.equal(store.hasParamOverride("read", "limit"), true);
  assert.equal(store.isModified("read"), true);
  assert.deepEqual(store.modifiedSummary(), { tools: 1, params: 1 });
  assert.deepEqual(store.modifiedTools(), ["read"]);

  // Storing the catalog default again clears the override.
  store.setParam("read", "limit", 2000);
  assert.equal(store.hasParamOverride("read", "limit"), false);
  assert.equal(store.isModified("read"), false);
  assert.equal(store.effectiveParam("read", "limit"), 2000);
});

test("setParam with null clears the override (back to unset)", () => {
  const store = new ToolConfigStore();
  store.setParam("pwsh", "timeoutMs", 60000);
  assert.equal(store.effectiveParam("pwsh", "timeoutMs"), 60000);

  store.setParam("pwsh", "timeoutMs", null);
  assert.equal(store.hasParamOverride("pwsh", "timeoutMs"), false);
  assert.equal(store.effectiveParam("pwsh", "timeoutMs"), null);
  assert.equal(store.isModified("pwsh"), false);

  // Clearing again is a no-op.
  store.clearParam("pwsh", "timeoutMs");
  assert.equal(store.overrideCount(), 0);
});

test("setEnabled stores both directions of the default", () => {
  const store = new ToolConfigStore();
  const enabledByDefault = listTools().find((tool) => tool.enabledByDefault === true);

  // Disable a tool that is enabled by default.
  store.setEnabled(enabledByDefault.name, false);
  assert.equal(store.isEnabled(enabledByDefault.name), false);
  assert.equal(store.hasEnabledOverride(enabledByDefault.name), true);
  assert.equal(store.isModified(enabledByDefault.name), true);

  // Re-enabling restores the default and drops the override.
  store.setEnabled(enabledByDefault.name, true);
  assert.equal(store.isEnabled(enabledByDefault.name), true);
  assert.equal(store.hasEnabledOverride(enabledByDefault.name), false);
  assert.equal(store.isModified(enabledByDefault.name), false);
});

test("writes are validated before they can corrupt state", () => {
  const store = new ToolConfigStore();
  assert.throws(() => store.setParam("read", "limit", "500"), ConfigValidationError); // type
  assert.throws(() => store.setParam("read", "limit", 0), ConfigValidationError); // below min
  assert.throws(() => store.setParam("list_agents", "scope", "sides"), ConfigValidationError); // enum
  assert.throws(() => store.setParam("read", "file_path", "x"), ConfigValidationError); // not configurable
  assert.throws(() => store.setParam("not-a-tool", "x", 1), ConfigValidationError); // unknown tool
  assert.throws(() => store.setEnabled("not-a-tool", true), ConfigValidationError); // unknown tool
  assert.throws(() => store.setEnabled("read", "yes"), ConfigValidationError); // non-boolean

  // Nothing was stored.
  assert.equal(store.overrideCount(), 0);
});

test("restoreTool returns one tool to factory state", () => {
  const store = new ToolConfigStore();
  store.setParam("read", "limit", 100);
  store.setParam("read", "offset", 10);
  store.setEnabled("grep", false);
  store.setParam("edit", "replace_all", true);

  store.restoreTool("read");
  assert.equal(store.isModified("read"), false);
  assert.equal(store.effectiveParam("read", "limit"), 2000);
  assert.equal(store.effectiveParam("read", "offset"), 1);
  assert.equal(store.isModified("grep"), true);
  assert.equal(store.isModified("edit"), true);

  store.restoreAll();
  assert.equal(store.overrideCount(), 0);
  assert.deepEqual(store.modifiedSummary(), { tools: 0, params: 0 });
});

test("restoreTool edge cases", () => {
  const store = new ToolConfigStore();
  store.restoreTool("read"); // unmodified: no-op
  assert.equal(store.overrideCount(), 0);
  assert.throws(() => store.restoreTool("not-a-tool"), ConfigValidationError);
});

test("JSON round trip preserves overrides exactly", () => {
  const store = new ToolConfigStore();
  store.setParam("read", "limit", 500);
  store.setEnabled("grep", false);
  store.setParam("list_agents", "scope", "descendants");

  const json = store.toJSON();
  assert.equal(json.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(Object.keys(json.tools).sort(), ["grep", "list_agents", "read"]);
  assert.equal(json.tools.grep.enabled, false);

  const restored = ToolConfigStore.fromJSON(JSON.parse(JSON.stringify(json)));
  assert.equal(restored.effectiveParam("read", "limit"), 500);
  assert.equal(restored.isEnabled("grep"), false);
  assert.equal(restored.effectiveParam("list_agents", "scope"), "descendants");
  assert.deepEqual(restored.toJSON(), json);
});

test("fromJSON skips stale tools, stale params, and invalid values", () => {
  const store = ToolConfigStore.fromJSON({
    schemaVersion: 1,
    tools: {
      retired_tool: { params: { x: 1 } }, // tool no longer in the catalog
      read: { params: { limit: "not-a-number" } }, // value no longer validates
      grep: { params: { unknown_param: 1 } }, // param no longer exists
      edit: { params: { replace_all: true } }, // still valid
    },
  });
  assert.equal(store.hasParamOverride("edit", "replace_all"), true);
  assert.equal(store.overrideCount(), 1);
  assert.equal(store.isModified("read"), false);
  assert.equal(store.isModified("grep"), false);
});

test("fromJSON tolerates malformed documents", () => {
  assert.equal(ToolConfigStore.fromJSON(null).overrideCount(), 0);
  assert.equal(ToolConfigStore.fromJSON(undefined).overrideCount(), 0);
  assert.equal(ToolConfigStore.fromJSON({}).overrideCount(), 0);
  assert.equal(ToolConfigStore.fromJSON({ tools: "nope" }).overrideCount(), 0);
  assert.equal(ToolConfigStore.fromJSON({ tools: { read: "nope" } }).overrideCount(), 0);
});

test("subscribe reports each mutation, in order", () => {
  const store = new ToolConfigStore();
  const events = [];
  const unsubscribe = store.subscribe((event) => events.push(event));

  store.setParam("read", "limit", 5);
  store.setEnabled("grep", false);
  store.clearParam("read", "limit");
  store.restoreAll();

  assert.deepEqual(events, [
    { kind: "param", tool: "read", param: "limit" },
    { kind: "enabled", tool: "grep" },
    { kind: "param", tool: "read", param: "limit" },
    { kind: "restored-all" },
  ]);

  unsubscribe();
  store.setParam("read", "limit", 6);
  assert.equal(events.length, 4, "no events after unsubscribe");
});
