/**
 * Validation of user-supplied configuration values against the tool catalog.
 *
 * The rules are deliberately strict and small: a value must match the
 * parameter's declared type, be one of its `enumValues` when declared, and
 * respect its `min` when declared. Anything else is rejected before it can
 * reach the store, so a typo in the UI can never corrupt saved overrides.
 */

import { getParameter, getTool } from "./catalog.js";

/** Error code + human-readable message for a rejected configuration value. */
export class ConfigValidationError extends Error {
  /**
   * @param {string} code - Stable machine-readable code (e.g. "type-mismatch").
   * @param {string} message - Human-readable explanation.
   * @param {object} [params] - Structured context (tool, param, expected, value).
   */
  constructor(code, message, params = {}) {
    super(message);
    this.name = "ConfigValidationError";
    this.code = code;
    this.params = params;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function actualType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (value !== null && typeof value === "object") return "object";
  return typeof value;
}

function describeExpected(param) {
  return param.enumValues ? param.enumValues.join(" | ") : param.type;
}

function typeMismatch(param, value) {
  return new ConfigValidationError(
    "type-mismatch",
    `"${param.name}" expects ${describeExpected(param)}, got ${actualType(value)}.`,
    { param: param.name, expected: param.type, actual: actualType(value) },
  );
}

/**
 * Validate one value against one catalog parameter.
 *
 * @param {object} param - Normalized catalog parameter (from catalog.js).
 * @param {unknown} value - The candidate value.
 * @returns {{ ok: true, value: unknown } | { ok: false, error: ConfigValidationError }}
 */
export function validateParamValue(param, value) {
  switch (param.type) {
    case "string": {
      if (typeof value !== "string") return { ok: false, error: typeMismatch(param, value) };
      if (param.enumValues && !param.enumValues.includes(value)) {
        return {
          ok: false,
          error: new ConfigValidationError(
            "enum-violation",
            `"${param.name}" must be one of: ${param.enumValues.join(", ")}.`,
            { param: param.name, enumValues: param.enumValues, value },
          ),
        };
      }
      return { ok: true, value };
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { ok: false, error: typeMismatch(param, value) };
      }
      if (param.min !== null && value < param.min) {
        return {
          ok: false,
          error: new ConfigValidationError(
            "below-min",
            `"${param.name}" must be at least ${param.min}.`,
            { param: param.name, min: param.min, value },
          ),
        };
      }
      return { ok: true, value };
    }
    case "boolean": {
      if (typeof value !== "boolean") return { ok: false, error: typeMismatch(param, value) };
      return { ok: true, value };
    }
    case "array": {
      if (!Array.isArray(value)) return { ok: false, error: typeMismatch(param, value) };
      return { ok: true, value };
    }
    case "object": {
      if (!isPlainObject(value)) return { ok: false, error: typeMismatch(param, value) };
      return { ok: true, value };
    }
    default:
      return {
        ok: false,
        error: new ConfigValidationError(
          "unknown-type",
          `Catalog declares unknown parameter type "${param.type}" for "${param.name}".`,
          { param: param.name, expected: param.type },
        ),
      };
  }
}

/**
 * Validate that a (tool, param) pair exists and the param is configurable,
 * then validate the value. Central entry point used by the store.
 *
 * @param {string} toolName - Wire tool name.
 * @param {string} paramName - Parameter name within the tool.
 * @param {unknown} value - Candidate value.
 * @returns {{ ok: true, value: unknown } | { ok: false, error: ConfigValidationError }}
 */
export function validateOverride(toolName, paramName, value) {
  const tool = getTool(toolName);
  if (!tool) {
    return {
      ok: false,
      error: new ConfigValidationError("unknown-tool", `Unknown tool "${toolName}".`, { tool: toolName }),
    };
  }
  const param = getParameter(toolName, paramName);
  if (!param) {
    return {
      ok: false,
      error: new ConfigValidationError(
        "unknown-parameter",
        `Tool "${toolName}" has no parameter named "${paramName}".`,
        { tool: toolName, param: paramName },
      ),
    };
  }
  if (!param.configurable) {
    return {
      ok: false,
      error: new ConfigValidationError(
        "not-configurable",
        `"${toolName}.${paramName}" is a required per-call argument and cannot be given a stored default.`,
        { tool: toolName, param: paramName },
      ),
    };
  }
  return validateParamValue(param, value);
}
