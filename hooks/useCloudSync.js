import { useCallback, useEffect, useMemo, useReducer } from "react";
import {
  checkFlowraCloudSetup,
  createFlowraSupabaseClient,
  getCurrentSupabaseUser,
  getLatestCloudBackup,
  getSupabaseConfigHint,
  isSupabaseConfigured,
  signInWithGoogle as signInWithGoogleApi,
  signOutSupabase,
  upsertCloudBackup,
} from "../lib/flowraSupabase.js";
import {
  clearPendingCloudSync,
  doesPendingCloudSyncMatchPayload,
  readPendingCloudSync,
} from "../lib/scenarioPersistence.js";

// ----- cloud state machine ---------------------------------------------

const cloudInitialState = {
  authState: isSupabaseConfigured() ? "checking" : "unconfigured",
  setupState: isSupabaseConfigured() ? "checking" : "unconfigured",
  syncStatus: "idle",
  userEmail: "",
  notice: "",
  isBackupLoading: false,
  isSigningIn: false,
  isHydrated: false,
};

function reduceField(state, key, value) {
  const next = typeof value === "function" ? value(state[key]) : value;
  return state[key] === next ? state : { ...state, [key]: next };
}

function cloudReducer(state, action) {
  switch (action.type) {
    case "auth/state":
      return reduceField(state, "authState", action.value);
    case "setup/state":
      return reduceField(state, "setupState", action.value);
    case "sync/status":
      return reduceField(state, "syncStatus", action.value);
    case "user/email":
      return reduceField(state, "userEmail", action.value);
    case "notice":
      return reduceField(state, "notice", action.value);
    case "backup/loading":
      return reduceField(state, "isBackupLoading", action.value);
    case "signin/loading":
      return reduceField(state, "isSigningIn", action.value);
    case "hydration/done":
      return state.isHydrated ? state : { ...state, isHydrated: true };
    default:
      return state;
  }
}

// ----- helpers used inside the hook -----------------------------------

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function getErrorMessage(error, fallback) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error && error.message) {
    return String(error.message);
  }
  return fallback;
}

// ----- hook -----------------------------------------------------------

/**
 * Owns the cloud-sync state machine: Supabase auth subscription, table
 * setup probing, and the four user-triggered actions (signIn / signOut
 * / refreshBackup / syncToCloud).
 *
 * The mount-time and hydration orchestration stay in the calling
 * component because they need to coordinate with the scenario state
 * (transitionApply, setHydrationNotice). The hook exposes the setters
 * and refs those orchestrators need.
 */
export function useCloudSync({
  resolveSyncPayload, // (override) => persistedScenario, called inside syncToCloud
  setSessionMeta,
  writeSessionMeta,
  isOffline,
  applyCloudPayload, // (payload) => void; called when refresh's applyPayload=true
  hasPendingCloudSyncRef,
}) {
  const supabaseReady = useMemo(() => isSupabaseConfigured(), []);
  const [state, dispatch] = useReducer(cloudReducer, cloudInitialState);

  // Stable adapter setters — same shape as the React useState setter
  // (accept a value or an updater function), so callers don't need to
  // know about dispatch.
  const setAuthState = useCallback((value) => dispatch({ type: "auth/state", value }), []);
  const setSetupState = useCallback((value) => dispatch({ type: "setup/state", value }), []);
  const setSyncStatus = useCallback((value) => dispatch({ type: "sync/status", value }), []);
  const setUserEmail = useCallback((value) => dispatch({ type: "user/email", value }), []);
  const setNotice = useCallback((value) => dispatch({ type: "notice", value }), []);
  const setIsBackupLoading = useCallback(
    (value) => dispatch({ type: "backup/loading", value }),
    [],
  );
  const setIsSigningIn = useCallback((value) => dispatch({ type: "signin/loading", value }), []);
  const setIsHydrated = useCallback(() => dispatch({ type: "hydration/done" }), []);

  // ----- Auth subscription ---------------------------------------------

  useEffect(() => {
    if (!supabaseReady) {
      setAuthState("unconfigured");
      return undefined;
    }
    const supabase = createFlowraSupabaseClient();
    if (!supabase) {
      setAuthState("unconfigured");
      return undefined;
    }

    let mounted = true;
    setAuthState("checking");

    getCurrentSupabaseUser().then(({ user }) => {
      if (mounted) {
        setAuthState(user ? "authenticated" : "anonymous");
        setUserEmail(user?.email || "");
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setAuthState(session?.user ? "authenticated" : "anonymous");
        setUserEmail(session?.user?.email || "");
      }
    });

    return () => {
      mounted = false;
      subscription?.subscription?.unsubscribe();
    };
  }, [supabaseReady, setAuthState, setUserEmail]);

  // ----- Setup table probe ---------------------------------------------

  useEffect(() => {
    if (!supabaseReady) {
      setSetupState("unconfigured");
      return undefined;
    }

    let cancelled = false;
    setSetupState("checking");

    checkFlowraCloudSetup().then(({ ready, error }) => {
      if (cancelled) return;
      if (ready) {
        setSetupState("ready");
        return;
      }
      if (error?.message?.includes("尚未建立 Flowra 雲端資料表")) {
        setSetupState("missing");
        setNotice(error.message);
        return;
      }
      setSetupState("error");
      if (error?.message) setNotice(error.message);
    });

    return () => {
      cancelled = true;
    };
  }, [supabaseReady, setNotice, setSetupState]);

  // ----- Derived ------------------------------------------------------

  const cloudSetupMessage = useMemo(() => {
    switch (state.setupState) {
      case "ready":
        return "雲端備份已就緒。";
      case "checking":
        return "正在檢查雲端備份狀態。";
      case "missing":
        return "雲端備份目前暫時不可用。";
      case "error":
        return "雲端備份狀態檢查失敗。";
      default:
        return getSupabaseConfigHint();
    }
  }, [state.setupState]);

  const cloudFeaturesEnabled = state.authState === "authenticated" && state.setupState === "ready";

  // ----- Actions ------------------------------------------------------

  const refreshBackup = useCallback(
    async (options = {}) => {
      const { silent = false, applyPayload = false } = options;
      if (state.setupState !== "ready") {
        if (!silent) setNotice(cloudSetupMessage);
        return { data: null, error: new Error(cloudSetupMessage) };
      }
      if (state.authState !== "authenticated") {
        const error = new Error("請先登入，才能讀取雲端備份。");
        if (!silent) setNotice(error.message);
        return { data: null, error };
      }

      setIsBackupLoading(true);
      try {
        const { data, error } = await getLatestCloudBackup();
        if (error) {
          if (!silent) setNotice(error.message);
          return { data: null, error };
        }

        if (!data?.payload) {
          if (!silent) setNotice("雲端目前沒有備份。");
          return { data: null, error: null };
        }

        if (applyPayload) {
          applyCloudPayload?.(data.payload);
          setSyncStatus("synced");
          setNotice("已從雲端還原最近備份。");
        } else if (!silent) {
          // Defer human-readable timestamp formatting to the caller via
          // the data object — keeps this hook free of zh-TW formatters.
          setNotice("已找到雲端最近備份。");
        }

        return { data, error: null };
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error("讀取雲端備份失敗。");
        if (!silent) setNotice(normalizedError.message);
        return { data: null, error: normalizedError };
      } finally {
        setIsBackupLoading(false);
      }
    },
    [
      state.setupState,
      state.authState,
      cloudSetupMessage,
      applyCloudPayload,
      setNotice,
      setIsBackupLoading,
      setSyncStatus,
    ],
  );

  const syncToCloud = useCallback(
    async (payloadOverride, options = {}) => {
      const safePayload = resolveSyncPayload(payloadOverride);
      const { silent = false } = options;
      const attemptAt = new Date().toISOString();
      setSessionMeta(writeSessionMeta({ lastSyncAttemptAt: attemptAt }));
      if (!supabaseReady) {
        setNotice(getSupabaseConfigHint());
        return { error: new Error(getSupabaseConfigHint()) };
      }
      if (state.setupState !== "ready") {
        setNotice(cloudSetupMessage);
        return { error: new Error(cloudSetupMessage) };
      }
      if (isOffline) {
        setSyncStatus("pending");
        if (!silent) {
          setNotice("目前離線，這次變更尚未同步；恢復連線後會自動再試同步。");
        }
        return { error: new Error("offline") };
      }
      setSyncStatus("syncing");
      try {
        const { data, error } = await withTimeout(
          upsertCloudBackup({ payload: safePayload }),
          12000,
          "同步雲端備份逾時，請確認網路後再試。",
        );
        if (error) {
          setSyncStatus("pending");
          setNotice(error.message);
          return { error };
        }
        let pendingStillMatchesSyncedPayload = true;
        if (typeof window !== "undefined" && window.localStorage) {
          const pending = readPendingCloudSync(window.localStorage);
          pendingStillMatchesSyncedPayload = doesPendingCloudSyncMatchPayload(pending, safePayload);
          if (pendingStillMatchesSyncedPayload) {
            clearPendingCloudSync(window.localStorage);
          }
        }
        if (hasPendingCloudSyncRef) {
          hasPendingCloudSyncRef.current = !pendingStillMatchesSyncedPayload;
        }
        setSyncStatus(pendingStillMatchesSyncedPayload ? "synced" : "pending");
        setSessionMeta(
          writeSessionMeta({
            lastSyncedAt: new Date().toISOString(),
            lastSyncAttemptAt: attemptAt,
          }),
        );
        setNotice("目前內容已同步到雲端備份。");
        return { error: null, data };
      } catch (error) {
        setSyncStatus("pending");
        const normalizedError = error instanceof Error ? error : new Error("同步雲端備份失敗。");
        setNotice(normalizedError.message);
        return { error: normalizedError };
      }
    },
    [
      resolveSyncPayload,
      supabaseReady,
      state.setupState,
      cloudSetupMessage,
      isOffline,
      setSessionMeta,
      writeSessionMeta,
      hasPendingCloudSyncRef,
      setNotice,
      setSyncStatus,
    ],
  );

  const signIn = useCallback(async () => {
    setIsSigningIn(true);
    setNotice("");
    try {
      const redirectTo = typeof window !== "undefined" ? window.location.href : undefined;
      const { error } = await signInWithGoogleApi(redirectTo);
      if (error) setNotice(error.message || "Google 登入失敗。");
    } catch (error) {
      setNotice(getErrorMessage(error, "Google 登入失敗。"));
    } finally {
      setIsSigningIn(false);
    }
  }, [setIsSigningIn, setNotice]);

  const signOut = useCallback(async () => {
    const { error } = await signOutSupabase();
    if (error) {
      setNotice(error.message || "登出失敗。");
      return;
    }
    setNotice("已登出。");
  }, [setNotice]);

  return {
    // state — destructured for ergonomic consumer access.
    authState: state.authState,
    setupState: state.setupState,
    syncStatus: state.syncStatus,
    userEmail: state.userEmail,
    notice: state.notice,
    isBackupLoading: state.isBackupLoading,
    isSigningIn: state.isSigningIn,
    isHydrated: state.isHydrated,
    // derived
    cloudFeaturesEnabled,
    cloudSetupMessage,
    supabaseReady,
    // setters needed for orchestration in the parent component
    setNotice,
    setSyncStatus,
    setIsHydrated,
    // actions
    refreshBackup,
    syncToCloud,
    signIn,
    signOut,
  };
}
