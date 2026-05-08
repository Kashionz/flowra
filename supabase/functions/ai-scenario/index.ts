// supabase/functions/ai-scenario/index.ts
// Proxies user-prompted scenario diff requests to Anthropic, with auth + rate-limit.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.3";

const DAILY_QUOTA = 20;
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 2048;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const ALLOWED_OPS = [
  "add_one_time", "update_one_time", "remove_one_time",
  "add_installment", "update_installment", "remove_installment",
  "set_basic",
];
const ALLOWED_BASIC_FIELDS = [
  "monthlySalary", "monthlySubsidy", "monthlyRent", "monthlyLivingCost",
  "monthlyStudentLoan", "salaryStartsMonth", "subsidyStartsMonth", "monthsToProject",
];

const SYSTEM_PROMPT = `你是 Flowra 個人現金流模擬器的 AI 助理。你會收到使用者目前的 scenario JSON 與一段假設情境描述（如「明年 6 月買車 60 萬車貸 60 期 3% 年息」）。

你的任務：根據使用者的描述，呼叫 propose_scenario_diff 工具回傳一份結構化修改提議，讓使用者可以與當前情境比較。

絕對規則：
1. 你只能透過工具回應，不能輸出純文字。
2. 你**永遠不能**修改 startingTwd / jpyCash / jpyCashTwd / includeJpyCash / schemaVersion / meta — 這些代表使用者實際的資產與身份。
3. set_basic 的 field 只能是這些之一：${ALLOWED_BASIC_FIELDS.join(", ")}。
4. 所有金額單位是新台幣（TWD），所有月份格式是 "YYYY-MM"。
5. installment 的 startMonth 必須 ≥ scenario.meta.baseMonth，否則 dry-run 會拒絕。
6. 若使用者描述模糊或缺少關鍵數字（金額、月份、利率、期數），呼叫 request_clarification 工具反問，最多 5 輪後必須出 diff 或在 explanation 中說明放棄。
7. 在 warnings 陣列點出風險（例如：開銷暴增、首次見底提前、額度超出薪資 30%）。

回應風格：summary 一行 zh-TW、explanation 1-3 段 markdown、warnings 用 zh-TW 短句。`;

const TOOLS = [
  {
    name: "propose_scenario_diff",
    description: "回傳一份對使用者目前 scenario 的結構化修改提議。",
    input_schema: {
      type: "object",
      required: ["summary", "changes", "warnings", "explanation"],
      properties: {
        summary: { type: "string" },
        changes: {
          type: "array",
          items: {
            type: "object",
            required: ["op"],
            properties: {
              op: { type: "string", enum: ALLOWED_OPS },
              value: { type: "object" },
              id: { type: "string" },
              name: { type: "string" },
              field: { type: "string" },
              reason: { type: "string" },
            },
          },
        },
        warnings: { type: "array", items: { type: "string" } },
        explanation: { type: "string" },
      },
    },
  },
  {
    name: "request_clarification",
    description: "資訊不足時用這個反問使用者；不要用來閒聊。",
    input_schema: {
      type: "object",
      required: ["questions"],
      properties: {
        questions: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
      },
    },
  },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

function corsResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
    },
  });
}

function utc8DayKey(): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function sanitizeDiff(toolInput: any) {
  if (!toolInput || !Array.isArray(toolInput.changes)) {
    return { error: "invalid tool input" };
  }
  for (const c of toolInput.changes) {
    if (!ALLOWED_OPS.includes(c.op)) return { error: `forbidden op: ${c.op}` };
    if (c.op === "set_basic" && !ALLOWED_BASIC_FIELDS.includes(c.field)) {
      return { error: `forbidden basic field: ${c.field}` };
    }
  }
  return { value: toolInput };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  const auth = req.headers.get("authorization") || "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return jsonResponse({ error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return jsonResponse({ error: "model unavailable" }, 503);

  const userClient = createClient(supabaseUrl, serviceKey, {
    global: { headers: { authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
  if (userErr || !userData?.user) return jsonResponse({ error: "unauthorized" }, 401);
  const userId = userData.user.id;

  const admin = createClient(supabaseUrl, serviceKey);
  const day = utc8DayKey();
  const { data: usageRow } = await admin
    .from("ai_usage_log")
    .select("count")
    .eq("user_id", userId)
    .eq("day", day)
    .maybeSingle();
  const used = usageRow?.count ?? 0;
  if (used >= DAILY_QUOTA) {
    return jsonResponse({ error: "daily quota exhausted", used, quota: DAILY_QUOTA }, 429);
  }

  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: "invalid json" }, 400); }
  const { scenario, userMessage, history } = body || {};
  if (!scenario || typeof userMessage !== "string") {
    return jsonResponse({ error: "missing scenario or userMessage" }, 400);
  }

  const messages = [
    ...(Array.isArray(history) ? history : []),
    {
      role: "user",
      content: `當前 scenario JSON：\n${JSON.stringify(scenario)}\n\n使用者描述：${userMessage}`,
    },
  ];

  const aiRes = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages,
    }),
  });
  if (!aiRes.ok) {
    const txt = await aiRes.text();
    console.error("anthropic error", aiRes.status, txt);
    return jsonResponse({ error: "model failed" }, 502);
  }
  const aiBody = await aiRes.json();

  const toolUse = (aiBody.content || []).find((c: any) => c.type === "tool_use");
  if (!toolUse) {
    return jsonResponse({ error: "model did not call tool", raw: aiBody }, 502);
  }

  let payload: any;
  if (toolUse.name === "propose_scenario_diff") {
    const sanitized = sanitizeDiff(toolUse.input);
    if (sanitized.error) return jsonResponse({ error: sanitized.error }, 502);
    payload = { kind: "diff", diff: sanitized.value };
  } else if (toolUse.name === "request_clarification") {
    payload = { kind: "clarify", questions: toolUse.input?.questions || [] };
  } else {
    return jsonResponse({ error: `unexpected tool: ${toolUse.name}` }, 502);
  }

  await admin
    .from("ai_usage_log")
    .upsert({ user_id: userId, day, count: used + 1, updated_at: new Date().toISOString() }, {
      onConflict: "user_id,day",
    });

  return jsonResponse({ ...payload, used: used + 1, quota: DAILY_QUOTA });
});
