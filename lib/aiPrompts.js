// lib/aiPrompts.js
// 常數模組：system prompt + Anthropic tool schemas。Edge Function 與測試共用。

export const AI_MODEL = "claude-sonnet-4-6";
export const AI_MAX_TOKENS = 2048;

export const ALLOWED_BASIC_FIELDS = Object.freeze([
  "monthlySalary",
  "monthlySubsidy",
  "monthlyRent",
  "monthlyLivingCost",
  "monthlyStudentLoan",
  "salaryStartsMonth",
  "subsidyStartsMonth",
  "monthsToProject",
]);

export const FORBIDDEN_BASIC_FIELDS = Object.freeze([
  "startingTwd",
  "jpyCash",
  "jpyCashTwd",
  "includeJpyCash",
]);

export const ALLOWED_OPS = Object.freeze([
  "add_one_time",
  "update_one_time",
  "remove_one_time",
  "add_installment",
  "update_installment",
  "remove_installment",
  "set_basic",
]);

export const SYSTEM_PROMPT = `你是 Flowra 個人現金流模擬器的 AI 助理。你會收到使用者目前的 scenario JSON 與一段假設情境描述（如「明年 6 月買車 60 萬車貸 60 期 3% 年息」）。

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

export const PROPOSE_DIFF_TOOL = Object.freeze({
  name: "propose_scenario_diff",
  description: "回傳一份對使用者目前 scenario 的結構化修改提議。",
  input_schema: {
    type: "object",
    required: ["summary", "changes", "warnings", "explanation"],
    properties: {
      summary: { type: "string", description: "一行情境摘要" },
      changes: {
        type: "array",
        items: {
          type: "object",
          required: ["op"],
          properties: {
            op: { type: "string", enum: [...ALLOWED_OPS] },
            value: { type: "object" },
            id: { type: "string" },
            name: { type: "string" },
            field: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
      warnings: { type: "array", items: { type: "string" } },
      explanation: { type: "string", description: "1-3 段 markdown 解釋" },
    },
  },
});

export const REQUEST_CLARIFICATION_TOOL = Object.freeze({
  name: "request_clarification",
  description: "資訊不足時用這個反問使用者；不要用來閒聊。",
  input_schema: {
    type: "object",
    required: ["questions"],
    properties: {
      questions: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 4,
      },
    },
  },
});

export const TOOLS = Object.freeze([PROPOSE_DIFF_TOOL, REQUEST_CLARIFICATION_TOOL]);
