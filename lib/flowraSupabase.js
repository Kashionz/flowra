import { createClient } from "@supabase/supabase-js";

const BACKUP_TABLE = "flowra_backups";
const MIGRATION_HINT = "雲端備份目前暫時不可用，請稍後再試。";
let cachedSupabaseClient = null;
let cachedSupabaseConfigKey = "";

function readRuntimeConfig() {
  const runtime = typeof globalThis !== "undefined" ? globalThis : {};
  const env = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};
  const processEnv = typeof process !== "undefined" && process.env ? process.env : {};
  return {
    url:
      runtime.FLOWRA_SUPABASE_URL ||
      processEnv.FLOWRA_SUPABASE_URL ||
      env.FLOWRA_SUPABASE_URL ||
      env.VITE_SUPABASE_URL ||
      "",
    key:
      runtime.FLOWRA_SUPABASE_PUBLISHABLE_KEY ||
      processEnv.FLOWRA_SUPABASE_PUBLISHABLE_KEY ||
      env.FLOWRA_SUPABASE_PUBLISHABLE_KEY ||
      env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      env.VITE_SUPABASE_ANON_KEY ||
      "",
  };
}

export function isSupabaseConfigured() {
  const { url, key } = readRuntimeConfig();
  return Boolean(url && key);
}

export function getSupabaseConfigHint() {
  return "雲端備份目前尚未開啟。";
}

function normalizeFlowraSupabaseError(error) {
  if (!error) return null;

  if (error.code === "PGRST205" || error.code === "PGRST202") {
    return new Error(MIGRATION_HINT);
  }

  const message = String(error.message || "");
  if (
    message.includes("Could not find the table") ||
    message.includes("Could not find the function") ||
    message.includes("relation") ||
    message.includes("does not exist")
  ) {
    return new Error(MIGRATION_HINT);
  }

  return error;
}

function normalizeUnknownError(error, fallbackMessage) {
  if (!error) {
    return new Error(fallbackMessage);
  }
  if (error instanceof Error) {
    return normalizeFlowraSupabaseError(error) || new Error(fallbackMessage);
  }
  if (typeof error === "object" && error !== null) {
    const normalized = normalizeFlowraSupabaseError(error);
    if (normalized) {
      return normalized;
    }
    const message = "message" in error ? String(error.message || fallbackMessage) : fallbackMessage;
    return new Error(message);
  }
  return new Error(String(error || fallbackMessage));
}

function withTimeout(promise, timeoutMs, message) {
  let timerId;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = globalThis.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    globalThis.clearTimeout(timerId);
  });
}

export function createFlowraSupabaseClient() {
  const { url, key } = readRuntimeConfig();
  if (!url || !key) return null;
  const configKey = `${url}::${key}`;
  if (cachedSupabaseClient && cachedSupabaseConfigKey === configKey) {
    return cachedSupabaseClient;
  }
  cachedSupabaseClient = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  cachedSupabaseConfigKey = configKey;
  return cachedSupabaseClient;
}

export async function checkFlowraCloudSetup() {
  const supabase = createFlowraSupabaseClient();
  if (!supabase) {
    return { ready: false, error: new Error(getSupabaseConfigHint()) };
  }

  try {
    const probe = await supabase.from(BACKUP_TABLE).select("user_id", { head: true, count: "exact" }).limit(1);
    const normalizedError = normalizeFlowraSupabaseError(probe.error);
    return { ready: !normalizedError, error: normalizedError };
  } catch (error) {
    return { ready: false, error: normalizeUnknownError(error, "雲端備份狀態檢查失敗。") };
  }
}

export async function getCurrentSupabaseUser() {
  const supabase = createFlowraSupabaseClient();
  if (!supabase) {
    return { user: null, error: new Error(getSupabaseConfigHint()) };
  }

  try {
    const { data, error } = await withTimeout(
      supabase.auth.getUser(),
      6000,
      "讀取帳號狀態逾時，請重新登入後再試。"
    );
    return { user: data?.user || null, error: error || null };
  } catch (error) {
    return { user: null, error: normalizeUnknownError(error, "帳號狀態讀取失敗。") };
  }
}

export async function sendSupabaseMagicLink(email, redirectTo) {
  const supabase = createFlowraSupabaseClient();
  if (!supabase) {
    return { error: new Error(getSupabaseConfigHint()) };
  }

  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
    });

    return { error: normalizeFlowraSupabaseError(error) };
  } catch (error) {
    return { error: normalizeUnknownError(error, "登入連結寄送失敗。") };
  }
}

export async function signOutSupabase() {
  const supabase = createFlowraSupabaseClient();
  if (!supabase) {
    return { error: new Error(getSupabaseConfigHint()) };
  }

  try {
    const { error } = await supabase.auth.signOut();
    return { error: normalizeFlowraSupabaseError(error) };
  } catch (error) {
    return { error: normalizeUnknownError(error, "登出失敗。") };
  }
}

export async function getLatestCloudBackup() {
  const supabase = createFlowraSupabaseClient();
  if (!supabase) {
    return { data: null, error: new Error(getSupabaseConfigHint()) };
  }

  try {
    const { user, error: authError } = await getCurrentSupabaseUser();
    if (authError || !user) {
      return { data: null, error: authError || new Error("需登入後才能讀取雲端備份。") };
    }

    const result = await withTimeout(
      supabase
        .from(BACKUP_TABLE)
        .select("user_id,updated_at,payload")
        .eq("user_id", user.id)
        .maybeSingle(),
      8000,
      "讀取雲端備份逾時，請稍後再試。"
    );

    return { ...result, error: normalizeFlowraSupabaseError(result.error) };
  } catch (error) {
    return { data: null, error: normalizeUnknownError(error, "讀取雲端備份失敗。") };
  }
}

export async function upsertCloudBackup({ payload }) {
  const supabase = createFlowraSupabaseClient();
  if (!supabase) {
    return { data: null, error: new Error(getSupabaseConfigHint()) };
  }

  try {
    const { user, error: authError } = await getCurrentSupabaseUser();
    if (authError || !user) {
      return { data: null, error: authError || new Error("需登入後才能同步到雲端備份。") };
    }

    const result = await withTimeout(
      supabase
        .from(BACKUP_TABLE)
        .upsert(
          {
            user_id: user.id,
            payload,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        )
        .select("user_id,updated_at,payload")
        .single(),
      8000,
      "寫入雲端備份逾時，請稍後再試。"
    );

    return { ...result, error: normalizeFlowraSupabaseError(result.error) };
  } catch (error) {
    return { data: null, error: normalizeUnknownError(error, "同步雲端備份失敗。") };
  }
}

export { BACKUP_TABLE };
