// lib/aiScenarioClient.js
// Frontend wrapper for the ai-scenario edge function. Handles auth header
// derivation from the active supabase session and translates errors to zh-TW.

const ZH_AI_ERRORS = {
  unauthorized: "請先登入才能使用 AI 模擬。",
  "daily quota exhausted": "今日 AI 模擬額度已用罄，明天再試。",
  "model unavailable": "AI 服務暫時未啟用，請聯絡管理員。",
  "model failed": "AI 模型暫時無法回應，請稍後再試。",
  "model did not call tool": "AI 回應格式錯誤，請重試或重新描述。",
};

function functionUrl(supabaseUrl) {
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/ai-scenario`;
}

function translateError(msg) {
  if (!msg) return "AI 模擬失敗，請稍後再試。";
  for (const key of Object.keys(ZH_AI_ERRORS)) {
    if (msg.toLowerCase().includes(key)) return ZH_AI_ERRORS[key];
  }
  return `AI 模擬失敗：${msg}`;
}

export async function callAiScenario(supabase, { scenario, userMessage, history = [] }) {
  if (!supabase) throw new Error(translateError("unauthorized"));
  const { data: sess } = await supabase.auth.getSession();
  const token = sess?.session?.access_token;
  if (!token) throw new Error(translateError("unauthorized"));

  const url = functionUrl(supabase.supabaseUrl || "");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ scenario, userMessage, history }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(translateError(data.error));
  return data;
}
