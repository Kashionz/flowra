/**
 * Decide whether the user should see a hydration notice after the
 * cloud refresh resolves, and what the notice should say.
 *
 * Pure function over the inputs the cloud-hydration effect already
 * computes. Returns `null` when nothing notable happened (no banner),
 * or a `{ source, cloudUpdatedAt, pendingUpdatedAt, savedDraft }`
 * payload that the calling component drops into a `<HydrationBanner>`.
 *
 * Cases:
 * - source === "cloud" with a discarded local draft → banner with
 *   "改用本機草稿" recovery action; savedDraft is the dropped local
 *   value so the user can re-apply it.
 * - source === "draft" with an out-of-date cloud copy that pre-dated
 *   the user's pending edits → banner explaining the local-wins
 *   choice; no recovery action.
 * - any other case (no banner) → null.
 */
export function describeHydrationDecision({
  source,
  cloudPayload,
  cloudUpdatedAt,
  pendingExistedAtMount,
  pendingUpdatedAtAtMount,
  localDraft,
}) {
  if (source === "cloud" && localDraft) {
    return {
      source: "cloud",
      cloudUpdatedAt: cloudUpdatedAt || null,
      pendingUpdatedAt: pendingUpdatedAtAtMount || null,
      savedDraft: localDraft,
    };
  }
  if (source === "draft" && cloudPayload && pendingExistedAtMount) {
    return {
      source: "draft",
      cloudUpdatedAt: cloudUpdatedAt || null,
      pendingUpdatedAt: pendingUpdatedAtAtMount || null,
      savedDraft: null,
    };
  }
  return null;
}
