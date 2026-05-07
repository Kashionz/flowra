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

const ZH_ERROR_MESSAGES = [
  {
    pattern: /For security purposes, you can only request this after (\d+) seconds?\.?/i,
    translate: (match) => `為了帳號安全，請稍候 ${match[1]} 秒後再重新寄送驗證信。`,
  },
  { pattern: /email rate limit exceeded/i, message: "信件寄送已達流量上限，請稍後再試。" },
  { pattern: /over.?email.?send.?rate.?limit/i, message: "信件寄送已達流量上限，請稍後再試。" },
  { pattern: /rate limit/i, message: "操作過於頻繁，請稍後再試。" },
  { pattern: /too many requests/i, message: "操作過於頻繁，請稍後再試。" },
  { pattern: /invalid login credentials/i, message: "登入資訊有誤，請重新確認。" },
  { pattern: /invalid email( or password)?/i, message: "信箱格式有誤，請重新輸入。" },
  { pattern: /unable to validate email address/i, message: "信箱格式有誤，請重新輸入。" },
  { pattern: /email not confirmed/i, message: "信箱尚未驗證，請點擊驗證信中的連結後再試。" },
  {
    pattern: /email link is invalid or has expired/i,
    message: "驗證連結已失效，請重新寄送驗證信。",
  },
  { pattern: /token (has )?expired/i, message: "驗證連結已逾時，請重新寄送驗證信。" },
  { pattern: /token (is )?invalid/i, message: "驗證連結無效，請重新寄送驗證信。" },
  { pattern: /jwt expired/i, message: "登入狀態已逾時，請重新登入。" },
  { pattern: /invalid jwt/i, message: "登入狀態無效，請重新登入。" },
  { pattern: /user not found/i, message: "找不到此帳號，請確認信箱後再試。" },
  { pattern: /user already registered/i, message: "此信箱已註冊，請直接寄送驗證信登入。" },
  { pattern: /signup(s)? (is |are )?disabled/i, message: "目前不開放註冊，請聯絡管理員。" },
  { pattern: /anonymous sign[- ]?ins are disabled/i, message: "目前不開放匿名登入。" },
  {
    pattern: /password should be at least (\d+)/i,
    translate: (match) => `密碼長度至少需 ${match[1]} 個字元。`,
  },
  { pattern: /password is too short/i, message: "密碼太短，請使用更長的密碼。" },
  { pattern: /weak password/i, message: "密碼強度不足，請改用更安全的密碼。" },
  { pattern: /invalid api key/i, message: "雲端設定的金鑰無效，請聯絡管理員。" },
  { pattern: /missing api key/i, message: "雲端設定缺少金鑰，請聯絡管理員。" },
  {
    pattern: /(failed to fetch|network ?request ?failed|networkerror)/i,
    message: "網路連線異常，請確認網路後再試。",
  },
  { pattern: /timeout|timed out/i, message: "連線逾時，請稍後再試。" },
  {
    pattern: /(permission denied|not authorized|unauthorized)/i,
    message: "權限不足，請重新登入後再試。",
  },
  { pattern: /row[- ]level security/i, message: "權限不足，請重新登入後再試。" },
  { pattern: /duplicate key|already exists/i, message: "資料已存在，請改用更新或還原。" },
  {
    pattern: /payload too large|request entity too large/i,
    message: "資料過大，無法上傳，請先移除部分內容。",
  },
  {
    pattern:
      /(internal server error|server error|service unavailable|bad gateway|gateway timeout)/i,
    message: "雲端服務暫時無法回應，請稍後再試。",
  },
];

function translateFlowraSupabaseMessage(message) {
  for (const entry of ZH_ERROR_MESSAGES) {
    const match = message.match(entry.pattern);
    if (match) {
      return entry.translate ? entry.translate(match) : entry.message;
    }
  }
  return null;
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

  const translated = translateFlowraSupabaseMessage(message);
  if (translated) {
    return new Error(translated);
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
    const probe = await supabase
      .from(BACKUP_TABLE)
      .select("user_id", { head: true, count: "exact" })
      .limit(1);
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
      "讀取帳號狀態逾時，請重新登入後再試。",
    );
    return { user: data?.user || null, error: error || null };
  } catch (error) {
    return { user: null, error: normalizeUnknownError(error, "帳號狀態讀取失敗。") };
  }
}

export async function signInWithGoogle(redirectTo) {
  const supabase = createFlowraSupabaseClient();
  if (!supabase) {
    return { error: new Error(getSupabaseConfigHint()) };
  }

  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo:
          redirectTo || (typeof window !== "undefined" ? window.location.href : undefined),
        queryParams: { prompt: "select_account" },
      },
    });

    return { error: normalizeFlowraSupabaseError(error) };
  } catch (error) {
    return { error: normalizeUnknownError(error, "Google 登入失敗。") };
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
      "讀取雲端備份逾時，請稍後再試。",
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
          { onConflict: "user_id" },
        )
        .select("user_id,updated_at,payload")
        .single(),
      8000,
      "寫入雲端備份逾時，請稍後再試。",
    );

    return { ...result, error: normalizeFlowraSupabaseError(result.error) };
  } catch (error) {
    return { data: null, error: normalizeUnknownError(error, "同步雲端備份失敗。") };
  }
}

export { BACKUP_TABLE };
