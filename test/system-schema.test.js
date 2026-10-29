/**
 * Tests for the System Plugin Studio schema walker (src/system/schema.js).
 *
 * The fixtures model the real schemastery `schema.toJSON()` envelope for the
 * plugins the user actually customizes: the `llm-pi-ai` model adapter
 * (`providers` dict of provider profiles, each with a `models` array) and the
 * `agent-default-model` (flat object with an enum `reasoningEffort`).
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyOpsToValue,
  buildFormTree,
  describeLeaf,
  deepClone,
  formatLeaf,
  isOverridden,
  leaves,
  parseLeaf,
  unionOptions,
  valueAt,
  walk,
} from "../src/system/schema.js";

// --------------------------------------------------------------------- fixtures

const profileSchema = {
  type: "object",
  dict: {
    displayName: { type: "string", meta: { required: true } },
    apiKeyEnv: { type: "string", meta: {} },
    api: { type: "string", meta: {} },
    baseURL: { type: "string", meta: {} },
    models: {
      type: "array",
      inner: {
        type: "object",
        dict: {
          id: { type: "string", meta: { required: true } },
          name: { type: "string", meta: {} },
          contextWindow: { type: "number", meta: {} },
          maxTokens: { type: "number", meta: {} },
          input: { type: "array", inner: { type: "string" } },
        },
      },
    },
  },
};

const piAiSchema = {
  type: "object",
  dict: {
    providers: { type: "dict", inner: profileSchema },
  },
};

const piAiValue = {
  providers: {
    vllm: {
      displayName: "vllm",
      apiKeyEnv: "VLLM_API_KEY",
      api: "openai-responses",
      baseURL: "http://10.2.65.250:3000/v1",
      models: [
        {
          id: "qwen3.8:27b",
          name: "qwen3.8:27b",
          contextWindow: 256000,
          maxTokens: 32000,
          input: ["text", "image"],
        },
      ],
    },
    "new-api": {
      displayName: "new-api",
      api: "openai-responses",
      baseURL: "http://106.55.101.69:3000/v1",
      models: [
        { id: "DeepSeek-V4.1-Flash-1017", contextWindow: 1000000, maxTokens: 384000 },
      ],
    },
  },
};

const defaultModelSchema = {
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
        { type: "literal", value: "max" },
      ],
    },
  },
};

// --------------------------------------------------------------------- walk

test("walk: object -> dict -> object -> array nesting for the model adapter", () => {
  const tree = buildFormTree(piAiSchema, piAiValue);
  assert.equal(tree.kind, "object");

  const providers = tree.children.find((c) => c.key === "providers");
  assert.equal(providers.kind, "dict");
  assert.deepEqual(providers.children.map((c) => c.key), ["vllm", "new-api"]);

  const vllm = providers.children.find((c) => c.key === "vllm");
  assert.equal(vllm.kind, "object");
  assert.deepEqual(
    vllm.children.map((c) => c.key),
    ["displayName", "apiKeyEnv", "api", "baseURL", "models"],
  );

  const displayName = vllm.children.find((c) => c.key === "displayName");
  assert.equal(displayName.kind, "leaf");
  assert.equal(displayName.leafType, "string");
  assert.deepEqual(displayName.path, ["providers", "vllm", "displayName"]);

  const models = vllm.children.find((c) => c.key === "models");
  assert.equal(models.kind, "array");
  assert.equal(models.children.length, 1);
  const model0 = models.children[0];
  assert.equal(model0.kind, "object");
  const idLeaf = model0.children.find((c) => c.key === "id");
  assert.equal(idLeaf.kind, "leaf");
  assert.deepEqual(idLeaf.path, ["providers", "vllm", "models", "0", "id"]);

  const input = model0.children.find((c) => c.key === "input");
  assert.equal(input.kind, "array");
  assert.deepEqual(input.children.map((c) => c.path), [
    ["providers", "vllm", "models", "0", "input", "0"],
    ["providers", "vllm", "models", "0", "input", "1"],
  ]);
});

test("walk: missing/undefined values yield empty containers, not a crash", () => {
  const tree = buildFormTree(piAiSchema, { providers: {} });
  const providers = tree.children.find((c) => c.key === "providers");
  assert.equal(providers.kind, "dict");
  assert.deepEqual(providers.children, []);

  const tree2 = buildFormTree(piAiSchema, undefined);
  assert.equal(tree2.kind, "object");
});

test("walk: a dict with no value renders no children (nothing to edit yet)", () => {
  const tree = walk({ type: "dict", inner: profileSchema }, undefined, [], "providers");
  assert.equal(tree.kind, "dict");
  assert.deepEqual(tree.children, []);
});

// --------------------------------------------------------------------- leaves / valueAt / isOverridden

test("leaves: collects every leaf in document order", () => {
  const tree = buildFormTree(piAiSchema, piAiValue);
  const all = leaves(tree);
  assert.ok(all.every((leaf) => leaf.kind === "leaf"));
  const paths = all.map((leaf) => leaf.path.join("/"));
  assert.ok(paths.includes("providers/vllm/displayName"));
  assert.ok(paths.includes("providers/vllm/models/0/contextWindow"));
  assert.ok(paths.includes("providers/new-api/baseURL"));
});

test("valueAt: reads nested values and returns undefined when absent", () => {
  assert.equal(valueAt(piAiValue, ["providers", "vllm", "baseURL"]), "http://10.2.65.250:3000/v1");
  assert.equal(valueAt(piAiValue, ["providers", "vllm", "models", "0", "contextWindow"]), 256000);
  assert.equal(valueAt(piAiValue, ["providers", "vllm", "nope"]), undefined);
  assert.equal(valueAt(piAiValue, ["nope", "deeper"]), undefined);
});

test("isOverridden: true only when the user section owns the exact path", () => {
  const user = { providers: { vllm: { baseURL: "http://override" } } };
  assert.equal(isOverridden(user, ["providers", "vllm", "baseURL"]), true);
  assert.equal(isOverridden(user, ["providers", "vllm", "displayName"]), false);
  assert.equal(isOverridden(user, ["providers", "new-api", "baseURL"]), false);
  assert.equal(isOverridden(undefined, ["providers"]), false);
  assert.equal(isOverridden(user, []), false);
});

// --------------------------------------------------------------------- describeLeaf / unionOptions

test("describeLeaf: primitive, literal, secret, and enum classification", () => {
  assert.equal(describeLeaf({ type: "string" }).leafType, "string");
  assert.equal(describeLeaf({ type: "number" }).leafType, "number");
  assert.equal(describeLeaf({ type: "boolean" }).leafType, "boolean");
  assert.equal(describeLeaf({ type: "literal", value: 5 }).leafType, "literal");
  assert.equal(describeLeaf({ type: "literal", value: 5 }).fixed, 5);

  const secret = describeLeaf({ type: "string", meta: { role: "secret" } });
  assert.equal(secret.secret, true);

  const req = describeLeaf({ type: "string", meta: { required: true, default: "x" } });
  assert.equal(req.required, true);
  assert.equal(req.default, "x");

  const enumLeaf = describeLeaf({
    type: "union",
    list: [{ type: "literal", value: "a" }, { type: "literal", value: "b" }],
  });
  assert.equal(enumLeaf.leafType, "enum");
  assert.deepEqual(enumLeaf.options, ["a", "b"]);
});

test("unionOptions: null when the union is not a flat literal set", () => {
  assert.deepEqual(
    unionOptions({ type: "union", list: [{ type: "literal", value: "a" }, { type: "null" }] }),
    ["a", null],
  );
  assert.equal(
    unionOptions({ type: "union", list: [{ type: "literal", value: "a" }, { type: "object", dict: {} }] }),
    null,
  );
  assert.equal(unionOptions({ type: "union", list: [] }), null);
});

test("describeLeaf: an object/dict/array node is classified as json (not a scalar leaf)", () => {
  assert.equal(describeLeaf({ type: "object", dict: {} }).leafType, "json");
  assert.equal(describeLeaf({ type: "dict", inner: { type: "string" } }).leafType, "json");
});

// --------------------------------------------------------------------- agent-default-model

test("walk: the flat default-model entry with an enum reasoningEffort", () => {
  const tree = buildFormTree(defaultModelSchema, { provider: "vllm", model: "qwen3.8:27b", reasoningEffort: "high" });
  const effort = tree.children.find((c) => c.key === "reasoningEffort");
  assert.equal(effort.kind, "leaf");
  assert.equal(effort.leafType, "enum");
  assert.deepEqual(effort.options, ["off", "low", "high", "max"]);
});

// --------------------------------------------------------------------- parseLeaf / formatLeaf

test("parseLeaf: string, number, boolean, enum, json", () => {
  assert.deepEqual(parseLeaf("string", "  hello "), { ok: true, value: "  hello " });
  assert.deepEqual(parseLeaf("number", "123"), { ok: true, value: 123 });
  assert.deepEqual(parseLeaf("number", "-2.5"), { ok: true, value: -2.5 });
  assert.deepEqual(parseLeaf("number", ""), { ok: false, error: "a number is required" });
  assert.deepEqual(parseLeaf("number", "abc"), { ok: false, error: '"abc" is not a finite number' });
  assert.deepEqual(parseLeaf("boolean", "true"), { ok: true, value: true });
  assert.deepEqual(parseLeaf("boolean", "false"), { ok: true, value: false });
  assert.equal(parseLeaf("boolean", "yes").ok, false);
  assert.deepEqual(parseLeaf("enum", "high"), { ok: true, value: "high" });
  assert.deepEqual(parseLeaf("json", '{"a":1}'), { ok: true, value: { a: 1 } });
  assert.deepEqual(parseLeaf("json", ""), { ok: true, value: null });
  assert.equal(parseLeaf("json", "{nope").ok, false);
});

test("formatLeaf: boolean and json formatting", () => {
  assert.equal(formatLeaf({ leafType: "boolean" }, true), "true");
  assert.equal(formatLeaf({ leafType: "boolean" }, false), "false");
  assert.equal(formatLeaf({ leafType: "json" }, { a: 1 }), JSON.stringify({ a: 1 }, null, 2));
  assert.equal(formatLeaf({ leafType: "string" }, undefined), "");
  assert.equal(formatLeaf({ leafType: "string" }, 42), "42");
});

// --------------------------------------------------------------------- working value

test("deepClone: independent copies for objects, arrays, and primitives", () => {
  const src = { a: [1, 2, { b: "c" }], d: null, e: 5 };
  const copy = deepClone(src);
  assert.notEqual(copy, src);
  assert.deepEqual(copy, src);
  copy.a[2].b = "mutated";
  assert.equal(src.a[2].b, "c");
  assert.equal(deepClone(7), 7);
  assert.equal(deepClone(null), null);
  assert.equal(deepClone("s"), "s");
});

test("applyOpsToValue: set ops create intermediate containers", () => {
  const result = applyOpsToValue({}, [
    { op: "set", path: ["providers", "vllm", "baseURL"], value: "http://x" },
  ]);
  assert.deepEqual(result, { providers: { vllm: { baseURL: "http://x" } } });
});

test("applyOpsToValue: set op appends to an array at its length", () => {
  const value = { models: [{ id: "a" }] };
  const result = applyOpsToValue(value, [
    { op: "set", path: ["models", "1"], value: { id: "b" } },
  ]);
  assert.deepEqual(result.models, [{ id: "a" }, { id: "b" }]);
  assert.deepEqual(value.models, [{ id: "a" }]); // input untouched
});

test("applyOpsToValue: unset op removes a key and splices an array index", () => {
  const value = { a: { x: 1, y: 2 }, list: [10, 20, 30] };
  const result = applyOpsToValue(value, [
    { op: "unset", path: ["a", "x"] },
    { op: "unset", path: ["list", "1"] },
  ]);
  assert.deepEqual(result, { a: { y: 2 }, list: [10, 30] });
  assert.deepEqual(value, { a: { x: 1, y: 2 }, list: [10, 20, 30] });
});

test("applyOpsToValue: root set/unset and empty ops", () => {
  assert.deepEqual(applyOpsToValue({ a: 1 }, [{ op: "set", path: [], value: { b: 2 } }]), { b: 2 });
  assert.deepEqual(applyOpsToValue({ a: 1 }, [{ op: "unset", path: [] }]), {});
  const src = { a: 1 };
  assert.deepEqual(applyOpsToValue(src, []), src); // no-op keeps the value…
  assert.notEqual(applyOpsToValue(src, []), src); // …but still returns a fresh clone
});
