import test from "node:test";
import assert from "node:assert/strict";

import { describeHydrationDecision } from "./hydrationNotice.js";

const fakeDraft = { schemaVersion: 1, meta: { name: "local" } };
const fakeCloudPayload = { schemaVersion: 1, meta: { name: "cloud" } };

test("returns null on default scenario hydration", () => {
  const result = describeHydrationDecision({
    source: "default",
    cloudPayload: null,
    cloudUpdatedAt: null,
    pendingExistedAtMount: false,
    pendingUpdatedAtAtMount: null,
    localDraft: null,
  });
  assert.equal(result, null);
});

test("cloud source + local draft surfaces a recovery banner", () => {
  const result = describeHydrationDecision({
    source: "cloud",
    cloudPayload: fakeCloudPayload,
    cloudUpdatedAt: "2026-05-07T01:00:00.000Z",
    pendingExistedAtMount: false,
    pendingUpdatedAtAtMount: null,
    localDraft: fakeDraft,
  });
  assert.deepEqual(result, {
    source: "cloud",
    cloudUpdatedAt: "2026-05-07T01:00:00.000Z",
    pendingUpdatedAt: null,
    savedDraft: fakeDraft,
  });
});

test("cloud source without a local draft is silent (nothing to recover)", () => {
  const result = describeHydrationDecision({
    source: "cloud",
    cloudPayload: fakeCloudPayload,
    cloudUpdatedAt: "2026-05-07T01:00:00.000Z",
    pendingExistedAtMount: false,
    pendingUpdatedAtAtMount: null,
    localDraft: null,
  });
  assert.equal(result, null);
});

test("draft source warns when cloud is being passed over", () => {
  const result = describeHydrationDecision({
    source: "draft",
    cloudPayload: fakeCloudPayload,
    cloudUpdatedAt: "2026-05-07T01:00:00.000Z",
    pendingExistedAtMount: true,
    pendingUpdatedAtAtMount: "2026-05-07T05:00:00.000Z",
    localDraft: fakeDraft,
  });
  assert.deepEqual(result, {
    source: "draft",
    cloudUpdatedAt: "2026-05-07T01:00:00.000Z",
    pendingUpdatedAt: "2026-05-07T05:00:00.000Z",
    savedDraft: null,
  });
});

test("draft source with no cloud copy is silent (no conflict)", () => {
  const result = describeHydrationDecision({
    source: "draft",
    cloudPayload: null,
    cloudUpdatedAt: null,
    pendingExistedAtMount: true,
    pendingUpdatedAtAtMount: "2026-05-07T05:00:00.000Z",
    localDraft: fakeDraft,
  });
  assert.equal(result, null);
});

test("draft source without prior pending sync is silent (just first-load)", () => {
  // pendingExistedAtMount is false → no edits had been queued, so the
  // user isn't "winning over" cloud, they just opened the app first
  // before authenticating. Don't show a banner.
  const result = describeHydrationDecision({
    source: "draft",
    cloudPayload: fakeCloudPayload,
    cloudUpdatedAt: "2026-05-07T01:00:00.000Z",
    pendingExistedAtMount: false,
    pendingUpdatedAtAtMount: null,
    localDraft: fakeDraft,
  });
  assert.equal(result, null);
});
