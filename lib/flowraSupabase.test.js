import test from "node:test";
import assert from "node:assert/strict";

import {
  checkFlowraCloudSetup,
  getCurrentSupabaseUser,
  getLatestCloudBackup,
  isCloudSyncAvailable,
  upsertCloudBackup,
} from "./flowraSupabase.js";

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

function installWindow(storage) {
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: storage };
  return () => {
    if (previousWindow === undefined) {
      delete globalThis.window;
      return;
    }
    globalThis.window = previousWindow;
  };
}

test("isCloudSyncAvailable returns true in dev mode without Supabase config", () => {
  const previous = process.env.VITE_FLOWRA_DEV_MODE;
  delete process.env.FLOWRA_SUPABASE_URL;
  delete process.env.FLOWRA_SUPABASE_PUBLISHABLE_KEY;
  process.env.VITE_FLOWRA_DEV_MODE = "1";

  try {
    assert.equal(isCloudSyncAvailable(), true);
  } finally {
    if (previous === undefined) delete process.env.VITE_FLOWRA_DEV_MODE;
    else process.env.VITE_FLOWRA_DEV_MODE = previous;
  }
});

test("dev mode reports cloud setup ready and returns a fake authenticated user", async () => {
  const previous = process.env.VITE_FLOWRA_DEV_MODE;
  process.env.VITE_FLOWRA_DEV_MODE = "1";

  try {
    const setup = await checkFlowraCloudSetup();
    const auth = await getCurrentSupabaseUser();

    assert.deepEqual(setup, { ready: true, error: null });
    assert.equal(auth.error, null);
    assert.equal(auth.user?.email, "dev-mode@flowra.local");
  } finally {
    if (previous === undefined) delete process.env.VITE_FLOWRA_DEV_MODE;
    else process.env.VITE_FLOWRA_DEV_MODE = previous;
  }
});

test("dev mode stores and restores cloud backups from local storage mock", async () => {
  const previous = process.env.VITE_FLOWRA_DEV_MODE;
  process.env.VITE_FLOWRA_DEV_MODE = "1";
  const restoreWindow = installWindow(createMemoryStorage());
  const payload = {
    schemaVersion: 1,
    meta: { name: "dev backup", updatedAt: "2026-05-09T00:00:00.000Z" },
  };

  try {
    const writeResult = await upsertCloudBackup({ payload });
    const readResult = await getLatestCloudBackup();

    assert.equal(writeResult.error, null);
    assert.deepEqual(writeResult.data?.payload, payload);
    assert.equal(readResult.error, null);
    assert.deepEqual(readResult.data?.payload, payload);
    assert.equal(readResult.data?.user_id, "dev-mode-user");
  } finally {
    restoreWindow();
    if (previous === undefined) delete process.env.VITE_FLOWRA_DEV_MODE;
    else process.env.VITE_FLOWRA_DEV_MODE = previous;
  }
});
