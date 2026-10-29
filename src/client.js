/**
 * Client entry for the Tool Config Studio plugin.
 *
 * This is the browser-facing surface of the plugin: it assembles the tool
 * catalog, the configuration store (hydrated from localStorage when
 * available), the i18n bundle, and the DOM application, then mounts them
 * into a container element.
 *
 * Standalone usage (see demo/index.html). Import this ESM source directly —
 * the package's `./client` export is the built DSH module bundle (a browser
 * classic script), while `/src/client.js` stays plain ESM for embedding:
 *
 *   import { mountToolConfigStudio } from "dsh-tool-config-studio/src/client.js";
 *   const handle = mountToolConfigStudio(document.getElementById("app"));
 *   // ... later:
 *   handle.unmount();
 */

import { createToolConfigApp } from "./ui/app.js";
import { createLocalPersistence } from "./core/persistence.js";
import { ToolConfigStore } from "./core/store.js";
import { createI18n, detectLanguage } from "./ui/i18n.js";
// The mini-bundler's graph collector only follows `import` statements (not
// `export … from`), so this binding — reused verbatim by the re-export below —
// is what pulls the System Plugin Studio modules into the bundle.
import { mountSystemPluginStudio } from "./system/app.js";

/** Stable plugin id, as it appears in the catalog and storage keys. */
export const PLUGIN_ID = "dsh-tool-config-studio";

/**
 * Mount the Tool Config Studio into a container element.
 *
 * @param {HTMLElement} container - Element to render into.
 * @param {object} [options]
 * @param {ToolConfigStore} [options.store] - Pre-built store (tests, DSH host wiring).
 * @param {import("./core/persistence.js").LocalPersistence} [options.persistence] -
 *   Custom persistence (defaults to localStorage under the plugin's key).
 * @param {object} [options.i18n] - Pre-built i18n bundle from `createI18n`.
 * @param {"en"|"zh"} [options.language] - UI language; defaults to auto-detect.
 * @returns {{
 *   store: ToolConfigStore,
 *   app: ReturnType<typeof createToolConfigApp>,
 *   unmount: () => void,
 * }}
 */
export function mountToolConfigStudio(container, options = {}) {
  if (!container) throw new Error("mountToolConfigStudio: a container element is required");

  const persistence = options.persistence ?? createLocalPersistence();
  const store = options.store ?? ToolConfigStore.fromJSON(persistence.load());
  const i18n = options.i18n ?? createI18n(options.language ?? detectLanguage());

  const app = createToolConfigApp({ root: container, store, i18n });
  app.mount();

  const unsubscribe = store.subscribe(() => {
    persistence.save(store.toJSON());
  });

  return {
    store,
    app,
    /** Remove the UI and stop persisting. The store itself stays usable. */
    unmount() {
      unsubscribe();
      app.unmount();
    },
  };
}

// Public surface: the whole core plus the app factory, so a host (or a
// test) can compose the pieces differently from `mountToolConfigStudio`.
export * from "./core/catalog.js";
export * from "./core/store.js";
export * from "./core/validate.js";
export * from "./core/persistence.js";
export { createToolConfigApp } from "./ui/app.js";
export { createI18n, detectLanguage } from "./ui/i18n.js";

// System Plugin Studio: the mount function plus its core (schema walker and
// settings store), so a host or test can compose them independently.
export { mountSystemPluginStudio } from "./system/app.js";
export * from "./system/schema.js";
export * from "./system/store.js";
