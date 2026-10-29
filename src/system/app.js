/**
 * DOM application for the System Plugin Studio.
 *
 * Framework-free (plain DOM, same conventions as `src/ui/app.js`): a controller
 * bound to a root element and a `SystemPluginStore` renders an entry list —
 * one card per volatile settings entry — and, per expanded entry, a
 * schema-driven form over the *working value* (the effective value with the
 * staged edits applied), so Add/Remove and in-progress fields are visible
 * before the write is flushed.
 *
 * Re-render policy (see the store's emit reasons):
 *   "load"  – full re-render (fresh snapshot from the Host).
 *   "stage" – targeted update of the entry's header meta + action row only,
 *             so typing in an input never rebuilds the input (focus/caret
 *             survive). Structural actions (Add/Remove/Reset/Discard/Save)
 *             call `render()` directly from their click handlers.
 */

import { applyOpsToValue, buildFormTree, formatLeaf, isOverridden, parseLeaf, valueAt } from "./schema.js";
import { SystemPluginStore, pathKey } from "./store.js";
import { createI18n, detectLanguage } from "../ui/i18n.js";

/**
 * Tiny DOM builder (same semantics as the Tool Config Studio's `el`):
 * `el("div", { class: "x", onclick: fn }, child1, "text")`.
 * @param {string} tag
 * @param {object} [props]
 * @param {...(Node|string|number|null|undefined)} children
 */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (key === "value") node.value = value;
    else if (key === "disabled") node.disabled = value;
    else if (key === "type") node.type = value;
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** True when the entry's profile override owns at least one value. */
function entryHasOverride(entry) {
  const user = entry.user;
  if (user === undefined || user === null) return false;
  if (typeof user === "object" && !Array.isArray(user)) return Object.keys(user).length > 0;
  return user !== "";
}

/** The secret state (set/unset) for a leaf path, from the entry's secrets list. */
function secretState(entry, path) {
  const hit = (entry.secrets ?? []).find(
    (secret) =>
      Array.isArray(secret.path) &&
      secret.path.length === path.length &&
      secret.path.every((segment, i) => segment === path[i]),
  );
  return hit ? Boolean(hit.set) : false;
}

/**
 * Mount the System Plugin Studio into a container element.
 *
 * @param {HTMLElement} container - Element to render into.
 * @param {object} options
 * @param {object} options.adapter - Settings remote adapter:
 *   `describe()`, `mutate(ns, ops, revision)`, `replace(ns, section, revision)`,
 *   and optionally `onDocumentUpdated(cb) -> disposer` (pushed refresh).
 * @param {object} [options.i18n] - Pre-built i18n bundle (defaults to auto-detect).
 * @param {"en"|"zh"} [options.language] - UI language (used when no i18n given).
 * @returns {{ store: SystemPluginStore, unmount: () => void }}
 */
export function mountSystemPluginStudio(container, options = {}) {
  if (!container) throw new Error("mountSystemPluginStudio: a container element is required");
  const adapter = options.adapter;
  if (!adapter || typeof adapter.describe !== "function") {
    throw new Error("mountSystemPluginStudio: an adapter with describe() is required");
  }
  const i18n = options.i18n ?? createI18n(options.language ?? detectLanguage());
  const t = i18n.t;
  const store = new SystemPluginStore(adapter);

  const state = {
    expanded: new Set(), // expanded entry namespace ids
    entryErrors: new Map(), // ns -> last write error message
    leafErrors: new Map(), // `${ns}\u0000${pathKey}` -> parse error message
    busy: new Set(), // ns with an in-flight write
  };
  /** Per-entry live element refs for targeted updates (ns -> {meta, actions}). */
  const refs = new Map();
  /** Leaf row elements by error key, for targeted inline-error updates. */
  const leafRefs = new Map();

  /**
   * Shell convention (same as the Tool Config Studio): the outer `.sys`
   * element is built once at mount; every render replaces only the inner
   * body region, so the shell element stays a stable anchor for the host.
   */
  let shell = null;
  let bodyRef = null;
  let root = null;
  let unsubscribe = null;
  let docDisposer = null;
  let mounted = false;

  // ------------------------------------------------------------- helpers

  /** The working value for an entry: effective value + staged edits applied. */
  function workingValue(ns) {
    const entry = store.entry(ns);
    if (!entry) return undefined;
    const ops = store.pendingFor(ns).map((edit) =>
      edit.kind === "set" ? { op: "set", path: edit.path, value: edit.value } : { op: "unset", path: edit.path },
    );
    return applyOpsToValue(entry.value, ops);
  }

  function leafErrorKey(ns, path) {
    return `${ns}\u0000${pathKey(path)}`;
  }

  /** Ask the user a question; returns null when unavailable (tests, headless). */
  function promptText(message, fallback) {
    if (typeof window === "undefined" || typeof window.prompt !== "function") return null;
    return window.prompt(message, fallback ?? "");
  }

  function confirmText(message) {
    if (typeof window === "undefined" || typeof window.confirm !== "function") return true;
    return window.confirm(message);
  }

  // ------------------------------------------------------------ rendering

  /** Build the static shell once: header + note + (empty) body region. */
  function buildShell() {
    shell = el("div", { class: "sys" },
      buildHeader(),
      el("p", { class: "sys-note" }, t("system.note")),
      el("div", { class: "sys-body" }),
    );
    bodyRef = shell.querySelector(".sys-body");
    root.replaceChildren(shell);
  }

  function render() {
    if (!mounted || !bodyRef) return;
    refs.clear();
    leafRefs.clear();
    bodyRef.replaceChildren(...buildBody());
  }

  /** Targeted "stage" update: header meta + action row for one entry. */
  function updateEntryMeta(ns) {
    const entry = store.entry(ns);
    const ref = refs.get(ns);
    if (!entry || !ref) return;
    const pending = store.pendingFor(ns).length;
    ref.meta.replaceChildren(
      entryHasOverride(entry) ? el("span", { class: "sys-badge" }, t("system.modified")) : null,
      pending > 0 ? el("span", { class: "sys-badge sys-badge-pending" }, t("system.pending", { count: pending })) : null,
    );
    // Collapsed cards have no action row yet (refs.actions stays null).
    if (ref.actions) renderActions(entry, ref.actions);
  }

  /**
   * The re-renderable body content (an array of nodes). The shell — header
   * and note — lives outside and is never rebuilt.
   */
  function buildBody() {
    const status = store.state.status;
    if (status === "error") {
      return [el("div", { class: "sys-banner sys-banner-error" }, t("system.loadError", { error: store.state.error ?? "?" }))];
    }
    const entries = store.entries();
    if ((status === "loading" || status === "idle") && entries.length === 0) {
      return [el("div", { class: "sys-status" }, t("system.loading"))];
    }
    if (entries.length === 0) {
      return [el("div", { class: "sys-status" }, t("system.empty"))];
    }
    const modified = entries.filter(entryHasOverride).length;
    return [
      el("div", { class: "sys-count" }, t("system.count", { total: entries.length, modified })),
      ...entries.map(buildEntryCard),
    ];
  }

  function buildHeader() {
    return el("header", { class: "sys-header" },
      el("div", { class: "sys-title-block" },
        el("h1", { class: "sys-title" }, "🧩 ", t("system.title")),
        el("p", { class: "sys-subtitle" }, t("system.subtitle")),
      ),
    );
  }

  function buildEntryCard(entry) {
    const ns = entry.ns;
    const open = state.expanded.has(ns);
    const pending = store.pendingFor(ns).length;
    const meta = el("span", { class: "sys-entry-meta" },
      entryHasOverride(entry) ? el("span", { class: "sys-badge" }, t("system.modified")) : null,
      pending > 0 ? el("span", { class: "sys-badge sys-badge-pending" }, t("system.pending", { count: pending })) : null,
    );
    const head = el("div", {
      class: "sys-entry-head",
      role: "button",
      tabindex: "0",
      onclick: () => toggleEntry(ns),
      onkeydown: (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleEntry(ns); }
      },
    },
      el("span", { class: "sys-entry-caret" }, open ? "▾" : "▸"),
      el("span", { class: "sys-entry-title" }, ns),
      meta,
    );
    const children = [head];
    let actions = null;
    if (open) {
      const error = state.entryErrors.get(ns);
      if (error) {
        children.push(el("div", { class: "sys-banner sys-banner-error" },
          error,
          el("button", { class: "sys-btn", type: "button", onclick: () => { state.entryErrors.delete(ns); render(); } }, t("system.dismiss")),
        ));
      }
      children.push(buildForm(entry, buildFormTree(entry.schema, workingValue(ns))));
      actions = el("div", { class: "sys-actions" });
      renderActions(entry, actions);
      children.push(actions);
    }
    refs.set(ns, { meta, actions });
    return el("section", { class: "sys-entry", "data-ns": ns }, ...children);
  }

  function renderActions(entry, container) {
    const ns = entry.ns;
    const pending = store.pendingFor(ns).length;
    const busy = state.busy.has(ns);
    const writable = store.writable;
    container.replaceChildren(
      el("button", {
        class: "sys-btn sys-btn-primary",
        type: "button",
        disabled: !writable || busy || pending === 0,
        onclick: () => saveEntry(ns),
      }, t("system.save", { count: pending })),
      el("button", {
        class: "sys-btn",
        type: "button",
        disabled: !writable || busy || pending === 0,
        onclick: () => discardEntry(ns),
      }, t("system.discard")),
      el("button", {
        class: "sys-btn sys-btn-danger",
        type: "button",
        disabled: !writable || busy,
        onclick: () => restoreEntry(ns),
      }, t("system.restore")),
    );
  }

  /**
   * Recursively build one form node (object/dict/array/leaf).
   * @param {object} entry
   * @param {object} node   A form-tree node from `buildFormTree`.
   */
  function buildForm(entry, node) {
    const ns = entry.ns;
    if (node.kind === "leaf") return buildLeafRow(entry, node);

    const label = node.key === "" ? t("system.settings") : node.key;
    const children = node.children.map((child) => {
      const inner = buildForm(entry, child);
      if (node.kind === "dict" || node.kind === "array") {
        // Each key/item gets its own labeled section with a Remove action.
        const title = el("div", { class: "sys-item-head" },
          el("span", { class: "sys-item-title" }, child.key),
          el("span", { class: "sys-item-path" }, child.path.join(".")),
          el("button", {
            class: "sys-btn sys-btn-sm",
            type: "button",
            title: t("system.removeItem"),
            disabled: !store.writable,
            onclick: () => removeItem(ns, child.path),
          }, t("system.remove")),
        );
        return el("div", { class: "sys-item", "data-path": child.path.join(".") }, title, inner);
      }
      return inner;
    });

    const addButtons = [];
    if (store.writable && (node.kind === "dict" || node.kind === "array")) {
      addButtons.push(el("button", {
        class: "sys-btn sys-btn-sm",
        type: "button",
        disabled: state.busy.has(ns),
        onclick: () => addItem(entry, node),
      }, node.kind === "dict" ? t("system.addKey") : t("system.addItem")));
    }

    return el("fieldset", { class: "sys-group sys-group-" + node.kind },
      el("legend", { class: "sys-group-label" }, label,
        node.path.length > 0 ? el("span", { class: "sys-item-path" }, " " + node.path.join(".")) : null),
      children,
      addButtons,
    );
  }

  /** Build one editable leaf row: label + control + reset + inline error. */
  function buildLeafRow(entry, leaf) {
    const ns = entry.ns;
    const path = leaf.path;
    const value = valueAt(workingValue(ns), path);
    const overridden = isOverridden(entry.user, path);
    const errorKey = leafErrorKey(ns, path);
    const error = state.leafErrors.get(errorKey);

    const label = el("label", { class: "sys-leaf-label" },
      el("span", { class: "sys-leaf-name" }, leaf.key),
      overridden ? el("span", { class: "sys-dot", title: t("system.modified") }) : null,
      leaf.secret ? el("span", { class: "sys-badge sys-badge-secret" }, t("system.secret")) : null,
    );
    const hint = el("span", { class: "sys-leaf-hint" }, buildLeafHint(entry, leaf));

    const controls = el("span", { class: "sys-leaf-controls" });
    if (leaf.secret) {
      const set = secretState(entry, path);
      controls.append(el("span", { class: "sys-secret-state" }, set ? t("system.secretSet") : t("system.secretUnset")));
      const input = el("input", {
        class: "sys-input sys-secret-input",
        type: "password",
        placeholder: t("system.secretPlaceholder"),
        autocomplete: "new-password",
        disabled: !store.writable,
        oninput: (event) => onSecretInput(ns, path, event.target.value),
      });
      controls.append(input);
      if (set) {
        controls.append(el("button", {
          class: "sys-btn sys-btn-sm",
          type: "button",
          title: t("system.resetField"),
          disabled: !store.writable,
          onclick: () => resetField(ns, path),
        }, t("system.reset")));
      }
    } else if (leaf.leafType === "literal") {
      controls.append(el("span", { class: "sys-readonly" }, formatLeaf(leaf, leaf.fixed ?? value)));
    } else if (leaf.leafType === "boolean" || leaf.leafType === "enum") {
      const options = leaf.leafType === "boolean" ? [true, false] : leaf.options;
      const select = el("select", {
        class: "sys-input sys-select",
        disabled: !store.writable,
        onchange: (event) => onLeafChange(ns, path, leaf, event.target.value, value),
      });
      for (const option of options ?? []) {
        const text = option === null ? "null" : String(option);
        const opt = el("option", { value: option === null ? "__null__" : String(option) }, text);
        if (option === null ? value === null : String(option) === String(value)) opt.setAttribute("selected", "");
        select.append(opt);
      }
      if (value !== undefined && !(options ?? []).some((o) => (o === null ? value === null : String(o) === String(value)))) {
        select.append(el("option", { value: String(value), selected: true }, String(value)));
      }
      controls.append(select);
    } else if (leaf.leafType === "json") {
      const textarea = el("textarea", {
        class: "sys-input sys-textarea",
        rows: 4,
        disabled: !store.writable,
        oninput: (event) => onLeafInput(ns, path, leaf, event.target.value, value),
      });
      textarea.value = formatLeaf(leaf, value);
      controls.append(textarea);
    } else {
      const input = el("input", {
        class: "sys-input",
        type: leaf.leafType === "number" ? "number" : "text",
        value: formatLeaf(leaf, value),
        disabled: !store.writable,
        oninput: (event) => onLeafInput(ns, path, leaf, event.target.value, value),
      });
      controls.append(input);
    }

    const rowChildren = [label, controls, hint];
    if (overridden && !leaf.secret && leaf.leafType !== "literal") {
      rowChildren.push(el("button", {
        class: "sys-btn sys-btn-sm",
        type: "button",
        title: t("system.resetField"),
        disabled: !store.writable,
        onclick: () => resetField(ns, path),
      }, t("system.reset")));
    }
    if (error) rowChildren.push(el("span", { class: "sys-leaf-error" }, error));

    const row = el("div", { class: "sys-leaf", "data-path": path.join(".") }, ...rowChildren);
    leafRefs.set(leafErrorKey(ns, path), row);
    return row;
  }

  /** A one-line "default: …" hint for a leaf (only when it differs). */
  function buildLeafHint(entry, leaf) {
    const baseValue = valueAt(entry.base, leaf.path);
    if (baseValue === undefined) return "";
    if (leaf.leafType === "literal") return "";
    const text = leaf.leafType === "json" ? JSON.stringify(baseValue) : String(baseValue);
    if (text === "") return t("system.defaultEmpty");
    return t("system.default", { value: text.length > 80 ? text.slice(0, 77) + "…" : text });
  }

  // ------------------------------------------------------------- actions

  function toggleEntry(ns) {
    if (state.expanded.has(ns)) state.expanded.delete(ns);
    else state.expanded.add(ns);
    render();
  }

  /** Parse text editor input; stage on success, inline error on failure. */
  function onLeafInput(ns, path, leaf, text, currentValue) {
    const parsed = parseLeaf(leaf.leafType, text);
    const errorKey = leafErrorKey(ns, path);
    const row = leafRowOf(ns, path);
    if (!parsed.ok) {
      const previous = state.leafErrors.get(errorKey);
      if (previous !== parsed.error) {
        state.leafErrors.set(errorKey, parsed.error);
        updateLeafError(row, parsed.error);
      }
      return;
    }
    if (state.leafErrors.has(errorKey)) {
      state.leafErrors.delete(errorKey);
      updateLeafError(row, null);
    }
    const same = JSON.stringify(parsed.value) === JSON.stringify(currentValue);
    if (same) store.unstage(ns, path);
    else store.stageSet(ns, path, parsed.value);
  }

  function onLeafChange(ns, path, leaf, text, currentValue) {
    let value;
    if (leaf.leafType === "boolean") value = text === "true";
    else if (text === "__null__") value = null;
    else value = text;
    const errorKey = leafErrorKey(ns, path);
    state.leafErrors.delete(errorKey);
    if (JSON.stringify(value) === JSON.stringify(currentValue)) store.unstage(ns, path);
    else store.stageSet(ns, path, value);
  }

  function onSecretInput(ns, path, text) {
    if (text === "") {
      const pending = store.pendingFor(ns).find((edit) => edit.path.length === path.length && edit.path.every((s, i) => s === path[i]));
      if (pending) store.unstage(ns, path);
      return;
    }
    store.stageSet(ns, path, text);
  }

  function updateLeafError(row, message) {
    if (!row) return;
    const existing = row.querySelector(".sys-leaf-error");
    if (message === null) {
      existing?.remove();
      return;
    }
    if (existing) existing.replaceChildren(message);
    else row.append(el("span", { class: "sys-leaf-error" }, message));
  }

  /** The leaf row element for a path (registered at build time) — for targeted error updates. */
  function leafRowOf(ns, path) {
    return leafRefs.get(leafErrorKey(ns, path)) ?? null;
  }

  function resetField(ns, path) {
    state.leafErrors.delete(leafErrorKey(ns, path));
    store.stageUnset(ns, path);
    render();
  }

  function removeItem(ns, path) {
    if (!confirmText(t("system.removeConfirm", { path: path.join(".") }))) return;
    store.stageUnset(ns, path);
    render();
  }

  /** Stage a new dict key / array item with a starter value, then re-render. */
  function addItem(entry, node) {
    const ns = entry.ns;
    if (node.kind === "dict") {
      const key = promptText(t("system.addKeyPrompt"));
      if (!key || key.trim() === "") return;
      const name = key.trim();
      store.stageSet(ns, [...node.path, name], {});
    } else {
      const value = valueAt(workingValue(ns), node.path);
      const index = Array.isArray(value) ? value.length : 0;
      store.stageSet(ns, [...node.path, String(index)], node.children.length > 0 ? {} : null);
    }
    render();
  }

  function discardEntry(ns) {
    store.clearPending(ns);
    for (const key of [...state.leafErrors.keys()]) {
      if (key.startsWith(`${ns}\u0000`)) state.leafErrors.delete(key);
    }
    render();
  }

  async function saveEntry(ns) {
    if (state.busy.has(ns)) return;
    state.busy.add(ns);
    state.entryErrors.delete(ns);
    renderActionsFor(ns);
    try {
      await store.save(ns);
    } catch (error) {
      state.entryErrors.set(ns, error.message ?? String(error));
    } finally {
      state.busy.delete(ns);
    }
    render();
  }

  async function restoreEntry(ns) {
    if (!confirmText(t("system.restoreConfirm", { ns }))) return;
    if (state.busy.has(ns)) return;
    state.busy.add(ns);
    state.entryErrors.delete(ns);
    renderActionsFor(ns);
    try {
      await store.restoreAll(ns);
    } catch (error) {
      state.entryErrors.set(ns, error.message ?? String(error));
    } finally {
      state.busy.delete(ns);
    }
    render();
  }

  /** Refresh just the action row for an entry (while a write is in flight). */
  function renderActionsFor(ns) {
    const entry = store.entry(ns);
    const ref = refs.get(ns);
    if (entry && ref?.actions) renderActions(entry, ref.actions);
  }

  // ------------------------------------------------------------ lifecycle

  function start() {
    if (mounted) return;
    mounted = true;
    root = container;
    buildShell();
    // load() flips the state to "loading" synchronously, so the very first
    // render already shows the loading state (not a spurious empty list).
    void store.load();
    render();
    unsubscribe = store.subscribe((_state, reason) => {
      if (reason === "load") render();
      else if (reason === "stage") {
        for (const entry of store.entries()) updateEntryMeta(entry.ns);
      }
    });
    if (typeof adapter.onDocumentUpdated === "function") {
      docDisposer = adapter.onDocumentUpdated(() => {
        void store.load();
      });
    }
  }

  function unmount() {
    if (!mounted) return;
    mounted = false;
    unsubscribe?.();
    unsubscribe = null;
    docDisposer?.();
    docDisposer = null;
    refs.clear();
    leafRefs.clear();
    shell = null;
    bodyRef = null;
    root?.replaceChildren();
    root = null;
  }

  start();
  return { store, unmount };
}
