/**
 * ToolConfigStore: the single source of truth for user tool configuration.
 *
 * Model
 * ----
 * Every tool has an `enabled` flag (default: the catalog's
 * `enabledByDefault`) and, for each configurable parameter, a stored value
 * (default: the catalog's `default`, i.e. "not set" when the catalog
 * declares none). The store keeps only *overrides* — values that differ
 * from the defaults — so `restoreTool` and `restoreAll` are exact inverses
 * of every edit: nothing can get "lost" because there is nothing extra to
 * lose.
 *
 * The store is pure in-memory and dependency-free; persistence (for example
 * localStorage) is a concern of the UI layer, which serializes with
 * `toJSON()` / `ToolConfigStore.fromJSON()`.
 */

import { getParameter, getTool, isToolName, listTools } from "./catalog.js";
import { ConfigValidationError, validateOverride } from "./validate.js";

/** Version stamped into every serialized override document. */
export const SCHEMA_VERSION = 1;

/**
 * @returns {object} A fresh empty overrides table (plain object).
 */
function emptyToolOverrides() {
  return { params: {} };
}

export class ToolConfigStore {
  /** @type {Map<string, {enabled: boolean, params: Object<string, unknown>}>} */
  #overrides = new Map();
  /** @type {Set<function>} */
  #listeners = new Set();

  // ------------------------------------------------------------------ reads

  /**
   * Whether the tool is effectively enabled (override, else catalog default).
   * @param {string} toolName
   * @returns {boolean}
   */
  isEnabled(toolName) {
    const override = this.#overrides.get(toolName);
    if (override && "enabled" in override) return override.enabled;
    return getTool(toolName)?.enabledByDefault ?? false;
  }

  /** Whether the user stored an explicit `enabled` override for the tool. */
  hasEnabledOverride(toolName) {
    const override = this.#overrides.get(toolName);
    return Boolean(override && "enabled" in override);
  }

  /**
   * Effective value of one parameter: the stored override, else the catalog
   * default (`null` when the catalog declares no default).
   *
   * @param {string} toolName
   * @param {string} paramName
   * @returns {unknown}
   */
  effectiveParam(toolName, paramName) {
    const override = this.#overrides.get(toolName);
    if (override && Object.hasOwn(override.params, paramName)) return override.params[paramName];
    return getParameter(toolName, paramName)?.default ?? null;
  }

  /** Whether one parameter currently holds a stored override. */
  hasParamOverride(toolName, paramName) {
    const override = this.#overrides.get(toolName);
    return Boolean(override && Object.hasOwn(override.params, paramName));
  }

  /** Whether the tool has any override at all (enabled or parameter). */
  isModified(toolName) {
    const override = this.#overrides.get(toolName);
    if (!override) return false;
    return "enabled" in override || Object.keys(override.params).length > 0;
  }

  /** Names of every tool with at least one override, in catalog order. */
  modifiedTools() {
    return listTools()
      .map((tool) => tool.name)
      .filter((name) => this.isModified(name));
  }

  /** Counts for the UI footer: how many tools/parameters are customized. */
  modifiedSummary() {
    let tools = 0;
    let params = 0;
    for (const [name, override] of this.#overrides) {
      if (this.isModified(name)) tools += 1;
      params += Object.keys(override.params).length;
    }
    return { tools, params };
  }

  /** Total number of stored overrides (enabled flags + parameter values). */
  overrideCount() {
    let count = 0;
    for (const override of this.#overrides.values()) {
      if ("enabled" in override) count += 1;
      count += Object.keys(override.params).length;
    }
    return count;
  }

  // ----------------------------------------------------------------- writes

  /**
   * Set the tool's enabled state. Storing the catalog default clears the
   * override entirely, so `isModified` stays accurate.
   *
   * @param {string} toolName
   * @param {boolean} enabled
   */
  setEnabled(toolName, enabled) {
    if (!isToolName(toolName)) {
      throw new ConfigValidationError("unknown-tool", `Unknown tool "${toolName}".`, { tool: toolName });
    }
    if (typeof enabled !== "boolean") {
      throw new ConfigValidationError("type-mismatch", `"enabled" expects boolean, got ${typeof enabled}.`);
    }
    const tool = getTool(toolName);
    const overrides = this.#toolOverrides(toolName);
    if (enabled !== tool.enabledByDefault) overrides.enabled = enabled;
    else delete overrides.enabled;
    this.#maybeDelete(toolName);
    this.#emit({ kind: "enabled", tool: toolName });
  }

  /**
   * Store an override for one parameter. Passing `null` clears the override
   * (back to the catalog default), which is the same as `clearParam`.
   *
   * @param {string} toolName
   * @param {string} paramName
   * @param {unknown} value
   */
  setParam(toolName, paramName, value) {
    if (value === null) {
      this.clearParam(toolName, paramName);
      return;
    }
    const result = validateOverride(toolName, paramName, value);
    if (!result.ok) throw result.error;
    const default_ = getParameter(toolName, paramName).default;
    const overrides = this.#toolOverrides(toolName);
    if (value === default_) {
      delete overrides.params[paramName];
    } else {
      overrides.params[paramName] = value;
    }
    this.#maybeDelete(toolName);
    this.#emit({ kind: "param", tool: toolName, param: paramName });
  }

  /**
   * Clear one parameter's override, returning it to the catalog default.
   * No-op when there is no override to clear.
   *
   * @param {string} toolName
   * @param {string} paramName
   */
  clearParam(toolName, paramName) {
    if (!isToolName(toolName) || !getParameter(toolName, paramName)) return;
    const overrides = this.#overrides.get(toolName);
    if (!overrides || !Object.hasOwn(overrides.params, paramName)) return;
    delete overrides.params[paramName];
    this.#maybeDelete(toolName);
    this.#emit({ kind: "param", tool: toolName, param: paramName });
  }

  /**
   * Restore one tool to its complete factory state: enabled flag and every
   * parameter back to the catalog defaults. This is the safety net for
   * "I changed it and now it's broken".
   *
   * @param {string} toolName
   */
  restoreTool(toolName) {
    if (!isToolName(toolName)) {
      throw new ConfigValidationError("unknown-tool", `Unknown tool "${toolName}".`, { tool: toolName });
    }
    if (!this.isModified(toolName)) return;
    this.#overrides.delete(toolName);
    this.#emit({ kind: "restored-tool", tool: toolName });
  }

  /** Restore every tool to its complete factory state. */
  restoreAll() {
    if (this.#overrides.size === 0) return;
    this.#overrides = new Map();
    this.#emit({ kind: "restored-all" });
  }

  // ----------------------------------------------------- (de)serialization

  /**
   * Serialize all overrides as a plain JSON-safe object.
   * @returns {{schemaVersion: number, tools: Object<string, {enabled?: boolean, params: Object<string, unknown>}>}}
   */
  toJSON() {
    const tools = {};
    for (const [name, override] of this.#overrides) {
      if (!this.isModified(name)) continue;
      tools[name] = {
        ...("enabled" in override ? { enabled: override.enabled } : {}),
        params: { ...override.params },
      };
    }
    return { schemaVersion: SCHEMA_VERSION, tools };
  }

  /**
   * Rebuild a store from a serialized document. Unknown tools, parameters,
   * and values that no longer validate against the current catalog are
   * skipped (they revert to defaults) instead of throwing, so a catalog
   * upgrade can never wedge the UI.
   *
   * @param {{schemaVersion?: number, tools?: Object<string, any>}} json
   * @returns {ToolConfigStore}
   */
  static fromJSON(json) {
    const store = new ToolConfigStore();
    if (!json || typeof json !== "object" || typeof json.tools !== "object" || json.tools === null) {
      return store;
    }
    for (const [toolName, entry] of Object.entries(json.tools)) {
      if (!isToolName(toolName) || !entry || typeof entry !== "object") continue;
      if (typeof entry.enabled === "boolean") {
        const tool = getTool(toolName);
        if (entry.enabled !== tool.enabledByDefault) store.setEnabled(toolName, entry.enabled);
      }
      if (entry.params && typeof entry.params === "object") {
        for (const [paramName, value] of Object.entries(entry.params)) {
          const result = validateOverride(toolName, paramName, value);
          if (result.ok) store.setParam(toolName, paramName, value);
        }
      }
    }
    return store;
  }

  // ------------------------------------------------------------- internals

  /** @param {string} toolName @returns {{enabled: boolean, params: Object<string, unknown>}} */
  #toolOverrides(toolName) {
    let overrides = this.#overrides.get(toolName);
    if (!overrides) {
      overrides = emptyToolOverrides();
      this.#overrides.set(toolName, overrides);
    }
    return overrides;
  }

  /** Drop a tool's entry once it holds no effective overrides. */
  #maybeDelete(toolName) {
    if (!this.isModified(toolName)) this.#overrides.delete(toolName);
  }

  /**
   * @param {{kind: string, tool: string, param?: string}} event
   */
  #emit(event) {
    for (const listener of this.#listeners) listener(event);
  }

  /**
   * Subscribe to change events. Returns an unsubscribe function.
   * @param {(event: {kind: string, tool: string, param?: string}) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
