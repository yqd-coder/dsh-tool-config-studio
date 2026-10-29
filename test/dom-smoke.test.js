/**
 * End-to-end UI smoke test.
 *
 * Node has no DOM, so this file installs the shared in-memory DOM stub
 * (see dom-stub.js), then drives `mountToolConfigStudio` the same way a
 * browser would: mount, expand a tool, edit a value, hit a validation
 * error, and restore everything.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Element, Node, makeDocument } from "./dom-stub.js";

// ------------------------------------------------------------ DOM stub

globalThis.Node = Node;
globalThis.document = makeDocument();

// The persistence layer falls back to in-memory mode without localStorage.
// `window.confirm` is stubbed so "restore all" does not block.
globalThis.window = { confirm: () => true };

const { mountToolConfigStudio } = await import("../src/client.js");
const { listCategories, listTools } = await import("../src/core/catalog.js");

/** Mount a fresh app instance into a detached host element (language pinned for determinism). */
function mountFresh() {
  const host = new Element("main");
  const handle = mountToolConfigStudio(host, { language: "en" });
  return { host, handle, root: host.children[0] };
}

/** Find the row of a tool by exact wire name. */
function findToolRow(root, name) {
  const rows = root.querySelectorAll(".tcs-tool");
  return rows.find((row) => {
    const code = row.querySelector("code");
    return code !== null && code.textContent === name;
  });
}

// ---------------------------------------------------------------- tests

test("mount renders the shell, groups, and all tools", () => {
  const { host, handle, root } = mountFresh();

  assert.equal(root.children.length, 3, "header, main, footer");
  assert.equal(root.querySelectorAll(".tcs-group").length, listCategories().length);
  assert.equal(root.querySelectorAll(".tcs-tool").length, listTools().length);

  handle.unmount();
  assert.equal(host.children.length, 0, "unmount removes the shell");
});

test("expanding a tool shows its detail panel", () => {
  const { handle, root } = mountFresh();

  assert.equal(root.querySelector(".tcs-detail"), null);
  findToolRow(root, "read").dispatch("click");
  assert.ok(root.querySelector(".tcs-detail"), "detail panel appears");
  assert.match(root.querySelector(".tcs-detail").textContent, /limit/);

  // Collapsing removes it again.
  findToolRow(root, "read").dispatch("click");
  assert.equal(root.querySelector(".tcs-detail"), null);
  handle.unmount();
});

test("search filters the list", () => {
  const { handle, root } = mountFresh();

  const search = root.querySelector(".tcs-search");
  search.value = "pwsh";
  search.dispatch("input", { target: search });

  const names = root.querySelectorAll(".tcs-tool").map((row) => row.querySelector("code").textContent);
  assert.deepEqual(names, ["pwsh"]);

  search.value = "zzz-no-match";
  search.dispatch("input", { target: search });
  assert.ok(root.querySelector(".tcs-empty"), "empty state is shown");
  handle.unmount();
});

test("editing a parameter commits on change and updates the footer", () => {
  const { handle, root } = mountFresh();

  findToolRow(root, "read").dispatch("click");
  const param = root.querySelectorAll(".tcs-param").find((node) => node.dataset.param === "limit");
  const input = param.querySelector(".tcs-editor-text");

  input.value = "500";
  input.dispatch("change", { target: input });

  assert.equal(handle.store.effectiveParam("read", "limit"), 500);
  assert.equal(handle.store.overrideCount(), 1);
  assert.match(root.querySelector(".tcs-footer").textContent, /1/);
  assert.ok(root.querySelectorAll(".tcs-chip-modified").length > 0, "modified badge visible");
  handle.unmount();
});

test("invalid values are rejected inline and never reach the store", () => {
  const { handle, root } = mountFresh();

  findToolRow(root, "read").dispatch("click");
  const param = root.querySelectorAll(".tcs-param").find((node) => node.dataset.param === "limit");
  const input = param.querySelector(".tcs-editor-text");

  input.value = "0"; // below min (1)
  input.dispatch("change", { target: input });

  assert.equal(handle.store.overrideCount(), 0, "store stays clean");
  assert.ok(root.querySelector(".tcs-param-error"), "error line rendered");

  // Correcting the value clears the error.
  const requery = root.querySelectorAll(".tcs-param").find((node) => node.dataset.param === "limit");
  const fresh = requery.querySelector(".tcs-editor-text");
  fresh.value = "100";
  fresh.dispatch("change", { target: fresh });
  assert.equal(root.querySelector(".tcs-param-error"), null);
  assert.equal(handle.store.effectiveParam("read", "limit"), 100);
  handle.unmount();
});

test("disabling a tool, then restoring all, returns to factory state", () => {
  const { handle, root } = mountFresh();

  findToolRow(root, "read").dispatch("click");
  const switchLabel = root.querySelector(".tcs-switch");
  const toggle = switchLabel.children[0]; // the hidden checkbox input
  toggle.checked = false;
  toggle.dispatch("change", { target: toggle });
  assert.equal(handle.store.isEnabled("read"), false);

  root.querySelector(".tcs-btn-danger").dispatch("click"); // restore all (confirm stubbed true)
  assert.equal(handle.store.overrideCount(), 0);
  assert.equal(handle.store.isEnabled("read"), true);
  handle.unmount();
});

test("the app survives repeated mount/unmount cycles", () => {
  const host = new Element("main");
  for (let i = 0; i < 3; i += 1) {
    const handle = mountToolConfigStudio(host, { language: "en" });
    assert.equal(host.querySelectorAll(".tcs-tool").length, listTools().length);
    handle.unmount();
    assert.equal(host.children.length, 0);
  }
});
