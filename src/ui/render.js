/**
 * DOM rendering for the Tool Config Studio.
 *
 * These are pure builders: each function takes a store, an i18n bundle, the
 * current view state, and an `api` of callbacks, and returns detached DOM
 * nodes. Nothing here mutates state directly — every user action goes
 * through the api, which makes the view trivially re-renderable and the
 * module safe to unit-test in any DOM environment.
 */

import { listCategories, listTools, TOOL_COUNT, CATALOG_SCHEMA_VERSION } from "../core/catalog.js";

/**
 * Tiny DOM builder: el("div", { class: "x", onclick: fn }, child1, "text").
 * @param {string} tag
 * @param {object} [props]
 * @param {...(Node|string|number|null|undefined)} children
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "on" && typeof value === "function") node.addEventListener(value.name ?? "change", value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (key === "value") node.value = value;
    else if (key === "checked") node.checked = value;
    else if (key === "disabled") node.disabled = value;
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Stable map key for per-parameter view state (e.g. validation errors). */
export function paramKey(toolName, paramName) {
  return `${toolName}.${paramName}`;
}

function typeLabel(type) {
  return type;
}

// --------------------------------------------------------------------- shell

/**
 * Build the static application shell (header, main, footer).
 *
 * @param {{i18n: object, api: object}} ctx
 * @returns {{node: HTMLElement, refs: {search: HTMLInputElement, list: HTMLElement, count: HTMLElement, footer: HTMLElement}}}
 */
export function buildShell(ctx) {
  const { i18n, api } = ctx;
  const search = el("input", {
    class: "tcs-search",
    type: "search",
    placeholder: i18n.t("list.searchPlaceholder"),
    oninput: (event) => api.setQuery(event.target.value),
    "aria-label": i18n.t("list.searchPlaceholder"),
  });

  const node = el(
    "div",
    { class: "tcs" },
    el(
      "header",
      { class: "tcs-header" },
      el(
        "div",
        { class: "tcs-title-block" },
        el("h1", { class: "tcs-title" }, "⚙ ", i18n.t("app.title")),
        el("p", { class: "tcs-subtitle" }, i18n.t("app.subtitle")),
      ),
      el(
        "div",
        { class: "tcs-header-actions" },
        search,
        el(
          "button",
          {
            class: "tcs-btn tcs-btn-danger",
            type: "button",
            onclick: api.restoreAll,
          },
          i18n.t("actions.restoreAll"),
        ),
      ),
    ),
    el(
      "main",
      { class: "tcs-main" },
      el("div", { class: "tcs-count" }, "…"),
      el("div", { class: "tcs-list" }),
    ),
    el("footer", { class: "tcs-footer" }, "…"),
  );

  const main = node.querySelector(".tcs-main");
  return {
    node,
    refs: {
      search,
      count: main.querySelector(".tcs-count"),
      list: main.querySelector(".tcs-list"),
      footer: node.querySelector(".tcs-footer"),
    },
  };
}

// ---------------------------------------------------------------------- list

/**
 * Replace the list with one section per category (filtered).
 *
 * @param {HTMLElement} container
 * @param {{i18n: object, store: object, state: object, api: object}} ctx
 */
export function renderList(container, ctx) {
  const { i18n, state } = ctx;
  const query = state.query.trim().toLowerCase();
  const sections = [];
  const allTools = listTools();

  let shown = 0;
  for (const category of listCategories()) {
    const tools = allTools.filter((tool) => {
      if (tool.category !== category.id) return false;
      if (!query) return true;
      const haystack = [
        tool.name,
        tool.title,
        tool.summary,
        i18n.categoryLabel(category.id, category.label),
        ...tool.parameters.map((param) => param.name),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
    if (tools.length === 0) continue;
    shown += tools.length;

    sections.push(
      el(
        "section",
        { class: "tcs-group" },
        el(
          "h2",
          { class: "tcs-group-title" },
          i18n.categoryLabel(category.id, category.label),
          el("span", { class: "tcs-group-count" }, String(tools.length)),
        ),
        ...tools.map((tool) => toolBlock(tool, ctx)),
      ),
    );
  }

  const content = sections.length
    ? sections
    : [
        el(
          "div",
          { class: "tcs-empty" },
          el("p", {}, i18n.t("list.noResults", { query: state.query.trim() })),
        ),
      ];
  container.replaceChildren(...content);
  return shown;
}

function toolBlock(tool, ctx) {
  const { i18n, store, state, api } = ctx;
  const expanded = state.expanded.has(tool.name);
  const configurable = tool.parameters.filter((param) => param.configurable).length;

  const row = el(
    "div",
    {
      class: `tcs-tool${expanded ? " is-expanded" : ""}`,
      role: "button",
      tabindex: "0",
      "aria-expanded": String(expanded),
      onclick: () => api.toggleTool(tool.name),
      onkeydown: (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          api.toggleTool(tool.name);
        }
      },
    },
    el(
      "div",
      { class: "tcs-tool-main" },
      el("code", { class: "tcs-tool-name" }, tool.name),
      el("div", { class: "tcs-tool-text" },
        el("span", { class: "tcs-tool-title" }, tool.title),
        el("span", { class: "tcs-tool-summary" }, tool.summary),
      ),
    ),
    el("div", { class: "tcs-tool-meta" },
      configurable > 0
        ? el("span", { class: "tcs-chip" }, i18n.t("list.configurableCount", { count: configurable }))
        : null,
      el(
        "span",
        { class: `tcs-pill ${store.isEnabled(tool.name) ? "tcs-pill-on" : "tcs-pill-off"}` },
        store.isEnabled(tool.name) ? i18n.t("status.enabled") : i18n.t("status.disabled"),
      ),
      store.isModified(tool.name)
        ? el("span", { class: "tcs-chip tcs-chip-modified" }, i18n.t("list.modified"))
        : null,
      el("span", { class: "tcs-chevron", "aria-hidden": "true" }, "▸"),
    ),
  );

  if (!expanded) return row;

  return el("div", { class: "tcs-tool-wrap" }, row, el("div", { class: "tcs-detail" }, detailBody(tool, ctx)));
}

// -------------------------------------------------------------------- detail

function detailBody(tool, ctx) {
  const { i18n, store, api } = ctx;
  const configurable = tool.parameters.filter((param) => param.configurable);
  const perCall = tool.parameters.filter((param) => !param.configurable);

  const parts = [
    el(
      "div",
      { class: "tcs-enabled-row" },
      el(
        "label",
        { class: "tcs-switch" },
        el("input", {
          type: "checkbox",
          checked: store.isEnabled(tool.name),
          onchange: (event) => api.setEnabled(tool.name, event.target.checked),
          "aria-label": i18n.t("detail.enabled"),
        }),
        el("span", { class: "tcs-switch-track" }, el("span", { class: "tcs-switch-thumb" })),
        el("span", { class: "tcs-switch-label" }, i18n.t("detail.enabled")),
      ),
      el("p", { class: "tcs-detail-summary" }, tool.summary),
    ),
  ];

  if (configurable.length > 0) {
    parts.push(el("h3", { class: "tcs-section" }, i18n.t("detail.storedDefaults")));
    parts.push(el("div", { class: "tcs-params" }, ...configurable.map((param) => paramRow(tool, param, ctx))));
  } else {
    parts.push(el("p", { class: "tcs-muted" }, i18n.t("detail.noStored")));
  }

  if (perCall.length > 0) {
    parts.push(el("h3", { class: "tcs-section" }, i18n.t("detail.perCall")));
    parts.push(el("div", { class: "tcs-params tcs-params-readonly" }, ...perCall.map((param) => readOnlyParamRow(tool, param, ctx))));
  } else if (tool.parameters.length === 0) {
    parts.push(el("p", { class: "tcs-muted" }, i18n.t("detail.noPerCall")));
  }

  if (store.isModified(tool.name)) {
    parts.push(
      el(
        "div",
        { class: "tcs-detail-actions" },
        el(
          "button",
          { class: "tcs-btn tcs-btn-danger-soft", type: "button", onclick: () => api.restoreTool(tool.name) },
          "↺ ",
          i18n.t("actions.restoreTool"),
        ),
      ),
    );
  }

  return parts;
}

function paramHint(i18n, param) {
  const parts = [
    param.description,
    param.default === null ? i18n.t("param.defaultUnset") : i18n.t("param.default", { value: String(param.default) }),
  ];
  if (param.min !== null) parts.push(i18n.t("param.min", { n: param.min }));
  return parts.filter(Boolean).join(" · ");
}

function paramRow(tool, param, ctx) {
  const { i18n, store, state, api } = ctx;
  const key = paramKey(tool.name, param.name);
  const effective = store.effectiveParam(tool.name, param.name);
  const overridden = store.hasParamOverride(tool.name, param.name);
  const error = state.errors.get(key);

  return el(
    "div",
    { class: `tcs-param${overridden ? " is-modified" : ""}`, dataset: { param: param.name } },
    el(
      "div",
      { class: "tcs-param-head" },
      el("code", { class: "tcs-param-name" }, param.name),
      el("span", { class: "tcs-param-type" }, typeLabel(param.type)),
      overridden ? el("span", { class: "tcs-chip tcs-chip-modified" }, i18n.t("list.modified")) : null,
    ),
    el(
      "div",
      { class: "tcs-param-body" },
      paramEditor(tool, param, effective, ctx),
      overridden
        ? el(
            "button",
            { class: "tcs-btn tcs-btn-ghost", type: "button", onclick: () => api.resetParam(tool.name, param.name) },
            i18n.t("actions.reset"),
          )
        : null,
    ),
    el("div", { class: "tcs-param-hint" }, paramHint(i18n, param)),
    error ? el("div", { class: "tcs-param-error", role: "alert" }, error) : null,
  );
}

function paramEditor(tool, param, effective, ctx) {
  const { i18n, api } = ctx;

  if (param.type === "boolean") {
    return el(
      "label",
      { class: "tcs-editor tcs-editor-bool" },
      el("input", {
        type: "checkbox",
        checked: effective === true,
        onchange: (event) => api.setParam(tool.name, param.name, event.target.checked),
      }),
      el("code", {}, effective === true ? "true" : "false"),
    );
  }

  if (param.type === "number") {
    return el("input", {
      class: "tcs-editor tcs-editor-text",
      type: "number",
      step: "any",
      min: param.min !== null ? String(param.min) : undefined,
      value: effective === null ? "" : String(effective),
      placeholder: i18n.t("editor.unset"),
      onchange: (event) => {
        const raw = event.target.value.trim();
        if (raw === "") {
          api.setParam(tool.name, param.name, null);
          return;
        }
        const value = Number(raw);
        api.setParam(tool.name, param.name, Number.isFinite(value) ? value : raw);
      },
    });
  }

  if (param.type === "string" && param.enumValues) {
    const options = [
      el("option", { value: "" }, i18n.t("editor.unset")),
      ...param.enumValues.map((value) => el("option", { value }, value)),
    ];
    return el(
      "select",
      {
        class: "tcs-editor tcs-editor-select",
        value: effective === null ? "" : String(effective),
        onchange: (event) => api.setParam(tool.name, param.name, event.target.value === "" ? null : event.target.value),
      },
      ...options,
    );
  }

  if (param.type === "string") {
    return el("input", {
      class: "tcs-editor tcs-editor-text",
      type: "text",
      value: effective === null ? "" : String(effective),
      placeholder: i18n.t("editor.unset"),
      onchange: (event) => {
        const raw = event.target.value.trim();
        api.setParam(tool.name, param.name, raw === "" ? null : raw);
      },
    });
  }

  // array / object: shown read-only (the current catalog declares no
  // configurable parameters of these types).
  return el("code", { class: "tcs-editor tcs-editor-readonly" }, JSON.stringify(effective ?? null));
}

function readOnlyParamRow(tool, param, ctx) {
  const { i18n } = ctx;
  return el(
    "div",
    { class: "tcs-param tcs-param-readonly" },
    el(
      "div",
      { class: "tcs-param-head" },
      el("code", { class: "tcs-param-name" }, param.name),
      el("span", { class: "tcs-param-type" }, typeLabel(param.type)),
      param.required
        ? el("span", { class: "tcs-chip tcs-chip-required" }, i18n.t("param.required"))
        : null,
    ),
    el("div", { class: "tcs-param-hint" }, [param.description, i18n.t("param.readOnly")].filter(Boolean).join(" · ")),
  );
}

// -------------------------------------------------------------------- footer

/**
 * @param {HTMLElement} container
 * @param {{i18n: object, store: object}} ctx
 * @param {number} version - Catalog schema version.
 */
export function renderFooter(container, ctx, version, toolCount) {
  const { i18n, store } = ctx;
  const summary = store.modifiedSummary();
  const status =
    summary.tools === 0 && summary.params === 0
      ? i18n.t("status.allDefaults")
      : i18n.t("status.customized", { tools: summary.tools, params: summary.params });

  container.replaceChildren(
    el("span", { class: "tcs-footer-status" }, status),
    el("span", { class: "tcs-footer-muted" }, i18n.t("app.version", { version })),
    el("span", { class: "tcs-footer-muted" }, i18n.t("list.toolsCount", { count: toolCount })),
  );
}

/**
 * Header counter line: "N tools" or "N / M tools" while filtering.
 * @param {HTMLElement} container
 * @param {{i18n: object}} ctx
 * @param {number} shown
 * @param {number} total
 */
export function renderCount(container, ctx, shown, total) {
  const { i18n } = ctx;
  container.replaceChildren(
    shown === total
      ? i18n.t("list.toolsCount", { count: total })
      : `${i18n.t("list.toolsCount", { count: shown })} / ${total}`,
  );
}
