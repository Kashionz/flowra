import test from "node:test";
import assert from "node:assert/strict";

import {
  DRAFT_STORAGE_KEY,
  PENDING_CLOUD_SYNC_STORAGE_KEY,
  clearDraftScenario,
  clearPendingCloudSync,
  doesPendingCloudSyncMatchPayload,
  formatAutoSyncStatus,
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

test("formatAutoSyncStatus returns offline pending copy when pending changes exist offline", () => {
  assert.equal(
    formatAutoSyncStatus({
      cloudAuthState: "authenticated",
      cloudSetupState: "ready",
      cloudSyncStatus: "pending",
      lastSyncedAtLabel: "",
      isOffline: true,
      cloudSetupMessage: "雲端備份已就緒。",
    }),
    "目前離線，本機已保存",
  );
});

test("formatAutoSyncStatus returns synced copy with relative timestamp tail", () => {
  assert.equal(
    formatAutoSyncStatus({
      cloudAuthState: "authenticated",
      cloudSetupState: "ready",
      cloudSyncStatus: "synced",
      lastSyncedAtLabel: "3 分鐘前",
      isOffline: false,
      cloudSetupMessage: "雲端備份已就緒。",
    }),
    "已同步到雲端 · 3 分鐘前",
  );
});

test("formatAutoSyncStatus returns local-only copy when user is not authenticated", () => {
  assert.equal(
    formatAutoSyncStatus({
      cloudAuthState: "anonymous",
      cloudSetupState: "ready",
      cloudSyncStatus: "pending",
      lastSyncedAtLabel: "",
      isOffline: false,
      cloudSetupMessage: "雲端備份已就緒。",
    }),
    "目前僅保存在這台裝置",
  );
});

test("resolveHydrationSource prefers cloud over local draft when there is no prior pending sync", () => {
  const localDraft = { schemaVersion: 1, meta: { name: "local" } };
  const cloudPayload = { schemaVersion: 1, meta: { name: "cloud" } };

  assert.deepEqual(resolveHydrationSource({ localDraft, cloudPayload }), {
    source: "cloud",
    payload: cloudPayload,
  });
});

test("resolveHydrationSource keeps local draft when prior pending changes are strictly newer than cloud", () => {
  const localDraft = { schemaVersion: 1, meta: { name: "local" } };
  const cloudPayload = { schemaVersion: 1, meta: { name: "cloud" } };

  assert.deepEqual(
    resolveHydrationSource({
      localDraft,
      cloudPayload,
      cloudUpdatedAt: "2026-05-07T09:00:00.000Z",
      pendingExistedAtMount: true,
      pendingUpdatedAtAtMount: "2026-05-07T10:00:00.000Z",
    }),
    { source: "draft", payload: localDraft },
  );
});

test("resolveHydrationSource uses cloud when prior pending changes are older than cloud", () => {
  const localDraft = { schemaVersion: 1, meta: { name: "local" } };
  const cloudPayload = { schemaVersion: 1, meta: { name: "cloud" } };

  assert.deepEqual(
    resolveHydrationSource({
      localDraft,
      cloudPayload,
      cloudUpdatedAt: "2026-05-07T11:00:00.000Z",
      pendingExistedAtMount: true,
      pendingUpdatedAtAtMount: "2026-05-07T10:00:00.000Z",
    }),
    { source: "cloud", payload: cloudPayload },
  );
});

test("resolveHydrationSource ignores pending records that were not present at mount", () => {
  // Edits made during the cloud loading window write a fresh pending record
  // on top of the default scenario. We must treat that as discardable rather
  // than as authoritative unsynced history.
  const localDraft = { schemaVersion: 1, meta: { name: "local" } };
  const cloudPayload = { schemaVersion: 1, meta: { name: "cloud" } };

  assert.deepEqual(
    resolveHydrationSource({
      localDraft,
      cloudPayload,
      cloudUpdatedAt: "2026-05-07T09:00:00.000Z",
      pendingExistedAtMount: false,
      pendingUpdatedAtAtMount: "2026-05-07T10:00:00.000Z",
    }),
    { source: "cloud", payload: cloudPayload },
  );
});

test("resolveHydrationSource falls back to cloud backup when no local draft exists", () => {
  const cloudPayload = { schemaVersion: 1, meta: { name: "cloud" } };

  assert.deepEqual(resolveHydrationSource({ localDraft: null, cloudPayload }), {
    source: "cloud",
    payload: cloudPayload,
  });
});

test("resolveHydrationSource keeps local draft when no cloud backup exists", () => {
  const localDraft = { schemaVersion: 1, meta: { name: "local" } };

  assert.deepEqual(resolveHydrationSource({ localDraft, cloudPayload: null }), {
    source: "draft",
    payload: localDraft,
  });
});

test("resolveHydrationSource returns default when draft and cloud are both missing", () => {
  assert.deepEqual(resolveHydrationSource({ localDraft: null, cloudPayload: null }), {
    source: "default",
    payload: null,
  });
});
