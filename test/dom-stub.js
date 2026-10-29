/**
 * Minimal in-memory DOM stub shared by the UI smoke test and the bundle
 * contract test.
 *
 * It covers exactly the surface the app uses: `createElement`,
 * `createTextNode`, `append`/`replaceChildren` (coercing primitive children
 * into text nodes, like the real DOM), class/tag `querySelector`,
 * attributes, dataset, and event listeners. It is deliberately NOT a DOM
 * implementation — the tests only ever reach for what the plugin touches.
 */

export class Node {}

export class Text extends Node {
  constructor(text) {
    super();
    this.isElement = false;
    this.parent = null;
    this.textContent = String(text);
  }
}

export class Element extends Node {
  constructor(tag) {
    super();
    this.isElement = true;
    this.tagName = String(tag).toUpperCase();
    this.parent = null;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.className = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node === null || node === undefined) continue;
      // The real DOM converts primitive children into text nodes.
      const child = node instanceof Node ? node : new Text(node);
      child.parent = this;
      this.children.push(child);
    }
  }

  replaceChildren(...nodes) {
    this.children.length = 0;
    this.append(...nodes);
  }

  remove() {
    const parent = this.parent;
    if (parent) {
      const index = parent.children.indexOf(this);
      if (index !== -1) parent.children.splice(index, 1);
      this.parent = null;
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
  }

  addEventListener(type, handler) {
    (this.listeners[type] ??= []).push(handler);
  }

  /** Test helper: fire all handlers registered for `type`. */
  dispatch(type, event = {}) {
    for (const handler of this.listeners[type] ?? []) handler(event);
  }

  get childElementCount() {
    return this.children.filter((child) => child.isElement).length;
  }

  get textContent() {
    return this.children.map((child) => child.textContent).join("");
  }

  /** Real DOM: setting textContent replaces all children with one text node. */
  set textContent(value) {
    this.children.length = 0;
    if (value === null || value === undefined) return;
    this.append(value);
  }

  /** Test helper: all element descendants in document order. */
  descendants() {
    const out = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.isElement) {
          out.push(child);
          visit(child);
        }
      }
    };
    visit(this);
    return out;
  }

  matchesClass(name) {
    return this.className.split(/\s+/).includes(name);
  }

  /** Test helper: matches a ".class" or tag selector (single token). */
  matches(selector) {
    return selector.startsWith(".")
      ? this.matchesClass(selector.slice(1))
      : this.tagName === selector.toUpperCase();
  }

  querySelector(selector) {
    return this.descendants().find((element) => element.matches(selector)) ?? null;
  }

  querySelectorAll(selector) {
    return this.descendants().filter((element) => element.matches(selector));
  }
}

/** A document object with the two factories the plugin uses. */
export function makeDocument() {
  return {
    createElement: (tag) => new Element(tag),
    createTextNode: (text) => new Text(text),
  };
}
