/**
 * Tool catalog for the DSH Tool Config Studio.
 *
 * The catalog is a declarative mirror of the DeepSeek Harness (dsh) built-in
 * tool declarations: every tool name, its human-readable title and summary,
 * its category, whether it is enabled by default, and its parameter schema
 * (name, type, required-ness, default value, enum values, minimum).
 *
 * This module loads the JSON catalog once, validates its integrity, and
 * exposes small query helpers used by the config store and the UI. It is
 * dependency-free and runs unchanged in Node and in the browser.
 */

import raw from "./catalog.json" with { type: "json" };

/** Parameter types the catalog may declare. */
export const PARAMETER_TYPES = Object.freeze([
  "string",
  "number",
  "boolean",
  "array",
  "object",
]);

const CATEGORY_FIELDS = Object.freeze(["id", "label", "order"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(message) {
  throw new Error(`[dsh-tool-config-studio] invalid tool catalog: ${message}`);
}

/**
 * Validate the raw catalog shape.
 *
 * Rules:
 * - `categories` is a non-empty list of { id, label, order } with unique ids.
 * - `tools` is a non-empty list with unique wire names.
 * - Every tool references a declared category.
 * - Every parameter has a known type and a unique name within its tool.
 * - Required parameters must not carry a default.
 * - `enumValues` (when present) is a non-empty list of unique strings.
 * - `default` (when present) matches the declared type.
 * - `min` (when present) applies to number parameters only.
 *
 * @param {object} catalog - Parsed catalog.json.
 * @throws {Error} When any rule is violated.
 */
export function validateCatalog(catalog) {
  if (!isPlainObject(catalog)) fail("root must be an object");
  if (!Array.isArray(catalog.categories) || catalog.categories.length === 0) {
    fail("categories must be a non-empty list");
  }
  if (!Array.isArray(catalog.tools) || catalog.tools.length === 0) {
    fail("tools must be a non-empty list");
  }

  const categoryIds = new Set();
  for (const [index, category] of catalog.categories.entries()) {
    if (!isPlainObject(category)) fail(`categories[${index}] must be an object`);
    for (const field of CATEGORY_FIELDS) {
      if (!(field in category)) fail(`categories[${index}] is missing "${field}"`);
    }
    if (typeof category.id !== "string" || category.id.length === 0) {
      fail(`categories[${index}].id must be a non-empty string`);
    }
    if (categoryIds.has(category.id)) fail(`duplicate category id "${category.id}"`);
    categoryIds.add(category.id);
  }

  const toolNames = new Set();
  for (const [index, tool] of catalog.tools.entries()) {
    if (!isPlainObject(tool)) fail(`tools[${index}] must be an object`);
    if (typeof tool.name !== "string" || tool.name.length === 0) {
      fail(`tools[${index}].name must be a non-empty string`);
    }
    if (toolNames.has(tool.name)) fail(`duplicate tool name "${tool.name}"`);
    toolNames.add(tool.name);
    if (!categoryIds.has(tool.category)) {
      fail(`tool "${tool.name}" references unknown category "${tool.category}"`);
    }
    if (typeof tool.enabledByDefault !== "boolean") {
      fail(`tool "${tool.name}" needs a boolean enabledByDefault`);
    }
    if (!Array.isArray(tool.parameters)) {
      fail(`tool "${tool.name}" needs a parameters list`);
    }

    const paramNames = new Set();
    for (const [pIndex, param] of tool.parameters.entries()) {
      const where = `tool "${tool.name}" parameters[${pIndex}]`;
      if (!isPlainObject(param)) fail(`${where} must be an object`);
      if (typeof param.name !== "string" || param.name.length === 0) {
        fail(`${where}.name must be a non-empty string`);
      }
      if (paramNames.has(param.name)) {
        fail(`${where}: duplicate parameter name "${param.name}"`);
      }
      paramNames.add(param.name);
      if (!PARAMETER_TYPES.includes(param.type)) {
        fail(`${where} "${param.name}" has unknown type "${param.type}"`);
      }
      if (typeof param.required !== "boolean") {
        fail(`${where} "${param.name}" needs a boolean "required"`);
      }
      if (param.required && "default" in param) {
        fail(`${where} "${param.name}" is required and must not declare a default`);
      }
      if ("default" in param) {
        const value = param.default;
        const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
        if (actual !== param.type) {
          fail(`${where} "${param.name}" default has type "${actual}", expected "${param.type}"`);
        }
      }
      if ("enumValues" in param) {
        const values = param.enumValues;
        if (!Array.isArray(values) || values.length === 0) {
          fail(`${where} "${param.name}" enumValues must be a non-empty list`);
        }
        const seen = new Set();
        for (const value of values) {
          if (typeof value !== "string") {
            fail(`${where} "${param.name}" enumValues must contain only strings`);
          }
          if (seen.has(value)) {
            fail(`${where} "${param.name}" enumValues contain duplicate "${value}"`);
          }
          seen.add(value);
        }
        if ("default" in param && !values.includes(param.default)) {
          fail(`${where} "${param.name}" default is not one of its enumValues`);
        }
      }
      if ("min" in param) {
        if (param.type !== "number") {
          fail(`${where} "${param.name}" min only applies to number parameters`);
        }
        if (typeof param.min !== "number" || !Number.isFinite(param.min)) {
          fail(`${where} "${param.name}" min must be a finite number`);
        }
        if ("default" in param && param.default !== null && param.default < param.min) {
          fail(`${where} "${param.name}" default is below its min`);
        }
      }
    }
  }
}

/**
 * Deep-freeze the catalog so consumers cannot mutate the source of truth.
 * @param {object} value
 * @returns {object}
 */
function deepFreeze(value) {
  if (isPlainObject(value) || Array.isArray(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

/**
 * Normalize a raw tool entry: derive `configurable` for each parameter
 * (optional parameters are configurable by default; an explicit
 * `configurable` flag in the JSON wins) and attach a stable `id`.
 *
 * @param {object} tool - Raw catalog tool.
 * @returns {object} Normalized tool (frozen).
 */
function normalizeTool(tool) {
  const normalized = {
    name: tool.name,
    title: tool.title ?? tool.name,
    summary: tool.summary ?? "",
    category: tool.category,
    enabledByDefault: tool.enabledByDefault,
    parameters: tool.parameters.map((param) => ({
      name: param.name,
      type: param.type,
      required: param.required,
      configurable: param.configurable ?? !param.required,
      default: "default" in param ? param.default : null,
      enumValues: "enumValues" in param ? [...param.enumValues] : null,
      min: "min" in param ? param.min : null,
      description: param.description ?? "",
    })),
  };
  return deepFreeze(normalized);
}

validateCatalog(raw);

const CATEGORIES = deepFreeze(
  raw.categories
    .map((category) => ({ ...category }))
    .sort((a, b) => a.order - b.order),
);

const TOOLS = deepFreeze(
  raw.tools
    .map(normalizeTool)
    .sort((a, b) => a.name.localeCompare(b.name)),
);

const TOOLS_BY_NAME = deepFreeze(
  Object.fromEntries(TOOLS.map((tool) => [tool.name, tool])),
);

/** @returns {ReadonlyArray<object>} Categories in display order. */
export function listCategories() {
  return CATEGORIES;
}

/**
 * @param {string} categoryId
 * @returns {object|undefined}
 */
export function getCategory(categoryId) {
  return CATEGORIES.find((category) => category.id === categoryId);
}

/** @returns {ReadonlyArray<object>} All tools, sorted by wire name. */
export function listTools() {
  return TOOLS;
}

/**
 * @param {string} name - Wire tool name.
 * @returns {object|undefined}
 */
export function getTool(name) {
  return TOOLS_BY_NAME[name];
}

/**
 * Tools of one category, in the catalog's global name order.
 * @param {string} categoryId
 * @returns {ReadonlyArray<object>}
 */
export function toolsInCategory(categoryId) {
  return TOOLS.filter((tool) => tool.category === categoryId);
}

/**
 * @param {string} toolName
 * @param {string} paramName
 * @returns {object|undefined}
 */
export function getParameter(toolName, paramName) {
  const tool = TOOLS_BY_NAME[toolName];
  return tool?.parameters.find((param) => param.name === paramName);
}

/**
 * The parameters a user may give a stored default value for.
 * @param {object|string} tool - Normalized tool or wire tool name.
 * @returns {ReadonlyArray<object>}
 */
export function configurableParameters(tool) {
  const entry = typeof tool === "string" ? TOOLS_BY_NAME[tool] : tool;
  if (!entry) return [];
  return entry.parameters.filter((param) => param.configurable);
}

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isToolName(name) {
  return Object.hasOwn(TOOLS_BY_NAME, name);
}

/** The catalog's total tool count (handy for UI footers and tests). */
export const TOOL_COUNT = TOOLS.length;

/** Version stamped into catalog.json; bump when the shape changes. */
export const CATALOG_SCHEMA_VERSION = raw.$schemaVersion;
