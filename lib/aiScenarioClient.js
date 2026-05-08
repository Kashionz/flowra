// lib/aiScenarioClient.js
// Frontend wrapper for the ai-scenario edge function. Uses the Supabase
// functions client so auth + apikey headers stay aligned with the active
// browser session, then translates errors to zh-TW.

import { buildDevModeAiScenarioResponse, isFlowraDevMode } from "./flowraDevMode.js";

const ZH_AI_ERRORS = {
  unauthorized: "請先登入才能使用 AI 輔助分析。",
  "daily quota exhausted": "今日 AI 輔助分析額度已用罄，明天再試。",
  "model unavailable": "AI 服務暫時未啟用，請聯絡管理員。",
  overloaded_error: "AI 服務目前繁忙，請稍後再試。",
  rate_limit_error: "AI 服務目前繁忙，請稍後再試。",
  invalid_request_error: "AI 請求格式暫時有誤，請重新描述或稍後再試。",
  "model failed": "AI 模型暫時無法回應，請稍後再試。",
  "model did not call tool": "AI 回應格式錯誤，請重試或重新描述。",
};

function translateError(msg) {
  if (!msg) return "AI 輔助分析失敗，請稍後再試。";
  for (const key of Object.keys(ZH_AI_ERRORS)) {
    if (msg.toLowerCase().includes(key)) return ZH_AI_ERRORS[key];
  }
  return `AI 輔助分析失敗：${msg}`;
}

function isAbortLikeError(error) {
  const context = error?.context;
  const candidates = [
    error?.name,
    context?.name,
    error?.message,
    context?.message,
    context?.cause?.name,
    context?.cause?.message,
  ]
    .filter(Boolean)
    .map((value) => String(value));

  return candidates.some((value) => value === "AbortError" || /abort(ed)?/i.test(value));
}

function createAbortError(error) {
  const message =
    error?.context?.message ||
    error?.cause?.message ||
    error?.message ||
    "The operation was aborted.";
  if (typeof DOMException !== "undefined") {
    return new DOMException(message, "AbortError");
  }
  const abortError = new Error(message);
  abortError.name = "AbortError";
  return abortError;
}

async function readFunctionErrorMessage(error) {
  const response = error?.context;
  if (response && typeof response.json === "function") {
    try {
      const body = await response.json();
      if (typeof body === "string") return body;
      if (body && typeof body === "object" && body.error) {
        return String(body.error);
      }
    } catch {
      // Ignore parse errors and fall back to generic error fields below.
    }
  }

  if (response && typeof response.text === "function") {
    try {
      const text = await response.text();
      if (text) return text;
    } catch {
      // Ignore text read failures and fall back to message.
    }
  }

  return error?.message || "";
}

async function getSessionAccessToken(supabase) {
  const { data: sessionData } = await supabase.auth.getSession();
  let token = sessionData?.session?.access_token || "";
  if (token) return token;

  if (typeof supabase.auth.refreshSession === "function") {
    const { data: refreshedData, error } = await supabase.auth.refreshSession();
    if (error) throw error;
    token = refreshedData?.session?.access_token || "";
  }

  return token;
}

export async function callAiScenario(supabase, { scenario, userMessage, history = [], signal }) {
  if (isFlowraDevMode()) {
    if (signal?.aborted) {
      throw createAbortError({ message: "The operation was aborted." });
    }
    return buildDevModeAiScenarioResponse({ scenario, userMessage, history });
  }

  if (!supabase?.functions?.invoke || !supabase?.auth?.getSession) {
    throw new Error(translateError("unauthorized"));
  }

  const accessToken = await getSessionAccessToken(supabase);
  if (!accessToken) throw new Error(translateError("unauthorized"));

  const invokeOptions = {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: { scenario, userMessage, history },
  };

  if (signal) {
    invokeOptions.signal = signal;
  }

  const { data, error } = await supabase.functions.invoke("ai-scenario", invokeOptions);

  if (error) {
    if (isAbortLikeError(error)) {
      throw createAbortError(error);
    }
    throw new Error(translateError(await readFunctionErrorMessage(error)));
  }

  return data;
}
