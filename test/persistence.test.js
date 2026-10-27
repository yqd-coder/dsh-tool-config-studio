/**
 * Persistence tests using an in-memory Web-Storage double.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createLocalPersistence, DEFAULT_STORAGE_KEY } from "../src/core/persistence.js";

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      data.set(key, String(value));
    },
    removeItem: (key) => {
      data.delete(key);
    },
    _data: data,
  };
}

test("storage key is namespaced to this plugin", () => {
  assert.match(DEFAULT_STORAGE_KEY, /^dsh-tool-config-studio\./);
});

test("save/load round trip", () => {
  const storage = memoryStorage();
  const persistence = createLocalPersistence(storage, "key");

  assert.equal(persistence.load(), null, "nothing saved yet");

  const doc = { schemaVersion: 1, tools: { read: { params: { limit: 5 } } } };
  assert.equal(persistence.save(doc), true);
  assert.deepEqual(persistence.load(), doc);
});

test("incompatible schema versions are rejected and removed", () => {
  const storage = memoryStorage();
  const persistence = createLocalPersistence(storage, "key");

  persistence.save({ schemaVersion: 999, tools: {} });
  assert.equal(persistence.load(), null);
  assert.equal(storage._data.has("key"), false, "stale entry must be removed");
});

test("corrupt JSON is rejected and removed", () => {
  const storage = memoryStorage({ key: "{definitely not json" });
  const persistence = createLocalPersistence(storage, "key");
  assert.equal(persistence.load(), null);
  assert.equal(storage._data.has("key"), false);
});

test("documents with the wrong shape are rejected", () => {
  const storage = memoryStorage({ key: JSON.stringify({ schemaVersion: 1 }) });
  const persistence = createLocalPersistence(storage, "key");
  assert.equal(persistence.load(), null, "missing tools field");
});

test("storage failures degrade to in-memory mode without throwing", () => {
  const failing = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("quota exceeded");
    },
    removeItem: () => {
      throw new Error("denied");
    },
  };
  const persistence = createLocalPersistence(failing, "key");
  assert.equal(persistence.load(), null);
  assert.equal(persistence.save({ schemaVersion: 1, tools: {} }), false);
  assert.doesNotThrow(() => persistence.clear());
});

test("missing storage backend degrades gracefully", () => {
  const persistence = createLocalPersistence(null, "key");
  assert.equal(persistence.load(), null);
  assert.equal(persistence.save({ schemaVersion: 1, tools: {} }), false);
  assert.doesNotThrow(() => persistence.clear());
});
