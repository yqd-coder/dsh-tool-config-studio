/**
 * Catalog integrity tests: the catalog is the source of truth for the whole
 * plugin, so any structural defect must fail loudly at load time.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CATALOG_SCHEMA_VERSION,
  TOOL_COUNT,
  configurableParameters,
  getParameter,
  getTool,
  isToolName,
  listCategories,
  listTools,
  toolsInCategory,
  validateCatalog,
} from "../src/core/catalog.js";
import rawCatalog from "../src/core/catalog.json" with { type: "json" };

test("catalog passes structural validation", () => {
  assert.doesNotThrow(() => validateCatalog(rawCatalog));
  assert.equal(CATALOG_SCHEMA_VERSION, 1);
});

test("tools are unique, sorted, and categorized", () => {
  const categories = listCategories();
  const tools = listTools();

  assert.ok(tools.length >= 30, `expected at least 30 tools, got ${tools.length}`);
  assert.equal(tools.length, TOOL_COUNT);

  const names = new Set(tools.map((tool) => tool.name));
  assert.equal(names.size, tools.length, "tool names must be unique");

  const byName = tools.map((tool) => tool.name);
  const sorted = [...byName].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(byName, sorted, "tools must be sorted by wire name");

  const categoryIds = new Set(categories.map((category) => category.id));
  for (const tool of tools) {
    assert.ok(categoryIds.has(tool.category), `tool "${tool.name}" has unknown category`);
    assert.equal(typeof tool.enabledByDefault, "boolean");
  }

  // Categories are ordered and partition the tools exactly once.
  const orders = categories.map((category) => category.order);
  assert.deepEqual([...orders].sort((a, b) => a - b), orders);
  const partition = categories.reduce((sum, category) => sum + toolsInCategory(category.id).length, 0);
  assert.equal(partition, tools.length);
});

test("parameters are well-formed", () => {
  const types = new Set(["string", "number", "boolean", "array", "object"]);
  for (const tool of listTools()) {
    const seen = new Set();
    for (const param of tool.parameters) {
      assert.ok(!seen.has(param.name), `duplicate parameter ${tool.name}.${param.name}`);
      seen.add(param.name);
      assert.ok(types.has(param.type), `unknown type on ${tool.name}.${param.name}`);
      assert.equal(typeof param.required, "boolean");
      if (param.required) {
        assert.equal(param.default, null, `required param ${tool.name}.${param.name} must not have a default`);
        assert.equal(param.configurable, false, `required param ${tool.name}.${param.name} must not be configurable`);
      }
      if (param.enumValues) {
        assert.ok(param.enumValues.length > 0);
        assert.ok(param.enumValues.every((value) => typeof value === "string"));
        if (param.default !== null) {
          assert.ok(param.enumValues.includes(param.default), `default must be in enumValues for ${tool.name}.${param.name}`);
        }
      }
      if (param.min !== null) {
        assert.equal(param.type, "number", `min only applies to numbers (${tool.name}.${param.name})`);
        if (param.default !== null) assert.ok(param.default >= param.min);
      }
    }
  }
});

test("the core dsh tool set is present", () => {
  const expected = [
    "read", "write", "edit", "glob", "grep", "pwsh", "working_directory", "read_image", "present",
    "load_workspace_dependencies",
    "subagent_fork", "list_agents", "interrupt_agent", "send_message", "skill", "workflow",
    "job_list", "job_output", "job_kill",
    "create_goal", "get_goal", "update_goal",
    "schedule_create", "schedule_update", "schedule_delete", "schedule_list",
    "web_fetch", "web_search",
    "exit_plan_mode", "todo_write", "ask_user_question",
  ];
  for (const name of expected) {
    assert.ok(isToolName(name), `expected tool "${name}" in catalog`);
  }
  assert.equal(new Set(expected).size, TOOL_COUNT, "expected list should match the catalog exactly");
});

test("lookup helpers", () => {
  const read = getTool("read");
  assert.equal(read.title, "Read file");
  assert.equal(read.enabledByDefault, true);

  const offset = getParameter("read", "offset");
  assert.equal(offset.default, 1);
  assert.equal(offset.min, 1);
  assert.equal(offset.configurable, true);

  const filePath = getParameter("read", "file_path");
  assert.equal(filePath.required, true);
  assert.equal(filePath.configurable, false);

  assert.equal(getTool("definitely-not-a-tool"), undefined);
  assert.equal(getParameter("read", "definitely-not-a-param"), undefined);
  assert.equal(isToolName("definitely-not-a-tool"), false);
});

test("configurableParameters filters to stored-default candidates", () => {
  const editParams = configurableParameters("edit");
  assert.ok(editParams.every((param) => param.configurable));
  assert.ok(editParams.some((param) => param.name === "replace_all"));
  assert.ok(!editParams.some((param) => param.name === "file_path"));

  // String lookup works too.
  assert.deepEqual(
    configurableParameters("read").map((param) => param.name),
    ["offset", "limit"],
  );
});
