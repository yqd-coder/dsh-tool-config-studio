/**
 * SystemPluginStore: the client-side model for the `settings` remote namespace.
 *
 * It wraps a minimal adapter (the shape of `ctx.remote.settings`) and owns the
 * latest `describe()` snapshot plus per-entry *pending edits*. Writes are
 * revision-protected: every mutation sends back the `revision` the snapshot was
 * read at, so a concurrent change (another tab, the official settings UI) is
 * refused by the Host instead of silently clobbered.
 *
 * The store is pure in-memory and dependency-free; it is exercised under
 * `node --test` with a fake adapter.
 *
 * Adapter contract (mirrors `ctx.remote.settings`):
 *   describe()                          -> Promise<{ok, value?, error?}>
 *   mutate(ns, ops, expectedRevision)   -> Promise<{ok, value?, error?}>
 *   replace(ns, section, expectedRev)   -> Promise<{ok, value?, error?}>
 *
 * Every result is an envelope: `{ ok: true, value }` or `{ ok: false, error }`,
 * where `error` is `{ code, message }`.
 */

/** Unwrap a settings remote envelope or throw a SettingsRemoteError. */
function unwrap(envelope, label) {
  if (!envelope || typeof envelope !== "object") {
    throw new SettingsRemoteError(label, "malformed", `${label}: the Host returned an empty response`);
  }
  if (envelope.ok) return envelope.value;
  const error = envelope.error ?? {};
  throw new SettingsRemoteError(label, error.code ?? "unknown", error.message ?? `${label} failed`);
}

/**
 * Error raised when a settings read or write is refused or fails. `code`
 * carries the Host's remote error code (e.g. a revision conflict).
 */
export class SettingsRemoteError extends Error {
  /**
   * @param {string} label  Human label of the operation (for the message).
   * @param {string} code   Host error code.
   * @param {string} message
   */
  constructor(label, code, message) {
    super(message || `${label} failed (${code})`);
    this.name = "SettingsRemoteError";
    this.code = code;
  }
}

/** Stable string key for a leaf path (JSON is unambiguous for string arrays). */
export function pathKey(path) {
  return JSON.stringify(path);
}

/**
 * Turn a pending-edits map into ordered settings ops.
 *
 * @param {Map<string, {kind: "set"|"unset", path: string[], value?: unknown}>} pending
 * @returns {Array<{op: "set"|"unset", path: string[], value?: unknown}>}
 */
export function pendingToOps(pending) {
  const ops = [];
  for (const edit of pending.values()) {
    if (edit.kind === "set") ops.push({ op: "set", path: edit.path, value: edit.value });
    else ops.push({ op: "unset", path: edit.path });
  }
  return ops;
}

const INITIAL_STATE = Object.freeze({
  status: "idle", // idle | loading | ready | error
  writable: true,
  hasDocument: false,
  entries: [],
  error: null,
});

export class SystemPluginStore {
  /** @type {object} */
  #adapter;
  /** @type {Set<function>} */
  #listeners = new Set();
  /** @type {object} */
  #state = INITIAL_STATE;
  /** Monotonic token guarding against stale async loads. */
  #loadToken = 0;
  /** @type {Map<string, Map<string, {kind, path, value?}>>} ns -> pathKey -> edit */
  #pending = new Map();

  /**
   * @param {object} adapter  The settings remote adapter (see module docs).
   */
  constructor(adapter) {
    if (!adapter || typeof adapter.describe !== "function") {
      throw new Error("SystemPluginStore: adapter.describe() is required");
    }
    this.#adapter = adapter;
  }

  // ------------------------------------------------------------------ reads

  /** A frozen view of the current state. */
  get state() {
    return this.#state;
  }

  /** The entry view for a namespace id, or `undefined`. */
  entry(ns) {
    return this.#state.entries.find((entry) => entry.ns === ns);
  }

  /** All entry views, in the order the Host reported them. */
  entries() {
    return this.#state.entries;
  }

  /** Whether a write is possible at all (the profile accepts writes). */
  get writable() {
    return this.#state.writable;
  }

  /** The pending edits for one entry, as an array (stable order). */
  pendingFor(ns) {
    return [...(this.#pending.get(ns)?.values() ?? [])];
  }

  /** True when the entry has at least one staged edit. */
  hasPending(ns) {
    return (this.#pending.get(ns)?.size ?? 0) > 0;
  }

  /**
   * Subscribe to state changes.
   *
   * The listener receives `(state, reason)` where `reason` is:
   *   "load"    – the snapshot (re)loaded; the UI should re-render.
   *   "stage"   – a pending edit was staged/cleared; the UI should refresh
   *               its Save control only (inputs must NOT be rebuilt, or the
   *               caret/focus would be lost while typing).
   *   "save"/"restore" – pending cleared after a write; a "load" follows.
   *
   * @param {(state: object, reason: string) => void} listener
   * @returns {() => void} Unsubscribe.
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  // --------------------------------------------------------------- mutations

  /**
   * Stage a leaf for a new value (emitted as a `set` op on save).
   * @param {string} ns
   * @param {string[]} path
   * @param {unknown} value
   */
  stageSet(ns, path, value) {
    this.#stage(ns, path, { kind: "set", path, value });
  }

  /**
   * Stage a leaf to reset to its system default (emitted as an `unset` op on
   * save; the Host resolves the inherited value for the path).
   * @param {string} ns
   * @param {string[]} path
   */
  stageUnset(ns, path) {
    this.#stage(ns, path, { kind: "unset", path });
  }

  /** Drop a staged edit (the leaf returns to its current value). */
  unstage(ns, path) {
    const map = this.#pending.get(ns);
    if (!map) return;
    const key = pathKey(path);
    if (!map.has(key)) return;
    map.delete(key);
    if (map.size === 0) this.#pending.delete(ns);
    this.#emit("stage");
  }

  /** Drop every staged edit for one entry. */
  clearPending(ns) {
    if (this.#pending.delete(ns)) this.#emit("stage");
  }

  #stage(ns, path, edit) {
    let map = this.#pending.get(ns);
    if (!map) {
      map = new Map();
      this.#pending.set(ns, map);
    }
    map.set(pathKey(path), edit);
    this.#emit("stage");
  }

  // ------------------------------------------------------------------ writes

  /**
   * Load (or reload) the settings snapshot from the Host.
   * @returns {Promise<void>}
   */
  async load() {
    const token = ++this.#loadToken;
    this.#patch({ status: "loading", error: null }, "load");
    try {
      const value = unwrap(await this.#adapter.describe(), "describe");
      if (token !== this.#loadToken) return; // a newer load superseded this one
      this.#state = {
        ...this.#state,
        status: "ready",
        writable: value.writable !== false,
        hasDocument: Boolean(value.hasDocument),
        entries: Array.isArray(value.entries) ? value.entries : [],
        error: null,
      };
      this.#emit("load");
    } catch (error) {
      if (token !== this.#loadToken) return;
      this.#patch({ status: "error", error: error.message ?? String(error) }, "load");
    }
  }

  /**
   * Flush the pending edits for one entry as a single `mutate` call.
   * On success the snapshot is reloaded (the Host also emits
   * `settings/document-updated`, which the app may use as a backstop).
   *
   * @param {string} ns
   * @returns {Promise<void>}
   */
  async save(ns) {
    const ops = pendingToOps(this.#pending.get(ns) ?? new Map());
    if (ops.length === 0) return;
    const entry = this.entry(ns);
    if (!entry) throw new SettingsRemoteError("save", "unknown-entry", `unknown settings entry "${ns}"`);
    try {
      unwrap(await this.#adapter.mutate(ns, ops, entry.revision), `mutate(${ns})`);
    } catch (error) {
      // A refused write (often a revision conflict): resync so the UI shows
      // the Host's current state, then surface the error to the caller.
      void this.load();
      throw error;
    }
    this.#pending.delete(ns);
    this.#emit("save");
    await this.load();
  }

  /**
   * Restore one entry to its system defaults: a `replace` with an empty
   * section, which the Host resolves to the value beneath the profile
   * override (the composition base, schema defaults included).
   *
   * @param {string} ns
   * @returns {Promise<void>}
   */
  async restoreAll(ns) {
    const entry = this.entry(ns);
    if (!entry) throw new SettingsRemoteError("restore", "unknown-entry", `unknown settings entry "${ns}"`);
    try {
      unwrap(await this.#adapter.replace(ns, {}, entry.revision), `replace(${ns})`);
    } catch (error) {
      void this.load();
      throw error;
    }
    this.#pending.delete(ns);
    this.#emit("restore");
    await this.load();
  }

  // ------------------------------------------------------------------ misc

  #patch(patch, reason) {
    this.#state = { ...this.#state, ...patch };
    this.#emit(reason);
  }

  #emit(reason = "change") {
    for (const listener of this.#listeners) listener(this.#state, reason);
  }
}
