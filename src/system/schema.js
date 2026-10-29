/**
 * Schema walker for the System Plugin Studio.
 *
 * The `settings/describe` remote returns, for every volatile plugin entry, a
 * `schema` field that is the plugin's *volatile* Config schema serialized with
 * schemastery's `schema.toJSON()`. That envelope is not standard JSON Schema;
 * it has its own shape:
 *
 *   { type, dict?, inner?, list?, meta? { default, required, role } }
 *
 *   type "object"    -> dict: { key: childNode }
 *   type "dict"      -> inner: childNode            (a map, dynamic keys)
 *   type "array"     -> inner: childNode            (a list)
 *   type "union"     -> list: [childNode]
 *   type "intersect" -> list: [childNode]
 *   type "transform" -> inner: childNode
 *   type "literal"   -> value: the literal
 *   otherwise        -> a primitive (string/number/boolean/null/…)
 *
 * `walk` projects that envelope, against a concrete value, into a renderable
 * tree the DOM layer can draw as a form. It is pure and dependency-free so it
 * runs under `node --test`.
 */

/** True when the node is a plain object the walker may recurse into. */
function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Read a node's `meta` as a plain object (defensive against malformed schemas). */
function metaOf(node) {
  return node && typeof node === "object" && node.meta && typeof node.meta === "object"
    ? node.meta
    : {};
}

/**
 * The literal options of a union node, or `null` when the union is not a
 * plain set of literals (in which case the value is rendered as JSON).
 *
 * @param {object} node A `type: "union"` schema node.
 * @returns {Array<unknown>|null}
 */
export function unionOptions(node) {
  const list = Array.isArray(node.list) ? node.list : [];
  if (list.length === 0) return null;
  const options = [];
  for (const child of list) {
    if (!child || typeof child !== "object") return null;
    if (child.type === "literal" && "value" in child) options.push(child.value);
    else if (child.type === "null") options.push(null);
    else return null;
  }
  return options;
}

/**
 * Classify a schema node as a leaf and describe how to edit it.
 *
 * @param {object} node
 * @returns {{kind: "leaf", leafType: string, options?: Array<unknown>,
 *   fixed?: unknown, secret: boolean, required: boolean, default?: unknown}}
 *   `leafType` is one of `string | number | boolean | enum | literal | json`.
 */
export function describeLeaf(node) {
  const meta = metaOf(node);
  const base = {
    kind: "leaf",
    secret: meta.role === "secret",
    required: meta.required === true,
    default: "default" in meta ? meta.default : undefined,
  };
  if (!node || typeof node !== "object") return { ...base, leafType: "json" };
  switch (node.type) {
    case "string": return { ...base, leafType: "string" };
    case "number": return { ...base, leafType: "number" };
    case "boolean": return { ...base, leafType: "boolean" };
    case "literal":
      return { ...base, leafType: "literal", fixed: node.value };
    case "null":
      return { ...base, leafType: "literal", fixed: null };
    case "union": {
      const options = unionOptions(node);
      return options === null
        ? { ...base, leafType: "json" }
        : { ...base, leafType: "enum", options };
    }
    default:
      return { ...base, leafType: "json" };
  }
}

/**
 * Walk one schema node against one value into a form-tree node.
 *
 * @param {object} node       The schema node.
 * @param {unknown} value     The concrete value at this position (may be undefined).
 * @param {string[]} path     Path from the section root to this node.
 * @param {string} key        Display key (last path segment, or a label).
 * @param {object} [opts]
 * @param {number} [opts.depth=0]
 * @returns {{
 *   kind: "leaf"|"object"|"dict"|"array",
 *   path: string[], key: string,
 *   leafType?: string, options?: Array<unknown>, fixed?: unknown,
 *   secret?: boolean, required?: boolean, default?: unknown,
 *   children?: Array<ReturnType<typeof walk>>,
 * }}
 */
export function walk(node, value, path = [], key = "") {
  if (!node || typeof node !== "object") {
    return { kind: "leaf", path, key, leafType: "json", secret: false, required: false };
  }

  // Containers first.
  if (node.type === "object") {
    const dict = isPlainObject(node.dict) ? node.dict : {};
    const children = [];
    for (const [childKey, childNode] of Object.entries(dict)) {
      children.push(walk(childNode, isPlainObject(value) ? value[childKey] : undefined, [...path, childKey], childKey));
    }
    return { kind: "object", path, key, children };
  }

  if (node.type === "dict") {
    const inner = node.inner;
    const children = [];
    if (isPlainObject(value)) {
      for (const [childKey, childValue] of Object.entries(value)) {
        children.push(walk(inner, childValue, [...path, childKey], childKey));
      }
    }
    return { kind: "dict", path, key, children };
  }

  if (node.type === "array") {
    const inner = node.inner;
    const children = [];
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        children.push(walk(inner, value[index], [...path, String(index)], String(index)));
      }
    }
    return { kind: "array", path, key, children };
  }

  // Everything else is a leaf (transform is unwrapped to its inner value shape).
  if (node.type === "transform" && node.inner && typeof node.inner === "object") {
    const leaf = describeLeaf(node.inner);
    return { kind: "leaf", path, key, ...leaf };
  }
  const leaf = describeLeaf(node);
  return { kind: "leaf", path, key, ...leaf };
}

/**
 * Collect every leaf under a form-tree node, in document order.
 * @param {object} tree  A node from {@link walk}.
 * @returns {Array<object>} The leaf nodes.
 */
export function leaves(tree) {
  const out = [];
  const visit = (node) => {
    if (!node) return;
    if (node.kind === "leaf") { out.push(node); return; }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return out;
}

/**
 * Build the form tree for one entry's volatile schema + effective value.
 * @param {object} schema  The `schema` field of a describe() entry.
 * @param {object} value   The `value` field (current effective value).
 * @returns {object} The root form-tree node.
 */
export function buildFormTree(schema, value) {
  return walk(schema, value, [], "");
}

/**
 * True when a `user` override section currently owns the leaf at `path`
 * (i.e. the field was explicitly set by the profile, not inherited).
 *
 * @param {object|undefined} user  The entry's `user` field (profile override).
 * @param {string[]} path          Leaf path from the section root.
 * @returns {boolean}
 */
export function isOverridden(user, path) {
  if (!user || !Array.isArray(path) || path.length === 0) return false;
  let node = user;
  for (const segment of path) {
    if (node === null || typeof node !== "object") return false;
    if (!Object.hasOwn(node, segment)) return false;
    node = node[segment];
  }
  return true;
}

/**
 * Read the value at `path` inside a plain JSON tree; `undefined` when absent.
 * @param {unknown} root
 * @param {string[]} path
 */
export function valueAt(root, path) {
  let node = root;
  for (const segment of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = node[segment];
  }
  return node;
}

/**
 * Parse a leaf's textual editor input into a JS value for a set op.
 *
 * @param {string} leafType  One of the leaf types from {@link describeLeaf}.
 * @param {string} text      The raw input.
 * @returns {{ok: true, value: unknown}|{ok: false, error: string}}
 */
export function parseLeaf(leafType, text) {
  const trimmed = text.trim();
  switch (leafType) {
    case "string":
      return { ok: true, value: text };
    case "number": {
      if (trimmed === "") return { ok: false, error: "a number is required" };
      const value = Number(trimmed);
      if (!Number.isFinite(value)) return { ok: false, error: `"${text}" is not a finite number` };
      return { ok: true, value };
    }
    case "boolean": {
      if (trimmed === "true" || trimmed === "1") return { ok: true, value: true };
      if (trimmed === "false" || trimmed === "0") return { ok: true, value: false };
      return { ok: false, error: `expected "true" or "false", got "${text}"` };
    }
    case "enum":
      return { ok: true, value: text };
    case "json": {
      if (trimmed === "") return { ok: true, value: null };
      try {
        return { ok: true, value: JSON.parse(trimmed) };
      } catch (error) {
        return { ok: false, error: `invalid JSON: ${error.message}` };
      }
    }
    default:
      return { ok: true, value: text };
  }
}

/**
 * Format a leaf's current value as text for its editor.
 * @param {object} leaf  A leaf node from {@link walk}.
 * @param {unknown} value  The current value.
 * @returns {string}
 */
export function formatLeaf(leaf, value) {
  if (value === undefined) return "";
  switch (leaf.leafType) {
    case "boolean": return value ? "true" : "false";
    case "json": return JSON.stringify(value, null, 2) ?? "";
    default: return String(value);
  }
}

// ------------------------------------------------------------- working value

/**
 * Deep-clone a JSON value. Uses `structuredClone` where available (Node 17+
 * and modern Chromium), falling back to a JSON round-trip (safe because every
 * value here is JSON-plain).
 * @param {unknown} value
 * @returns {unknown}
 */
export function deepClone(value) {
  if (value === null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/** Set `newValue` at `path` inside `root`, creating intermediate containers. */
function setInPlace(root, path, newValue) {
  let node = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    const nextKey = path[i + 1];
    if (node[key] === null || typeof node[key] !== "object") {
      node[key] = /^\d+$/.test(nextKey) ? [] : {};
    }
    node = node[key];
  }
  node[path[path.length - 1]] = newValue;
}

/** Remove the value at `path` inside `root` (array index splices, key deletes). */
function deleteInPlace(root, path) {
  let node = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    node = node?.[path[i]];
    if (node === null || typeof node !== "object") return;
  }
  const last = path[path.length - 1];
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) node.splice(Number(last), 1);
  else delete node[last];
}

/**
 * Produce the *working value* for a form: the effective value with a batch of
 * settings ops applied. This is what the DOM layer renders while edits are
 * staged, so Add/Remove and in-progress fields are visible before the write.
 *
 * @param {object} value  The effective value (from a describe() entry).
 * @param {Array<{op: "set"|"unset", path: string[], value?: unknown}>} ops
 * @returns {object} A new value; the input is never mutated.
 */
export function applyOpsToValue(value, ops) {
  let result = deepClone(value ?? {});
  for (const op of ops) {
    if (op.op === "set") {
      if (op.path.length === 0) result = deepClone(op.value);
      else setInPlace(result, op.path, deepClone(op.value));
    } else if (op.path.length === 0) {
      result = {};
    } else {
      deleteInPlace(result, op.path);
    }
  }
  return result;
}
