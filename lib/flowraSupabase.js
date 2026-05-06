import { createClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";

const SCENARIO_TABLE = "flowra_scenarios";
const SHARE_TABLE = "flowra_share_links";
const MIGRATION_HINT = "Supabase 尚未完整套用 Flowra 雲端 migration，請先執行 supabase/migrations/ 內的 SQL。";
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
  return "請設定 Supabase URL 與 publishable key。瀏覽器預覽請優先使用 VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY。";
}

function normalizeFlowraSupabaseError(error) {
  if (!error) return null;

  if (error.code === "PGRST205") {
    return new Error(MIGRATION_HINT);
  }

  if (error.code === "PGRST202") {
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
    const [shareProbe, scenarioProbe] = await Promise.all([
      supabase.from(SHARE_TABLE).select("slug", { head: true, count: "exact" }).limit(1),
      supabase.from(SCENARIO_TABLE).select("id", { head: true, count: "exact" }).limit(1),
    ]);
    const normalizedError = normalizeFlowraSupabaseError(shareProbe.error || scenarioProbe.error);
    return { ready: !normalizedError, error: normalizedError };
  } catch (error) {
    return { ready: false, error: normalizeUnknownError(error, "Supabase Flowra 雲端狀態檢查失敗。") };
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
      "讀取 Supabase 使用者狀態逾時，請重新登入後再試。"
    );
    return { user: data?.user || null, error: error || null };
  } catch (error) {
    return { user: null, error: normalizeUnknownError(error, "Supabase 使用者狀態讀取失敗。") };
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
    return { error: normalizeUnknownError(error, "Supabase 登出失敗。") };
  }
}

export async function listCloudScenarios() {
  const supabase = createFlowraSupabaseClient();
  if (!supabase) {
    return { data: [], error: new Error(getSupabaseConfigHint()) };
  }

  try {
    const { user, error: authError } = await getCurrentSupabaseUser();
    if (authError || !user) {
      return { data: [], error: authError || new Error("需登入後才能讀取雲端版本。") };
    }

    const result = await withTimeout(
      supabase
        .from(SCENARIO_TABLE)
        .select("id,name,description,base_month,updated_at,payload")
        .order("updated_at", { ascending: false }),
      8000,
      "讀取雲端版本逾時，請稍後再試。"
    );

    return { ...result, error: normalizeFlowraSupabaseError(result.error) };
  } catch (error) {
    return { data: [], error: normalizeUnknownError(error, "讀取雲端版本失敗。") };
  }
}

export async function upsertCloudScenario({ id, name, description, baseMonth, payload }) {
  const supabase = createFlowraSupabaseClient();
  if (!supabase) {
    return { data: null, error: new Error(getSupabaseConfigHint()) };
  }

  try {
    const { data: authData, error: authError } = await withTimeout(
      supabase.auth.getUser(),
      6000,
      "讀取 Supabase 使用者狀態逾時，請重新登入後再試。"
    );
    if (authError || !authData?.user) {
      return { data: null, error: authError || new Error("需登入後才能同步到雲端。") };
    }

    const result = await withTimeout(
      supabase
        .from(SCENARIO_TABLE)
        .upsert(
          {
            id: id || undefined,
            user_id: authData.user.id,
            name,
            description,
            base_month: baseMonth,
            payload,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        )
        .select()
        .single(),
      8000,
      "寫入雲端版本逾時，請稍後再試。"
    );

    return { ...result, error: normalizeFlowraSupabaseError(result.error) };
  } catch (error) {
    return { data: null, error: normalizeUnknownError(error, "同步雲端失敗。") };
  }
}

export async function createShortShareLink({ payload, readonly }) {
  const supabase = createFlowraSupabaseClient();
  if (!supabase) {
    return { data: null, error: new Error(getSupabaseConfigHint()) };
  }

  try {
    const slug = nanoid(6);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { user, error: authError } = await getCurrentSupabaseUser();
    if (authError || !user) {
      return { data: null, error: authError || new Error("需登入後才能建立短網址。") };
    }

    const result = await withTimeout(
      supabase
        .from(SHARE_TABLE)
        .insert({
          slug,
          owner_user_id: user.id,
          payload,
          readonly,
          expires_at: expiresAt,
          view_count: 0,
        })
        .select("slug,expires_at,readonly")
        .single(),
      8000,
      "建立短網址逾時，請稍後再試。"
    );

    return { ...result, error: normalizeFlowraSupabaseError(result.error) };
  } catch (error) {
    return { data: null, error: normalizeUnknownError(error, "建立短網址失敗。") };
  }
}

export async function resolveShortShareLink(slug) {
  const supabase = createFlowraSupabaseClient();
  if (!supabase) {
    return { data: null, error: new Error(getSupabaseConfigHint()) };
  }

  try {
    const now = new Date().toISOString();
    const { data, error } = await withTimeout(
      supabase
        .from(SHARE_TABLE)
        .select("slug,payload,readonly,expires_at,view_count")
        .eq("slug", slug)
        .gt("expires_at", now)
        .single(),
      8000,
      "分享連結讀取逾時，請稍後再試。"
    );

    const normalizedError = normalizeFlowraSupabaseError(error);
    if (normalizedError || !data) {
      return { data: null, error: normalizedError || new Error("分享連結不存在或已過期。") };
    }

    const rpcResult = await withTimeout(
      supabase.rpc("increment_flowra_share_view_count", { target_slug: slug }),
      8000,
      "分享連結統計更新逾時，請稍後再試。"
    );
    if (rpcResult.error) {
      return { data: null, error: normalizeFlowraSupabaseError(rpcResult.error) || new Error("分享連結統計更新失敗。") };
    }

    return { data, error: null };
  } catch (error) {
    return { data: null, error: normalizeUnknownError(error, "分享連結讀取失敗。") };
  }
}

export { SCENARIO_TABLE, SHARE_TABLE };
