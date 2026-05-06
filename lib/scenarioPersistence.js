export const DRAFT_STORAGE_KEY = "flowra.cashflow.draft";
export const PENDING_CLOUD_SYNC_STORAGE_KEY =
  "flowra.cashflow.pending-cloud-sync";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function safeParse(rawValue) {
  if (!rawValue) return null;

  try {
    return JSON.parse(rawValue);
  } catch (_error) {
    return null;
  }
}

function serializePayload(value) {
  return JSON.stringify(value ?? null);
}

export function readDraftScenario(storage) {
  const parsed = safeParse(storage?.getItem?.(DRAFT_STORAGE_KEY));
  return isObject(parsed) ? parsed : null;
}

export function writeDraftScenario(storage, payload) {
  storage?.setItem?.(DRAFT_STORAGE_KEY, JSON.stringify(payload));
}

export function clearDraftScenario(storage) {
  storage?.removeItem?.(DRAFT_STORAGE_KEY);
}

export function readPendingCloudSync(storage) {
  const parsed = safeParse(storage?.getItem?.(PENDING_CLOUD_SYNC_STORAGE_KEY));

  if (!isObject(parsed)) return null;
  if (!isObject(parsed.payload) || !isValidTimestamp(parsed.updatedAt)) return null;

  return parsed;
}

export function writePendingCloudSync(storage, payload, updatedAt) {
  storage?.setItem?.(
    PENDING_CLOUD_SYNC_STORAGE_KEY,
    JSON.stringify({ payload, updatedAt }),
  );
}

export function clearPendingCloudSync(storage) {
  storage?.removeItem?.(PENDING_CLOUD_SYNC_STORAGE_KEY);
}

export function doesPendingCloudSyncMatchPayload(pendingCloudSync, payload) {
  if (!isObject(pendingCloudSync) || !isObject(pendingCloudSync.payload)) return false;
  return serializePayload(pendingCloudSync.payload) === serializePayload(payload);
}

export function resolveInitialCloudSyncStatus({ localDraft, pendingCloudSync, lastSyncedAt }) {
  if (pendingCloudSync) return "pending";
  if (localDraft && isValidTimestamp(lastSyncedAt)) return "synced";
  return "idle";
}

export function resolveHydrationSource({ localDraft, cloudPayload }) {
  if (localDraft) {
    return { source: "draft", payload: localDraft };
  }

  if (cloudPayload) {
    return { source: "cloud", payload: cloudPayload };
  }

  return { source: "default", payload: null };
}
