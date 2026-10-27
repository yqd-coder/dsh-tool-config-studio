/**
 * Host loader entry (published shim).
 *
 * DSH resolves the plugin's host entry from `lib/index.js`; the
 * implementation lives in `src/index.js` and is re-exported here.
 */
export { apply } from "../src/index.js";
