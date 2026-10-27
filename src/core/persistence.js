/**
 * Persistence for saved tool configuration.
 *
 * The core store is pure in-memory; this module adds a thin, safe
 * Web-Storage adapter so the UI layer can survive reloads. It never throws
 * (quota errors, private-mode restrictions, or a missing localStorage are
 * all tolerated by degrading to in-memory-only mode), and it stamps the
 * document with the schema version so future formats can be rejected.
 */

import { SCHEMA_VERSION } from "./store.js";

/** Default storage key, namespaced to this plugin. */
export const DEFAULT_STORAGE_KEY = "dsh-tool-config-studio.v1";

/**
 * @typedef {{
 *   load: () => object | null,
 *   save: (json: object) => boolean,
 *   clear: () => void,
 * }} LocalPersistence
 */

/**
 * Create a localStorage-backed persistence handle.
 *
 * @param {{getItem: Function, setItem: Function, removeItem: Function}} [storage]
 *   Injected for tests; defaults to `globalThis.localStorage`.
 * @param {string} [key] Storage key; defaults to {@link DEFAULT_STORAGE_KEY}.
 * @returns {LocalPersistence}
 */
export function createLocalPersistence(storage, key = DEFAULT_STORAGE_KEY) {
  const backing = storage ?? (typeof globalThis !== "undefined" ? globalThis.localStorage : null);

  /** Sentinel returned by `safe` when the storage call threw. */
  const FAILED = Symbol("persistence.failed");

  const safe = (fn) => {
    try {
      return fn();
    } catch {
      return FAILED;
    }
  };

  return {
    /**
     * Load and validate the saved document. Returns `null` when nothing is
     * saved, the entry is unreadable, or it was written by an incompatible
     * version (in which case the old entry is removed).
     */
    load() {
      if (!backing) return null;
      const raw = safe(() => backing.getItem(key));
      if (raw === FAILED || typeof raw !== "string" || raw.length === 0) return null;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        safe(() => backing.removeItem(key));
        return null;
      }
      if (
        !parsed ||
        typeof parsed !== "object" ||
        parsed.schemaVersion !== SCHEMA_VERSION ||
        typeof parsed.tools !== "object" ||
        parsed.tools === null
      ) {
        safe(() => backing.removeItem(key));
        return null;
      }
      return parsed;
    },

    /**
     * Persist a document produced by `store.toJSON()`.
     * @returns {boolean} true when the write succeeded.
     */
    save(json) {
      if (!backing) return false;
      return safe(() => backing.setItem(key, JSON.stringify(json))) !== FAILED;
    },

    /** Remove the saved document. */
    clear() {
      if (!backing) return;
      safe(() => backing.removeItem(key));
    },
  };
}
