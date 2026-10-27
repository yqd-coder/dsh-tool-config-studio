/**
 * Minimal i18n for the Tool Config Studio UI.
 *
 * Dictionaries ship as plain JSON (locale/en.json, locale/zh.json) so they
 * follow the same convention as other DSH client plugins. Lookups fall back
 * to English, then to the key itself, so a missing translation can never
 * render as a crash. `t` supports simple `{var}` interpolation.
 */

import en from "../../locale/en.json" with { type: "json" };
import zh from "../../locale/zh.json" with { type: "json" };

const DICTS = { en, zh };

/**
 * Guess the UI language from the environment (browser or Node with a
 * LANG/LANGUAGE hint); defaults to English.
 * @returns {"en"|"zh"}
 */
export function detectLanguage() {
  let language = "";
  if (typeof navigator !== "undefined" && navigator.language) {
    language = navigator.language;
  } else if (typeof process !== "undefined" && process.env) {
    language = process.env.LANG || process.env.LANGUAGE || "";
  }
  return language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function lookup(dict, key) {
  const parts = key.split(".");
  let node = dict;
  for (const part of parts) {
    if (node === null || typeof node !== "object" || !Object.hasOwn(node, part)) return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * @param {"en"|"zh"} [language]
 * @returns {{
 *   lang: string,
 *   t: (key: string, vars?: Record<string, unknown>) => string,
 *   categoryLabel: (id: string, fallback?: string) => string,
 * }}
 */
export function createI18n(language = "en") {
  const lang = Object.hasOwn(DICTS, language) ? language : "en";

  /**
   * Translate a dotted key, substituting `{name}` placeholders.
   * @param {string} key
   * @param {Record<string, unknown>} [vars]
   */
  const t = (key, vars = {}) => {
    let text = lookup(DICTS[lang], key) ?? lookup(en, key) ?? key;
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
    return text;
  };

  /** Localized category label, falling back to the catalog label. */
  const categoryLabel = (id, fallback) =>
    lookup(DICTS[lang], `categories.${id}`) ?? fallback ?? id;

  return { lang, t, categoryLabel };
}
