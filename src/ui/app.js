/**
 * Application controller for the Tool Config Studio.
 *
 * Owns the view state (search query, expanded tools, inline validation
 * errors), builds the shell once, and re-renders the list and footer on
 * every relevant change. All store mutations go through the `api` exposed
 * to the render layer, so validation errors are captured and shown inline
 * instead of escaping as unhandled exceptions.
 */

import { CATALOG_SCHEMA_VERSION, TOOL_COUNT } from "../core/catalog.js";
import { ConfigValidationError } from "../core/validate.js";
import { buildShell, paramKey, renderCount, renderFooter, renderList } from "./render.js";

/**
 * Create a controller bound to a root element, a config store, and an
 * i18n bundle. Call `mount()` to render and `unmount()` to tear down.
 *
 * @param {{root: HTMLElement, store: import("../core/store.js").ToolConfigStore, i18n: object}} options
 * @returns {{
 *   mount: () => void,
 *   unmount: () => void,
 *   refresh: () => void,
 *   store: import("../core/store.js").ToolConfigStore,
 *   state: {query: string, expanded: Set<string>, errors: Map<string, string>},
 * }}
 */
export function createToolConfigApp({ root, store, i18n }) {
  /** View state. `errors` maps "tool.param" to the last validation message. */
  const state = {
    query: "",
    expanded: new Set(),
    errors: new Map(),
  };

  let shell = null;
  let unsubscribe = null;
  let mounted = false;

  const api = {
    /** Update the search filter (live, from the header input). */
    setQuery(query) {
      if (state.query === query) return;
      state.query = query;
      refreshList();
    },

    /** Expand or collapse one tool. */
    toggleTool(name) {
      if (state.expanded.has(name)) state.expanded.delete(name);
      else state.expanded.add(name);
      refreshList();
    },

    /** Toggle a tool's enabled flag. */
    setEnabled(name, enabled) {
      store.setEnabled(name, enabled); // store event drives the re-render
    },

    /**
     * Store a parameter override. Invalid values are reported inline
     * (per-parameter error line) and never reach the store.
     *
     * Note: the error is cleared *before* the store call, because the
     * store's subscription re-renders synchronously inside `setParam` —
     * any state the render reads must already reflect the outcome.
     */
    setParam(name, param, value) {
      const key = paramKey(name, param);
      state.errors.delete(key);
      try {
        store.setParam(name, param, value);
      } catch (error) {
        if (error instanceof ConfigValidationError) {
          state.errors.set(key, error.message);
          refreshList();
        } else {
          throw error;
        }
      }
    },

    /** Clear one parameter back to its catalog default. */
    resetParam(name, param) {
      state.errors.delete(paramKey(name, param));
      store.clearParam(name, param);
    },

    /** Restore one tool to its complete factory state. */
    restoreTool(name) {
      for (const key of [...state.errors.keys()]) {
        if (key.startsWith(`${name}.`)) state.errors.delete(key);
      }
      store.restoreTool(name);
    },

    /** Confirm, then restore every tool to its factory state. */
    restoreAll() {
      const count = store.overrideCount();
      if (count === 0) return;
      if (typeof window !== "undefined" && typeof window.confirm === "function") {
        if (!window.confirm(i18n.t("actions.restoreAllConfirm", { count }))) return;
      }
      state.errors.clear();
      store.restoreAll();
    },
  };

  const ctx = { i18n, store, state, api };

  function refreshList() {
    if (!mounted || !shell) return;
    const shown = renderList(shell.refs.list, ctx);
    renderCount(shell.refs.count, ctx, shown, TOOL_COUNT);
  }

  function refreshFooter() {
    if (!mounted || !shell) return;
    renderFooter(shell.refs.footer, ctx, CATALOG_SCHEMA_VERSION, TOOL_COUNT);
  }

  function refreshAll() {
    refreshList();
    refreshFooter();
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    shell = buildShell(ctx);
    root.replaceChildren(shell.node);
    unsubscribe = store.subscribe(() => refreshAll());
    refreshAll();
  }

  function unmount() {
    if (!mounted) return;
    mounted = false;
    unsubscribe?.();
    unsubscribe = null;
    shell?.node.remove();
    shell = null;
  }

  return { mount, unmount, refresh: refreshAll, store, state };
}
