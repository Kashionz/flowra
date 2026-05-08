export const DEV_MODE_USER = {
  id: "dev-mode-user",
  email: "dev-mode@flowra.local",
  aud: "authenticated",
  role: "authenticated",
};

export const DEV_MODE_CLOUD_BACKUP_STORAGE_KEY = "flowra.dev-mode.cloud-backup";

function readRuntimeFlag(name) {
  const runtime = typeof globalThis !== "undefined" ? globalThis : {};
  const env = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};
  const processEnv = typeof process !== "undefined" && process.env ? process.env : {};
  return runtime[name] ?? processEnv[name] ?? env[name] ?? "";
}

export function isFlowraDevMode() {
  const value = String(readRuntimeFlag("VITE_FLOWRA_DEV_MODE") || "")
    .trim()
    .toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function addMonths(baseMonth, delta) {
  const [yearText, monthText] = String(baseMonth || "").split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return "2026-01";
  }

  const total = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

export function readDevModeCloudBackup(storage) {
  const raw = storage?.getItem?.(DEV_MODE_CLOUD_BACKUP_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.payload || !parsed.updated_at) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeDevModeCloudBackup(storage, payload) {
  const record = {
    user_id: DEV_MODE_USER.id,
    updated_at: new Date().toISOString(),
    payload,
  };
  storage?.setItem?.(DEV_MODE_CLOUD_BACKUP_STORAGE_KEY, JSON.stringify(record));
  return record;
}

export function buildDevModeAiScenarioResponse({ scenario, userMessage }) {
  const text = String(userMessage || "").trim();
  const baseMonth = scenario?.meta?.baseMonth || "2026-01";

  if (!text) {
    return {
      kind: "clarify",
      questions: ["你想模擬哪個情境？例如買車、換工作、搬家或退休。"],
      used: 0,
      quota: 999,
    };
  }

  if (!/\d/.test(text) && !/買車|車貸|換工作|加薪|退休|搬家/.test(text)) {
    return {
      kind: "clarify",
      questions: ["這個情境大概會發生在哪一個月份？", "有沒有想一起帶進去的金額或每月支出變化？"],
      used: 0,
      quota: 999,
    };
  }

  if (/買車|車貸/.test(text)) {
    return {
      kind: "diff",
      diff: {
        summary: "開發者模式：模擬買車分期情境",
        changes: [
          {
            op: "add_installment",
            value: {
              name: "開發者模式車貸",
              principal: 600000,
              apr: 3,
              terms: 60,
              startMonth: addMonths(baseMonth, 1),
            },
            reason: "開發者模式 mock：用固定車貸資料驗證 AI 比較流程。",
          },
        ],
        warnings: ["開發者模式：這是本機 mock 資料，沒有呼叫真實 AI。"],
        explanation: `你輸入的是：${text}\n\n這是開發者模式提供的固定提議，用來驗證比較與套用流程。`,
      },
      used: 0,
      quota: 999,
    };
  }

  if (/換工作|加薪/.test(text)) {
    const currentSalary = Number(scenario?.basics?.monthlySalary || 0);
    return {
      kind: "diff",
      diff: {
        summary: "開發者模式：模擬加薪情境",
        changes: [
          {
            op: "set_basic",
            field: "monthlySalary",
            value: currentSalary + 10000,
            reason: "開發者模式 mock：固定增加月薪 1 萬。",
          },
        ],
        warnings: ["開發者模式：這是本機 mock 資料，沒有呼叫真實 AI。"],
        explanation: `你輸入的是：${text}\n\n這個 mock 會直接把月薪加 1 萬，方便測試 AI 提議套用。`,
      },
      used: 0,
      quota: 999,
    };
  }

  if (/退休/.test(text)) {
    return {
      kind: "diff",
      diff: {
        summary: "開發者模式：模擬退休情境",
        changes: [
          {
            op: "set_basic",
            field: "monthlySalary",
            value: 0,
            reason: "開發者模式 mock：退休後停止薪資收入。",
          },
          {
            op: "set_basic",
            field: "monthlySubsidy",
            value: 0,
            reason: "開發者模式 mock：一併停用補助。",
          },
        ],
        warnings: ["開發者模式：這是本機 mock 資料，沒有呼叫真實 AI。"],
        explanation: `你輸入的是：${text}\n\n這個 mock 會把薪水與補助歸零，方便測試退休類情境。`,
      },
      used: 0,
      quota: 999,
    };
  }

  return {
    kind: "diff",
    diff: {
      summary: "開發者模式：模擬單筆支出情境",
      changes: [
        {
          op: "add_one_time",
          value: {
            name: "開發者模式臨時支出",
            amount: 30000,
            kind: "expense",
            month: addMonths(baseMonth, 1),
          },
          reason: "開發者模式 mock：用固定單筆支出驗證 AI 流程。",
        },
      ],
      warnings: ["開發者模式：這是本機 mock 資料，沒有呼叫真實 AI。"],
      explanation: `你輸入的是：${text}\n\n這是預設 mock 提議，用來確認 AI 抽屜、比較與套用流程可正常運作。`,
    },
    used: 0,
    quota: 999,
  };
}
