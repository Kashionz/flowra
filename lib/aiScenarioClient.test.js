import test from "node:test";
import assert from "node:assert/strict";
import { callAiScenario } from "./aiScenarioClient.js";

const baseScenario = {
  schemaVersion: 1,
  meta: {
    name: "目前情境",
    description: "",
    baseMonth: "2026-01",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  basics: {
    startingTwd: 100000,
    jpyCash: 0,
    jpyCashTwd: 0,
    includeJpyCash: false,
    monthlySalary: 50000,
    salaryStartsMonth: "2026-01",
    monthlySubsidy: 0,
    subsidyStartsMonth: "2026-01",
    monthlyRent: 15000,
    monthlyLivingCost: 25000,
    monthlyStudentLoan: 0,
    monthsToProject: 12,
  },
  oneTimeItems: [],
  installments: [],
};

test("callAiScenario uses Supabase functions client with explicit bearer token", async () => {
  const originalFetch = globalThis.fetch;
  let invoked = null;

  globalThis.fetch = async () => {
    throw new Error("raw fetch should not be used");
  };

  try {
    const supabase = {
      auth: {
        getSession: async () => ({
          data: { session: { access_token: "fake-jwt" } },
        }),
      },
      functions: {
        invoke: async (name, options) => {
          invoked = { name, options };
          return {
            data: { kind: "clarify", questions: ["請補充月份"], used: 1, quota: 20 },
            error: null,
          };
        },
      },
    };

    const result = await callAiScenario(supabase, {
      scenario: baseScenario,
      userMessage: "明年買車",
      history: [{ role: "user", content: "先前訊息" }],
    });

    assert.deepEqual(result, {
      kind: "clarify",
      questions: ["請補充月份"],
      used: 1,
      quota: 20,
    });
    assert.deepEqual(invoked, {
      name: "ai-scenario",
      options: {
        headers: {
          Authorization: "Bearer fake-jwt",
        },
        body: {
          scenario: baseScenario,
          userMessage: "明年買車",
          history: [{ role: "user", content: "先前訊息" }],
        },
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("callAiScenario refreshes the session when cached access token is missing", async () => {
  let refreshed = false;
  let invoked = null;
  const supabase = {
    auth: {
      getSession: async () => ({
        data: { session: null },
      }),
      refreshSession: async () => {
        refreshed = true;
        return {
          data: { session: { access_token: "refreshed-jwt" } },
          error: null,
        };
      },
    },
    functions: {
      invoke: async (name, options) => {
        invoked = { name, options };
        return {
          data: { kind: "clarify", questions: ["請補充月份"], used: 1, quota: 20 },
          error: null,
        };
      },
    },
  };

  await callAiScenario(supabase, {
    scenario: baseScenario,
    userMessage: "明年買車",
  });

  assert.equal(refreshed, true);
  assert.equal(invoked?.options?.headers?.Authorization, "Bearer refreshed-jwt");
});

test("callAiScenario forwards AbortSignal to the Supabase functions client", async () => {
  let invoked = null;
  const controller = new AbortController();
  const supabase = {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "fake-jwt" } },
      }),
    },
    functions: {
      invoke: async (name, options) => {
        invoked = { name, options };
        return {
          data: { kind: "clarify", questions: ["請補充月份"], used: 1, quota: 20 },
          error: null,
        };
      },
    },
  };

  await callAiScenario(supabase, {
    scenario: baseScenario,
    userMessage: "明年買車",
    signal: controller.signal,
  });

  assert.equal(invoked?.name, "ai-scenario");
  assert.equal(invoked?.options?.signal, controller.signal);
});

test("callAiScenario rethrows aborted invoke requests as AbortError", async () => {
  const supabase = {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "fake-jwt" } },
      }),
    },
    functions: {
      invoke: async () => ({
        data: null,
        error: {
          name: "FunctionsFetchError",
          message: "Failed to send a request to the Edge Function",
          context: { name: "AbortError", message: "The operation was aborted." },
        },
      }),
    },
  };

  await assert.rejects(
    () =>
      callAiScenario(supabase, {
        scenario: baseScenario,
        userMessage: "明年買車",
      }),
    (error) => error?.name === "AbortError",
  );
});

test("callAiScenario translates function unauthorized errors", async () => {
  const supabase = {
    functions: {
      invoke: async () => ({
        data: null,
        error: {
          context: {
            json: async () => ({ error: "unauthorized" }),
          },
        },
      }),
    },
  };

  await assert.rejects(
    () =>
      callAiScenario(supabase, {
        scenario: baseScenario,
        userMessage: "明年買車",
      }),
    /請先登入才能使用 AI 輔助分析/,
  );
});

test("callAiScenario returns a mock proposal in dev mode without Supabase auth", async () => {
  const previous = process.env.VITE_FLOWRA_DEV_MODE;
  process.env.VITE_FLOWRA_DEV_MODE = "1";

  try {
    const result = await callAiScenario(null, {
      scenario: baseScenario,
      userMessage: "明年買車 60 萬車貸 60 期 3%",
    });

    assert.equal(result.kind, "diff");
    assert.match(result.diff.summary, /開發者模式/);
    assert.ok(result.diff.changes.length > 0);
  } finally {
    if (previous === undefined) delete process.env.VITE_FLOWRA_DEV_MODE;
    else process.env.VITE_FLOWRA_DEV_MODE = previous;
  }
});
