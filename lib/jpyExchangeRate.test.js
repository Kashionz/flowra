import test from "node:test";
import assert from "node:assert/strict";

import {
  FALLBACK_JPY_TO_TWD_RATE,
  fetchJpyToTwdRate,
  getCachedJpyToTwdRate,
  saveJpyToTwdRate,
  todayKey,
} from "./jpyExchangeRate.js";

// ----- todayKey ----------------------------------------------------------

test("todayKey returns ISO date prefix", () => {
  const fixed = new Date("2026-05-07T15:30:00.000Z");
  assert.equal(todayKey(fixed), "2026-05-07");
});

test("todayKey defaults to now", () => {
  const value = todayKey();
  assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
});

// ----- localStorage shim ------------------------------------------------

class MemoryStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

function withWindow(fn) {
  const previousWindow = globalThis.window;
  const storage = new MemoryStorage();
  globalThis.window = { localStorage: storage };
  try {
    return fn(storage);
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
}

// ----- get/save round-trip ---------------------------------------------

test("getCachedJpyToTwdRate returns null when storage is empty", () => {
  withWindow(() => {
    assert.equal(getCachedJpyToTwdRate(), null);
  });
});

test("saveJpyToTwdRate then getCachedJpyToTwdRate round-trips a valid entry", () => {
  withWindow(() => {
    const entry = { rate: 0.218, fetchedAt: "2026-05-07T01:00:00.000Z", date: "2026-05-07" };
    saveJpyToTwdRate(entry);
    assert.deepEqual(getCachedJpyToTwdRate(), entry);
  });
});

test("getCachedJpyToTwdRate returns null when stored rate is non-numeric or non-positive", () => {
  withWindow((storage) => {
    storage.setItem("flowra.jpyExchangeRate", JSON.stringify({ rate: "abc" }));
    assert.equal(getCachedJpyToTwdRate(), null);

    storage.setItem("flowra.jpyExchangeRate", JSON.stringify({ rate: 0 }));
    assert.equal(getCachedJpyToTwdRate(), null);

    storage.setItem("flowra.jpyExchangeRate", JSON.stringify({ rate: -0.2 }));
    assert.equal(getCachedJpyToTwdRate(), null);
  });
});

test("getCachedJpyToTwdRate tolerates corrupt JSON", () => {
  withWindow((storage) => {
    storage.setItem("flowra.jpyExchangeRate", "{not json");
    assert.equal(getCachedJpyToTwdRate(), null);
  });
});

test("getCachedJpyToTwdRate returns null when window is undefined", () => {
  const previousWindow = globalThis.window;
  delete globalThis.window;
  try {
    assert.equal(getCachedJpyToTwdRate(), null);
  } finally {
    if (previousWindow !== undefined) {
      globalThis.window = previousWindow;
    }
  }
});

// ----- fetchJpyToTwdRate ------------------------------------------------

function withFetch(fakeFetch, fn) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    return fn();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

test("fetchJpyToTwdRate parses a valid TWD rate response", async () => {
  const result = await withFetch(
    async () => ({
      ok: true,
      status: 200,
      json: async () => ({ rates: { TWD: 0.214 } }),
    }),
    () => fetchJpyToTwdRate(),
  );
  assert.equal(result.rate, 0.214);
  assert.match(result.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(result.date, /^\d{4}-\d{2}-\d{2}$/);
});

test("fetchJpyToTwdRate throws when response is not ok", async () => {
  await withFetch(
    async () => ({ ok: false, status: 500, json: async () => ({}) }),
    async () => {
      await assert.rejects(fetchJpyToTwdRate(), /匯率服務回應 500/);
    },
  );
});

test("fetchJpyToTwdRate throws when payload has no TWD rate", async () => {
  await withFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ rates: {} }) }),
    async () => {
      await assert.rejects(fetchJpyToTwdRate(), /匯率資料無效/);
    },
  );
});

test("fetchJpyToTwdRate throws when TWD rate is non-positive", async () => {
  await withFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ rates: { TWD: 0 } }) }),
    async () => {
      await assert.rejects(fetchJpyToTwdRate(), /匯率資料無效/);
    },
  );
});

// ----- constant ----------------------------------------------------------

test("FALLBACK_JPY_TO_TWD_RATE is a positive number", () => {
  assert.ok(FALLBACK_JPY_TO_TWD_RATE > 0);
});
