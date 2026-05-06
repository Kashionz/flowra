import test from "node:test";
import assert from "node:assert/strict";

import {
  DRAFT_STORAGE_KEY,
  PENDING_CLOUD_SYNC_STORAGE_KEY,
  clearDraftScenario,
  clearPendingCloudSync,
  doesPendingCloudSyncMatchPayload,
  readDraftScenario,
  readPendingCloudSync,
  resolveInitialCloudSyncStatus,
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

test("readDraftScenario returns null for invalid JSON", () => {
  const storage = createMemoryStorage();

  storage.setItem(DRAFT_STORAGE_KEY, "{");

  assert.equal(readDraftScenario(storage), null);
});

test("readDraftScenario returns null for malformed draft payload", () => {
  const storage = createMemoryStorage();

  storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify([]));

  assert.equal(readDraftScenario(storage), null);
});

test("clearDraftScenario removes the saved draft", () => {
  const storage = createMemoryStorage();

  writeDraftScenario(storage, { schemaVersion: 1, meta: { name: "draft" } });

  clearDraftScenario(storage);

  assert.equal(storage.getItem(DRAFT_STORAGE_KEY), null);
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

test("readPendingCloudSync returns null for invalid JSON", () => {
  const storage = createMemoryStorage();

  storage.setItem(PENDING_CLOUD_SYNC_STORAGE_KEY, "{");

  assert.equal(readPendingCloudSync(storage), null);
});

test("readPendingCloudSync returns null for malformed pending record", () => {
  const storage = createMemoryStorage();

  storage.setItem(
    PENDING_CLOUD_SYNC_STORAGE_KEY,
    JSON.stringify({ payload: [], updatedAt: "not-a-timestamp" }),
  );

  assert.equal(readPendingCloudSync(storage), null);
});

test("clearPendingCloudSync removes the pending sync record", () => {
  const storage = createMemoryStorage();

  writePendingCloudSync(storage, { schemaVersion: 1 }, "2026-05-07T10:00:00.000Z");

  clearPendingCloudSync(storage);

  assert.equal(storage.getItem(PENDING_CLOUD_SYNC_STORAGE_KEY), null);
});

test("doesPendingCloudSyncMatchPayload returns true when pending payload still matches the synced payload", () => {
  const payload = {
    schemaVersion: 1,
    meta: { name: "same", updatedAt: "2026-05-07T10:00:00.000Z" },
    basics: { startingTwd: 1000 },
  };

  assert.equal(
    doesPendingCloudSyncMatchPayload(
      {
        payload,
        updatedAt: "2026-05-07T10:05:00.000Z",
      },
      payload,
    ),
    true,
  );
});

test("doesPendingCloudSyncMatchPayload returns false when pending payload has newer local edits", () => {
  const syncedPayload = {
    schemaVersion: 1,
    meta: { name: "before", updatedAt: "2026-05-07T10:00:00.000Z" },
    basics: { startingTwd: 1000 },
  };
  const newerPendingPayload = {
    schemaVersion: 1,
    meta: { name: "after", updatedAt: "2026-05-07T10:01:00.000Z" },
    basics: { startingTwd: 2000 },
  };

  assert.equal(
    doesPendingCloudSyncMatchPayload(
      {
        payload: newerPendingPayload,
        updatedAt: "2026-05-07T10:05:00.000Z",
      },
      syncedPayload,
    ),
    false,
  );
});

test("resolveInitialCloudSyncStatus returns pending when a pending sync record exists", () => {
  assert.equal(
    resolveInitialCloudSyncStatus({
      localDraft: { schemaVersion: 1 },
      pendingCloudSync: {
        payload: { schemaVersion: 1 },
        updatedAt: "2026-05-07T10:00:00.000Z",
      },
      lastSyncedAt: "2026-05-07T09:00:00.000Z",
    }),
    "pending",
  );
});

test("resolveInitialCloudSyncStatus returns synced when local draft exists and there is no pending sync marker", () => {
  assert.equal(
    resolveInitialCloudSyncStatus({
      localDraft: { schemaVersion: 1 },
      pendingCloudSync: null,
      lastSyncedAt: "2026-05-07T09:00:00.000Z",
    }),
    "synced",
  );
});

test("resolveInitialCloudSyncStatus returns idle when no pending marker or last sync timestamp exists", () => {
  assert.equal(
    resolveInitialCloudSyncStatus({
      localDraft: { schemaVersion: 1 },
      pendingCloudSync: null,
      lastSyncedAt: "",
    }),
    "idle",
  );
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

test("resolveHydrationSource returns default when draft and cloud are both missing", () => {
  assert.deepEqual(resolveHydrationSource({ localDraft: null, cloudPayload: null }), {
    source: "default",
    payload: null,
  });
});
