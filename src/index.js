/**
 * Host loader entry for the browser-only Tool Config Studio plugin.
 *
 * Every piece of behavior in this plugin runs in the browser through the
 * `./client` entry, so the host loader has nothing to do at composition
 * time. This matches the convention of other client-only DSH plugins.
 */
export function apply() {}
