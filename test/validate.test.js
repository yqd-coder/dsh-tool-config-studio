/**
 * Value validation tests: type, enum, and min rules, plus the
 * (tool, param) guard used by the store.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { getParameter } from "../src/core/catalog.js";
import { ConfigValidationError, validateOverride, validateParamValue } from "../src/core/validate.js";

test("valid values pass for every parameter type", () => {
  assert.equal(validateParamValue(getParameter("read", "offset"), 5).ok, true);
  assert.equal(validateParamValue(getParameter("edit", "replace_all"), true).ok, true);
  assert.equal(validateParamValue(getParameter("pwsh", "workdir"), "C:\\temp").ok, true);
  assert.equal(validateParamValue(getParameter("web_search", "queries"), ["a", "b"]).ok, true);
  assert.equal(validateParamValue(getParameter("workflow", "meta"), { name: "wf" }).ok, true);
});

test("type mismatches are rejected with a stable code", () => {
  const cases = [
    [getParameter("read", "offset"), "5"],
    [getParameter("read", "offset"), Number.NaN],
    [getParameter("edit", "replace_all"), "true"],
    [getParameter("pwsh", "workdir"), 42],
    [getParameter("web_search", "queries"), "not-an-array"],
    [getParameter("workflow", "meta"), "not-an-object"],
    [getParameter("read", "offset"), null],
  ];
  for (const [param, value] of cases) {
    const result = validateParamValue(param, value);
    assert.equal(result.ok, false, `${param.name} should reject ${String(value)}`);
    assert.equal(result.error.code, "type-mismatch", `param ${param.name}`);
    assert.ok(result.error instanceof ConfigValidationError);
  }
});

test("enum membership is enforced", () => {
  const scope = getParameter("list_agents", "scope");
  assert.equal(validateParamValue(scope, "children").ok, true);
  assert.equal(validateParamValue(scope, "descendants").ok, true);
  const bad = validateParamValue(scope, "sides");
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "enum-violation");
  assert.match(bad.error.message, /children, descendants/);
});

test("min bounds are enforced for number parameters", () => {
  const limit = getParameter("read", "limit");
  assert.equal(validateParamValue(limit, 1).ok, true);
  const bad = validateParamValue(limit, 0);
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "below-min");

  const everySeconds = getParameter("schedule_create", "every_seconds");
  assert.equal(validateParamValue(everySeconds, 59).ok, false);
  assert.equal(validateParamValue(everySeconds, 60).ok, true);
});

test("validateOverride guards the tool/param pair first", () => {
  assert.equal(validateOverride("not-a-tool", "x", 1).error.code, "unknown-tool");
  assert.equal(validateOverride("read", "not-a-param", 1).error.code, "unknown-parameter");
  assert.equal(validateOverride("read", "file_path", "x").error.code, "not-configurable");
  assert.equal(validateOverride("read", "offset", 3).ok, true);
});

test("ConfigValidationError carries stable metadata", () => {
  const error = new ConfigValidationError("demo-code", "demo message", { a: 1 });
  assert.ok(error instanceof Error);
  assert.ok(error instanceof ConfigValidationError);
  assert.equal(error.name, "ConfigValidationError");
  assert.equal(error.message, "demo message");
  assert.equal(error.code, "demo-code");
  assert.deepEqual(error.params, { a: 1 });
});
