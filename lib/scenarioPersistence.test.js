import test from "node:test";
import assert from "node:assert/strict";

import {
  DRAFT_STORAGE_KEY,
  PENDING_CLOUD_SYNC_STORAGE_KEY,
  clearPendingCloudSync,
  readDraftScenario,
  readPendingCloudSync,
  resolveHydrationSource,
  writeDraftScenario,
  writePendingCloudSync,
} from "./scenarioPersistence.js";

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

test("draft round-trip stores the latest scenario payload", () => {
  const storage = createMemoryStorage();
  const payload = { schemaVersion: 1, meta: { name: "draft" } };

  writeDraftScenario(storage, payload);

  assert.deepEqual(readDraftScenario(storage), payload);
});

test("pending cloud sync round-trip stores payload with timestamp", () => {
  const storage = createMemoryStorage();
  const payload = { schemaVersion: 1, meta: { name: "pending" } };

  writePendingCloudSync(storage, payload, "2026-05-07T10:00:00.000Z");

  assert.deepEqual(readPendingCloudSync(storage), {
    payload,
    updatedAt: "2026-05-07T10:00:00.000Z",
  });
});

test("clearPendingCloudSync removes the pending sync record", () => {
  const storage = createMemoryStorage();

  writePendingCloudSync(storage, { schemaVersion: 1 }, "2026-05-07T10:00:00.000Z");

  clearPendingCloudSync(storage);

  assert.equal(storage.getItem(PENDING_CLOUD_SYNC_STORAGE_KEY), null);
});

test("resolveHydrationSource prefers local draft over cloud backup", () => {
  const localDraft = { schemaVersion: 1, meta: { name: "local" } };
  const cloudPayload = { schemaVersion: 1, meta: { name: "cloud" } };

  assert.deepEqual(resolveHydrationSource({ localDraft, cloudPayload }), {
    source: "draft",
    payload: localDraft,
  });
});

test("resolveHydrationSource falls back to cloud backup when no local draft exists", () => {
  const cloudPayload = { schemaVersion: 1, meta: { name: "cloud" } };

  assert.deepEqual(resolveHydrationSource({ localDraft: null, cloudPayload }), {
    source: "cloud",
    payload: cloudPayload,
  });
});
