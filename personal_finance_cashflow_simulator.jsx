import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./styles/flowra.css";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CHART_COLORS,
  CHART_THEME_VARS,
  ChartSurface,
  ChartTooltip,
  ChartTooltipCard,
} from "./components/ui/chart.jsx";
import { TEMPLATE_DEFINITIONS } from "./lib/templates/index.js";
import { useUndoableState } from "./hooks/useScenarioHistory.js";
import { useCloudSync } from "./hooks/useCloudSync.js";
import { useSnackbar } from "./hooks/useSnackbar.js";
import UndoSnackbar from "./components/UndoSnackbar.jsx";
import KeyboardShortcutsDialog from "./components/KeyboardShortcutsDialog.jsx";
import { clampDropdownRight, clampTooltipLeft } from "./lib/clampViewport.js";
import { DATA_MANAGEMENT_ACTIONS, getImportReplaceNotice } from "./lib/dataManagementOptions.js";
import { makeItemId, syncItemIdSequenceFromScenario } from "./lib/itemIds.js";
import { describeHydrationDecision } from "./lib/hydrationNotice.js";
import { computeImportDiff } from "./lib/importDiff.js";
import { readInitialBoot } from "./lib/initialBoot.js";
import { CATEGORY_META, CATEGORY_OPTIONS } from "./lib/expenseCategories.js";
import {
  addMonths,
  buildProjection,
  clampMonthIndex,
  currency,
  decorateInstallments,
  currentBaseMonth,
  exportFileBase,
  formatMonthLabel,
  formatYearMonth,
  maskCurrency,
  n,
  parseYearMonth,
  reserveTarget,
  resolveJpyCashTwd,
} from "./lib/finance.js";
import {
  getNumericInputDisplayValue,
  normalizeNumericInput,
  stepNumericValue,
} from "./lib/numberField.js";
import {
  FALLBACK_JPY_TO_TWD_RATE,
  fetchJpyToTwdRate,
  getCachedJpyToTwdRate,
  saveJpyToTwdRate,
  todayKey as jpyTodayKey,
} from "./lib/jpyExchangeRate.js";
import {
  clearPendingCloudSync,
  formatAutoSyncStatus,
  readDraftScenario,
  readPendingCloudSync,
  resolveInitialCloudSyncStatus,
  resolveHydrationSource,
  writeDraftScenario,
  writePendingCloudSync,
} from "./lib/scenarioPersistence.js";
import { createFlowraSupabaseClient } from "./lib/flowraSupabase.js";
import AIScenarioChat from "./components/AIScenarioChat.jsx";
import ScenarioCompareView from "./components/ScenarioCompareView.jsx";
import { applyDiff } from "./lib/aiScenarioDiff.js";
import { callAiScenario } from "./lib/aiScenarioClient.js";
import { getAiStreamingStatusText } from "./lib/aiStreamingStatus.js";
import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  BarChart as RechartsBarChart,
  Bar,
  AreaChart as RechartsAreaChart,
  Area,
  Cell,
  LabelList,
  Customized,
} from "recharts";

const SCHEMA_VERSION = 1;
const LEGACY_SCENARIO_NAME = "有房貸租屋族";
const RENAMED_SCENARIO_NAME = "目前情境";
const STORAGE_SESSION_META_KEY = "flowra.cashflow.session-meta";
const SESSION_META_DEFAULT = {
  lastOpenedAt: "",
  lastSyncedAt: "",
  lastSyncAttemptAt: "",
};
const AI_DIFF_READY_MESSAGE = "我先整理成一份 B 情境提議，你可以先預覽，再決定要不要套用。";

function normalizeLegacyScenarioName(value) {
  const text = String(value || "").trim();
  if (!text || !text.includes(LEGACY_SCENARIO_NAME)) return text;
  return text.replaceAll(LEGACY_SCENARIO_NAME, RENAMED_SCENARIO_NAME);
}

function normalizeScenarioMeta(meta = {}, fallbackMeta = {}) {
  return {
    ...fallbackMeta,
    ...meta,
    name: normalizeLegacyScenarioName(meta.name || fallbackMeta.name || RENAMED_SCENARIO_NAME),
  };
}

function createDefaultScenario() {
  const baseMonth = currentBaseMonth();
  const template = TEMPLATE_DEFINITIONS.current;
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      name: template.label.replace(/^[^\s]+\s/, ""),
      description: template.description,
      baseMonth,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    basics: {
      startingTwd: template.basics.startingTwd,
      jpyCash: n(template.basics.jpyCash),
      jpyCashTwd: n(template.basics.jpyCashTwd),
      includeJpyCash: template.basics.includeJpyCash,
      monthlySalary: template.basics.monthlySalary,
      salaryStartsMonth: addMonths(baseMonth, template.basics.salaryStartsOffset),
      monthlySubsidy: template.basics.monthlySubsidy,
      subsidyStartsMonth: addMonths(baseMonth, template.basics.subsidyStartsOffset),
      monthlyRent: template.basics.monthlyRent,
      monthlyLivingCost: template.basics.monthlyLivingCost,
      monthlyStudentLoan: template.basics.monthlyStudentLoan,
      monthsToProject: template.basics.monthsToProject,
    },
    oneTimeItems: template.oneTimeItems.map((item) => ({
      id: makeItemId("one-time"),
      name: item.name,
      amount: item.amount,
      month: addMonths(baseMonth, item.monthOffset),
      type: item.type,
      category: item.category,
    })),
    installments: template.installments.map((item) => ({
      id: makeItemId("installment"),
      name: item.name,
      principal: item.principal,
      apr: item.apr,
      terms: item.terms,
      startMonth: addMonths(baseMonth, item.startOffset),
    })),
  };
}

function cloneScenario(scenario, patch = {}) {
  return {
    ...scenario,
    ...patch,
    meta: {
      ...scenario.meta,
      ...(patch.meta || {}),
    },
    basics: {
      ...scenario.basics,
      ...(patch.basics || {}),
    },
    oneTimeItems: patch.oneTimeItems || scenario.oneTimeItems.map((item) => ({ ...item })),
    installments: patch.installments || scenario.installments.map((item) => ({ ...item })),
  };
}

function migrateLegacyScenario(raw) {
  const template = createDefaultScenario();
  if (!raw || typeof raw !== "object") {
    return template;
  }

  if (raw.schemaVersion === SCHEMA_VERSION && raw.meta && raw.basics) {
    return cloneScenario(template, {
      ...raw,
      meta: normalizeScenarioMeta(
        {
          ...(raw.meta || {}),
          updatedAt: raw.meta?.updatedAt || new Date().toISOString(),
        },
        template.meta,
      ),
      basics: {
        ...template.basics,
        ...(raw.basics || {}),
      },
      oneTimeItems: Array.isArray(raw.oneTimeItems)
        ? raw.oneTimeItems.map((item) => ({
            id: item.id || makeItemId("one-time"),
            name: item.name || "未命名項目",
            amount: n(item.amount),
            month: item.month || addMonths(raw.meta?.baseMonth || template.meta.baseMonth, 0),
            type: item.type === "income" ? "income" : "expense",
            category: CATEGORY_OPTIONS.includes(item.category) ? item.category : "other",
          }))
        : [],
      installments: Array.isArray(raw.installments)
        ? raw.installments.map((item) => ({
            id: item.id || makeItemId("installment"),
            name: item.name || "未命名分期",
            principal: n(item.principal),
            apr: n(item.apr),
            terms: Math.max(1, Math.round(n(item.terms))),
            startMonth:
              item.startMonth || addMonths(raw.meta?.baseMonth || template.meta.baseMonth, 0),
          }))
        : [],
    });
  }

  const baseMonth = raw.baseMonth || currentBaseMonth();
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: normalizeScenarioMeta(
      {
        name: raw.name || "升級後備份",
        description: "由舊版 month index 自動轉換",
        baseMonth,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      template.meta,
    ),
    basics: {
      startingTwd: n(raw.startingTwd),
      jpyCash: n(raw.jpyCash),
      jpyCashTwd: n(raw.jpyCashTwd),
      includeJpyCash: raw.includeJpyCash !== false,
      monthlySalary: n(raw.monthlySalary),
      salaryStartsMonth: addMonths(baseMonth, clampMonthIndex(raw.salaryStartsMonth)),
      monthlySubsidy: n(raw.monthlySubsidy),
      subsidyStartsMonth: addMonths(baseMonth, clampMonthIndex(raw.subsidyStartsMonth)),
      monthlyRent: n(raw.monthlyRent),
      monthlyLivingCost: n(raw.monthlyLivingCost),
      monthlyStudentLoan: n(raw.monthlyStudentLoan),
      monthsToProject: Math.max(0, Math.round(n(raw.monthsToProject || 7))),
    },
    oneTimeItems: Array.isArray(raw.oneTimeItems)
      ? raw.oneTimeItems.map((item) => ({
          id: item.id || makeItemId("one-time"),
          name: item.name || "舊版一次項目",
          amount: n(item.amount),
          month: addMonths(baseMonth, clampMonthIndex(item.month)),
          type: item.type === "income" ? "income" : "expense",
          category: "other",
        }))
      : [],
    installments: Array.isArray(raw.installments || raw.installmentRows)
      ? (raw.installments || raw.installmentRows).map((item) => ({
          id: item.id || makeItemId("installment"),
          name: item.name || "舊版分期",
          principal: n(item.principal),
          apr: n(item.apr),
          terms: Math.max(1, Math.round(n(item.terms))),
          startMonth: addMonths(baseMonth, clampMonthIndex(item.startMonth)),
        }))
      : [],
  };
}

function toPersistedScenario(scenario) {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      ...scenario.meta,
      updatedAt: new Date().toISOString(),
    },
    basics: { ...scenario.basics },
    oneTimeItems: scenario.oneTimeItems.map((item) => ({ ...item })),
    installments: scenario.installments.map((item) => ({ ...item })),
  };
}

function validateImportedScenario(raw) {
  if (!raw || typeof raw !== "object") {
    return { ok: false, message: "資料內容格式不正確。" };
  }

  if (raw.schemaVersion == null) {
    return { ok: true, mode: "legacy" };
  }

  if (typeof raw.schemaVersion !== "number") {
    return { ok: false, message: "schemaVersion 格式不正確。" };
  }

  if (raw.schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      message: `這份資料來自較新的版本（v${raw.schemaVersion}），目前只支援到 v${SCHEMA_VERSION}。`,
    };
  }

  if (raw.schemaVersion === SCHEMA_VERSION) {
    return { ok: true, mode: "current" };
  }

  return { ok: true, mode: "legacy" };
}

function readStorage(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function normalizeSessionMeta(raw) {
  return {
    lastOpenedAt: typeof raw?.lastOpenedAt === "string" ? raw.lastOpenedAt : "",
    lastSyncedAt: typeof raw?.lastSyncedAt === "string" ? raw.lastSyncedAt : "",
    lastSyncAttemptAt: typeof raw?.lastSyncAttemptAt === "string" ? raw.lastSyncAttemptAt : "",
  };
}

function readSessionMeta() {
  return normalizeSessionMeta(readStorage(STORAGE_SESSION_META_KEY, SESSION_META_DEFAULT));
}

function writeSessionMeta(patch) {
  const next = normalizeSessionMeta({ ...readSessionMeta(), ...(patch || {}) });
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_SESSION_META_KEY, JSON.stringify(next));
  }
  return next;
}

function formatTimestamp(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelativeTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = Date.now();
  const diffSec = Math.round((now - date.getTime()) / 1000);
  if (diffSec < 0) return "剛剛";
  if (diffSec < 60) return "剛剛";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分鐘前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小時前`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)} 天前`;
  return date.toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });
}

function useJpyExchangeRate() {
  const [state, setState] = useState(() => {
    const cached = getCachedJpyToTwdRate();
    if (!cached) {
      return {
        rate: FALLBACK_JPY_TO_TWD_RATE,
        fetchedAt: "",
        date: "",
        source: "fallback",
        error: "",
      };
    }
    return {
      rate: cached.rate,
      fetchedAt: cached.fetchedAt,
      date: cached.date,
      source: cached.date === jpyTodayKey() ? "fresh" : "stale",
      error: "",
    };
  });
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (options = {}) => {
    if (typeof window === "undefined") return;
    const controller = options.signal ? null : new AbortController();
    const signal = options.signal || controller?.signal;
    setLoading(true);
    try {
      const entry = await fetchJpyToTwdRate(signal);
      saveJpyToTwdRate(entry);
      setState({
        rate: entry.rate,
        fetchedAt: entry.fetchedAt,
        date: entry.date,
        source: "fresh",
        error: "",
      });
    } catch (error) {
      if (error?.name === "AbortError") return;
      setState((prev) => ({
        ...prev,
        source: prev.fetchedAt ? "stale" : "fallback",
        error: error?.message || "讀取匯率失敗",
      }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (state.source === "fresh") return undefined;
    const controller = new AbortController();
    refresh({ signal: controller.signal });
    return () => controller.abort();
  }, [refresh, state.source]);

  return { ...state, loading, refresh };
}

function monthOptions(baseMonth, count) {
  return Array.from({ length: count }, (_, index) => {
    const value = addMonths(baseMonth, index);
    return { value, label: formatMonthLabel(value) };
  });
}

function resolveRelativeMonth(input, baseMonth) {
  const value = String(input || "").trim();
  if (value === "下個月") return addMonths(baseMonth, 1);
  if (value === "再下個月") return addMonths(baseMonth, 2);
  if (/^\d{4}-\d{2}$/.test(value)) return value;
  return null;
}

function parseInstallmentLines(text, baseMonth) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed = [];
  const errors = [];

  lines.forEach((line, index) => {
    const parts = line.split(/\s*[,，\t]\s*/);
    if (parts.length < 5) {
      errors.push({
        lineNumber: index + 1,
        line,
        message: "欄位不足，格式需為：名稱, 本金, 利率, 期數, 起始月",
      });
      return;
    }
    const [name, principalRaw, aprRaw, termsRaw, startMonthRaw] = parts;
    const principal = n(principalRaw);
    const apr = n(aprRaw);
    const terms = Math.max(1, Math.round(n(termsRaw)));
    const startMonth = resolveRelativeMonth(startMonthRaw, baseMonth);

    if (!name || principal <= 0 || terms <= 0 || !startMonth) {
      errors.push({
        lineNumber: index + 1,
        line,
        message: "請確認名稱、本金、期數與起始月（YYYY-MM / 下個月 / 再下個月）",
      });
      return;
    }

    parsed.push({
      id: makeItemId("installment"),
      name,
      principal,
      apr,
      terms,
      startMonth,
    });
  });

  return { parsed, errors };
}

function isScenarioPayload(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.meta &&
    typeof value.meta === "object" &&
    value.basics &&
    typeof value.basics === "object",
  );
}

function resolveSyncPayload(candidate, scenario) {
  return isScenarioPayload(candidate) ? candidate : toPersistedScenario(scenario);
}

function ListEmptyState({ icon, title, description, actions }) {
  return (
    <div
      style={{
        marginTop: 0,
        padding: "20px 16px",
        borderRadius: "16px",
        border: "1px dashed #cbd5e1",
        background: "#f8fafc",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "8px",
        textAlign: "center",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "999px",
          background: "#e2e8f0",
          color: "#475569",
          display: "grid",
          placeItems: "center",
        }}
      >
        {icon}
      </div>
      <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>{title}</div>
      {description ? (
        <div style={{ fontSize: "12px", color: "#64748b", maxWidth: "320px" }}>{description}</div>
      ) : null}
      {actions && actions.length ? (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}

const LIST_SCROLL_THRESHOLD = 4;

function listScrollContainerStyle(active) {
  if (!active) return undefined;
  return {
    maxHeight: "60vh",
    overflowY: "auto",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "8px",
    background: "#ffffff",
  };
}

function EmptyChartState() {
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "240px",
        border: "1px dashed #cbd5e1",
        borderRadius: "18px",
        background: "#f8fafc",
        color: "#64748b",
      }}
    >
      請至少設定 1 個月
    </div>
  );
}

function ChartCurrencyTick(value) {
  return `${Math.round(value / 1000)}k`;
}

function CashTrendChart({ rows, reserveLine, onSelectMonth, selectedMonthKey }) {
  if (!rows.length) return <EmptyChartState />;
  const todayMonthKey = rows.find((row) => row.monthKey === currentBaseMonth())?.monthKey;
  const chartConfig = {
    balance: { label: "月底剩餘現金", color: CHART_COLORS.balance },
    salary: { label: "薪資" },
    expense: { label: "總支出" },
    net: { label: "月淨額" },
  };

  return (
    <ChartSurface
      ariaLabel="每月剩餘現金變化圖，包含破產線、緊急預備金線與今天標記。"
      config={chartConfig}
    >
      <RechartsLineChart data={rows} margin={{ top: 18, right: 18, left: 0, bottom: 8 }}>
        <Customized component={() => <title>每月剩餘現金變化圖</title>} />
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 6" vertical={false} />
        <XAxis
          dataKey="monthKey"
          tickFormatter={(value) => formatMonthLabel(value, true)}
          tick={{ fontSize: 11, fill: "#64748b" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={ChartCurrencyTick}
          tick={{ fontSize: 11, fill: "#64748b" }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <ChartTooltip
          content={<ChartTooltipCard />}
          formatter={(value, name) => [Math.round(n(value)), name]}
          labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel || ""}
        />
        <ReferenceLine
          y={0}
          stroke={CHART_COLORS.danger}
          strokeDasharray="6 6"
          ifOverflow="extendDomain"
          label={{
            value: "破產線",
            fill: CHART_COLORS.danger,
            fontSize: 11,
            position: "insideTopLeft",
          }}
        />
        <ReferenceLine
          y={reserveLine}
          stroke={CHART_COLORS.reserve}
          strokeDasharray="6 6"
          ifOverflow="extendDomain"
          label={{
            value: "預備金",
            fill: CHART_COLORS.reserve,
            fontSize: 11,
            position: "insideBottomLeft",
          }}
        />
        {todayMonthKey ? (
          <ReferenceLine
            x={todayMonthKey}
            stroke="#475569"
            strokeDasharray="4 4"
            label={{ value: "今天", fill: "#475569", fontSize: 11, position: "top" }}
          />
        ) : null}
        <Line type="monotone" dataKey="salary" hide name="薪資" />
        <Line type="monotone" dataKey="expense" hide name="總支出" />
        <Line type="monotone" dataKey="net" hide name="月淨額" />
        <Line
          type="monotone"
          dataKey="balance"
          name="月底剩餘現金"
          stroke={CHART_COLORS.balance}
          strokeWidth={3}
          dot={(props) => {
            const { cx, cy, payload } = props;
            if (cx == null || cy == null) return null;
            const active = payload.monthKey === selectedMonthKey;
            return (
              <circle
                cx={cx}
                cy={cy}
                r={active ? 7 : 5}
                fill={active ? "#475569" : CHART_COLORS.balance}
                stroke="white"
                strokeWidth={2}
                style={{ cursor: "pointer" }}
                onClick={() => onSelectMonth(payload.monthKey)}
              />
            );
          }}
          activeDot={{ r: 7 }}
        />
      </RechartsLineChart>
    </ChartSurface>
  );
}

function NetLabel({ x, y, width, payload }) {
  if (x == null || y == null || width == null || !payload) return null;
  return (
    <text
      x={x + width / 2}
      y={y - 8}
      textAnchor="middle"
      fontSize="11"
      fill={payload.net < 0 ? CHART_COLORS.danger : "#047857"}
    >
      {payload.net < 0 ? "-" : "+"}
      {Math.round(Math.abs(payload.net) / 1000)}k
    </text>
  );
}

function IncomeExpenseChart({ rows, onSelectMonth, selectedMonthKey }) {
  if (!rows.length) return <EmptyChartState />;
  const chartConfig = {
    income: { label: "收入", color: CHART_COLORS.income },
    expense: { label: "支出", color: CHART_COLORS.expense },
  };

  return (
    <ChartSurface ariaLabel="每月收支比較圖，點擊長條會切到對應月份。" config={chartConfig}>
      <RechartsBarChart data={rows} margin={{ top: 18, right: 18, left: 0, bottom: 8 }} barGap={6}>
        <Customized component={() => <title>每月收支比較圖</title>} />
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 6" vertical={false} />
        <XAxis
          dataKey="monthKey"
          tickFormatter={(value) => formatMonthLabel(value, true)}
          tick={{ fontSize: 11, fill: "#64748b" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={ChartCurrencyTick}
          tick={{ fontSize: 11, fill: "#64748b" }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <ChartTooltip
          content={<ChartTooltipCard />}
          labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel || ""}
        />
        <Bar dataKey="income" name="收入" radius={[8, 8, 0, 0]}>
          {rows.map((row) => (
            <Cell
              key={`${row.monthKey}-income`}
              fill={row.monthKey === selectedMonthKey ? "#15803d" : CHART_COLORS.income}
              cursor="pointer"
              onClick={() => onSelectMonth(row.monthKey)}
            />
          ))}
        </Bar>
        <Bar dataKey="expense" name="支出" radius={[8, 8, 0, 0]}>
          <LabelList dataKey="net" content={<NetLabel />} />
          {rows.map((row) => (
            <Cell
              key={`${row.monthKey}-expense`}
              fill={row.monthKey === selectedMonthKey ? "#ea580c" : CHART_COLORS.expense}
              cursor="pointer"
              onClick={() => onSelectMonth(row.monthKey)}
            />
          ))}
        </Bar>
      </RechartsBarChart>
    </ChartSurface>
  );
}

function SegmentedControl({ value, onChange, options, ariaLabel }) {
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        position: "relative",
        display: "inline-grid",
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
        padding: "3px",
        background: "#f1f5f9",
        border: "1px solid #e2e8f0",
        borderRadius: "999px",
        overflow: "hidden",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "3px",
          bottom: "3px",
          left: "3px",
          width: `calc((100% - 6px) / ${options.length})`,
          borderRadius: "999px",
          border: "1px solid #e2e8f0",
          background: "#ffffff",
          boxShadow: "0 8px 18px rgba(15,23,42,0.08)",
          transform: `translateX(${activeIndex * 100}%)`,
          transition: "transform 320ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 220ms ease",
          willChange: "transform",
        }}
      />
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            style={{
              position: "relative",
              zIndex: 1,
              padding: "5px 14px",
              borderRadius: "999px",
              border: "1px solid transparent",
              background: "transparent",
              color: active ? "#0f172a" : "#64748b",
              fontWeight: active ? 700 : 600,
              fontSize: "12px",
              cursor: "pointer",
              transition: "color 220ms ease, opacity 220ms ease",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function ExpenseCompositionChart({ rows, mode, view, setMode, setView, selectedMonthKey, hidden }) {
  if (!rows.length) return <EmptyChartState />;
  const seriesKeys = view === "category" ? CATEGORY_OPTIONS : ["fixed", "variable", "oneTime"];
  const colors =
    view === "category"
      ? Object.fromEntries(CATEGORY_OPTIONS.map((key) => [key, CATEGORY_META[key].color]))
      : {
          fixed: CHART_COLORS.fixed,
          variable: CHART_COLORS.variable,
          oneTime: CHART_COLORS.oneTime,
        };
  const labels =
    view === "category"
      ? Object.fromEntries(CATEGORY_OPTIONS.map((key) => [key, CATEGORY_META[key].label]))
      : { fixed: "固定支出", variable: "浮動支出", oneTime: "單筆支出" };
  const totals = rows.map((row) =>
    seriesKeys.reduce(
      (sum, key) =>
        sum + n(view === "category" ? row.expenseByCategory[key] : row.expenseByGroup[key]),
      0,
    ),
  );
  const max = Math.max(1, ...totals);
  const valueFor = (row, key) =>
    n(view === "category" ? row.expenseByCategory[key] : row.expenseByGroup[key]);
  const normalizeRatio = (row, key) => {
    const total = seriesKeys.reduce((sum, item) => sum + valueFor(row, item), 0);
    if (mode === "ratio") {
      return total === 0 ? 0 : valueFor(row, key) / total;
    }
    return valueFor(row, key);
  };
  const chartData = rows.map((row) => {
    const next = { ...row };
    seriesKeys.forEach((key) => {
      next[key] =
        mode === "ratio" ? Math.round(normalizeRatio(row, key) * 1000) / 10 : valueFor(row, key);
    });
    return next;
  });
  const selectedRow = rows.find((row) => row.monthKey === selectedMonthKey) || null;
  const selectedTotal = selectedRow
    ? seriesKeys.reduce((sum, key) => sum + valueFor(selectedRow, key), 0)
    : 0;
  const chartConfig = Object.fromEntries(
    seriesKeys.map((key) => [
      key,
      {
        label: labels[key],
        color: colors[key],
      },
    ]),
  );

  return (
    <div>
      <div
        className="flowra-no-export"
        style={{
          display: "flex",
          gap: "10px",
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: "12px",
        }}
      >
        <SegmentedControl
          ariaLabel="顯示模式"
          value={mode}
          onChange={setMode}
          options={[
            { value: "absolute", label: "金額" },
            { value: "ratio", label: "佔比" },
          ]}
        />
        <SegmentedControl
          ariaLabel="分組方式"
          value={view}
          onChange={setView}
          options={[
            { value: "group", label: "群組" },
            { value: "category", label: "分類" },
          ]}
        />
      </div>
      <div key={`${mode}-${view}`} className="flowra-tab-content-enter">
        {selectedRow ? (
          <div
            style={{
              marginBottom: "12px",
              padding: "10px 12px",
              borderRadius: "12px",
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: "8px",
                marginBottom: "8px",
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#94a3b8",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                鑽取月份
              </span>
              <span style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>
                {selectedRow.fullLabel}
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(108px, 1fr))",
                gap: "6px",
              }}
            >
              {seriesKeys.map((key) => {
                const amount = valueFor(selectedRow, key);
                const ratio =
                  selectedTotal > 0 ? Math.round((amount / selectedTotal) * 1000) / 10 : 0;
                return (
                  <div
                    key={key}
                    style={{
                      background: "white",
                      borderRadius: "10px",
                      border: "1px solid #e2e8f0",
                      padding: "8px 10px",
                      borderLeft: `3px solid ${colors[key]}`,
                    }}
                  >
                    <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "2px" }}>
                      {labels[key]}
                    </div>
                    <div
                      style={{
                        fontSize: "13px",
                        fontWeight: 700,
                        color: "#0f172a",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {hidden ? "★★★" : currency(amount)}
                    </div>
                    <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>
                      {ratio}%
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        <ChartSurface
          ariaLabel={`支出組成變化圖，現在顯示${view === "category" ? "按分類" : "按支出群組"}與${mode === "ratio" ? "佔比百分比" : "絕對金額"}。`}
          config={chartConfig}
          footer={seriesKeys.map((key) => (
            <div
              key={key}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12px",
                color: "#475569",
              }}
            >
              <span
                style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "999px",
                  background: colors[key],
                }}
              />
              {labels[key]}
            </div>
          ))}
        >
          <RechartsAreaChart data={chartData} margin={{ top: 18, right: 18, left: 0, bottom: 8 }}>
            <Customized component={() => <title>支出組成變化圖</title>} />
            <defs>
              {seriesKeys.map((key) => (
                <linearGradient key={key} id={`flowra-gradient-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colors[key]} stopOpacity={0.78} />
                  <stop offset="95%" stopColor={colors[key]} stopOpacity={0.08} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 6" vertical={false} />
            <XAxis
              dataKey="monthKey"
              tickFormatter={(value) => formatMonthLabel(value, true)}
              tick={{ fontSize: 11, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(value) => (mode === "ratio" ? `${value}%` : ChartCurrencyTick(value))}
              tick={{ fontSize: 11, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
              width={44}
              domain={mode === "ratio" ? [0, 100] : [0, max]}
            />
            <ChartTooltip
              content={<ChartTooltipCard />}
              formatter={(value, name) =>
                mode === "ratio" ? [`${value}%`, name] : [Math.round(n(value)), name]
              }
              labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel || ""}
            />
            {seriesKeys.map((key) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                name={labels[key]}
                stackId="expense"
                stroke={colors[key]}
                fill={`url(#flowra-gradient-${key})`}
                fillOpacity={1}
              />
            ))}
          </RechartsAreaChart>
        </ChartSurface>
      </div>
    </div>
  );
}

const COLLAPSE_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const COLLAPSE_DURATION = "420ms";

function Chevron({ open, size = 12 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      aria-hidden="true"
      style={{
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: `transform ${COLLAPSE_DURATION} ${COLLAPSE_EASE}`,
        flexShrink: 0,
        color: "#94a3b8",
      }}
    >
      <path
        d="M4 2.5 L8 6 L4 9.5"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyIcon({ size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4.5" y="4.5" width="7.5" height="7.5" rx="1.5" />
      <path d="M9 4.5 V 3 A 1.5 1.5 0 0 0 7.5 1.5 H 3 A 1.5 1.5 0 0 0 1.5 3 V 7.5 A 1.5 1.5 0 0 0 3 9 H 4.5" />
    </svg>
  );
}

function TrashIcon({ size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 4 H 12" />
      <path d="M5.5 4 V 2.5 H 8.5 V 4" />
      <path d="M3.5 4 L 4.2 11.7 A 1.4 1.4 0 0 0 5.6 13 H 8.4 A 1.4 1.4 0 0 0 9.8 11.7 L 10.5 4" />
      <path d="M5.8 6.5 V 10.5" />
      <path d="M8.2 6.5 V 10.5" />
    </svg>
  );
}

function DownloadIcon({ size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2 L8 10" />
      <path d="M4.5 6.5 L8 10.5 L11.5 6.5" />
      <path d="M3 13 L13 13" />
    </svg>
  );
}

function PlusIcon({ size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 2 V 12" />
      <path d="M2 7 H 12" />
    </svg>
  );
}

function UploadIcon({ size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 11 V 3" />
      <path d="M3.5 6.5 L7 3 L10.5 6.5" />
      <path d="M2.5 12 H 11.5" />
    </svg>
  );
}

function CloudUploadIcon({ size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 11 A 3 3 0 0 1 4.8 5 A 4 4 0 0 1 12.4 6 A 2.6 2.6 0 0 1 12 11" />
      <path d="M8 13.5 V 7.5" />
      <path d="M6 9.5 L 8 7.5 L 10 9.5" />
    </svg>
  );
}

function CloudDownloadIcon({ size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 10 A 3 3 0 0 1 4.8 4 A 4 4 0 0 1 12.4 5 A 2.6 2.6 0 0 1 12 10" />
      <path d="M8 7.5 V 13.5" />
      <path d="M6 11.5 L 8 13.5 L 10 11.5" />
    </svg>
  );
}

function Collapsible({ open, children, topGap = 12 }) {
  return (
    <div
      className="flowra-collapsible"
      data-open={open ? "true" : "false"}
      style={{
        display: "grid",
        gridTemplateRows: open ? "1fr" : "0fr",
        transition: `grid-template-rows ${COLLAPSE_DURATION} ${COLLAPSE_EASE}, opacity ${COLLAPSE_DURATION} ${COLLAPSE_EASE}`,
        opacity: open ? 1 : 0,
      }}
    >
      <div className="flowra-collapsible-inner" style={{ overflow: "hidden", minHeight: 0 }}>
        <div
          style={{
            paddingTop: open ? topGap : 0,
            transition: `padding-top ${COLLAPSE_DURATION} ${COLLAPSE_EASE}`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function CountPill({ count, label = "筆" }) {
  return (
    <span
      style={{
        display: "inline-flex",
        padding: "2px 8px",
        borderRadius: "999px",
        background: "#f1f5f9",
        color: "#64748b",
        fontSize: "11px",
        fontWeight: 700,
        lineHeight: 1.5,
      }}
    >
      {count} {label}
    </span>
  );
}

const sectionToggleStyle = {
  flex: "1 1 auto",
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "4px 4px",
  background: "transparent",
  border: "none",
  borderRadius: "8px",
  cursor: "pointer",
  textAlign: "left",
  color: "#0f172a",
  fontSize: "16px",
  fontWeight: 800,
  letterSpacing: "-0.01em",
};

const itemToggleStyle = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: 0,
  background: "transparent",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
};

const iconButtonStyle = {
  width: "32px",
  height: "32px",
  padding: 0,
  borderRadius: "10px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

function SettingsGroup({ title, accent, last, children }) {
  return (
    <div
      style={{
        ...styles.item,
        borderLeft: `4px solid ${accent}`,
        marginBottom: last ? 0 : "12px",
      }}
    >
      <div
        style={{
          color: accent,
          fontSize: "11px",
          fontWeight: 800,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: "10px",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function SortableItemShell({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
    touchAction: "none",
  };

  return (
    <div ref={setNodeRef} style={style} className="flowra-sortable-item">
      <div style={{ display: "flex", gap: "4px", alignItems: "stretch" }}>
        <button
          type="button"
          {...attributes}
          {...listeners}
          style={{
            ...styles.dragHandle,
            cursor: isDragging ? "grabbing" : "grab",
          }}
          className={joinClassNames("flowra-drag-handle", isDragging ? "is-dragging" : "")}
          aria-label="拖拉排序"
          title="拖拉排序"
        >
          <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
            <circle cx="2" cy="3" r="1.3" />
            <circle cx="8" cy="3" r="1.3" />
            <circle cx="2" cy="8" r="1.3" />
            <circle cx="8" cy="8" r="1.3" />
            <circle cx="2" cy="13" r="1.3" />
            <circle cx="8" cy="13" r="1.3" />
          </svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
    </div>
  );
}

function getButtonVariantStyles(variant) {
  if (variant === "button") {
    return {
      base: styles.button,
      hover: styles.buttonHover,
      focus: styles.inputFocus,
      active: { background: "#e2e8f0", border: "1px solid #94a3b8" },
    };
  }
  if (variant === "smallButton") {
    return {
      base: styles.smallButton,
      hover: styles.smallButtonHover,
      focus: styles.inputFocus,
      active: { background: "#f1f5f9", border: "1px solid #cbd5e1" },
    };
  }
  if (variant === "tinyButton") {
    return {
      base: styles.tinyButton,
      hover: styles.tinyButtonHover,
      focus: styles.inputFocus,
      active: { background: "#f1f5f9", border: "1px solid #cbd5e1" },
    };
  }
  if (variant === "pillButton") {
    return {
      base: styles.pillButton,
      hover: { border: "1px solid #cbd5e1", background: "#f8fafc" },
      focus: styles.inputFocus,
      active: { background: "#f1f5f9" },
    };
  }
  if (variant === "activePill") {
    return {
      base: styles.activePill,
      hover: { background: "#cbd5e1", border: "1px solid #94a3b8" },
      focus: styles.inputFocus,
      active: { background: "#cbd5e1" },
    };
  }
  if (variant === "floatingAiButton") {
    return {
      base: styles.floatingAiButton,
      hover: {
        background: "#f8fafc",
        border: "1px solid #94a3b8",
        boxShadow: "0 20px 40px rgba(15, 23, 42, 0.14), 0 6px 14px rgba(15, 23, 42, 0.08)",
      },
      focus: {
        outline: "3px solid rgba(148, 163, 184, 0.32)",
        outlineOffset: "3px",
      },
      active: {
        background: "#f1f5f9",
        border: "1px solid #94a3b8",
        boxShadow: "0 12px 24px rgba(15, 23, 42, 0.12), 0 3px 8px rgba(15, 23, 42, 0.06)",
      },
    };
  }
  if (variant === "dropdownItem") {
    return {
      base: styles.dropdownItem,
      hover: { background: "#e2e8f0", color: "#0f172a" },
      focus: { background: "#e2e8f0", outline: "2px solid #94a3b8", outlineOffset: "-2px" },
      active: { background: "#cbd5e1" },
    };
  }
  if (variant === "dangerButton") {
    return {
      base: styles.dangerButton,
      hover: { background: "#ffe4e6", border: "1px solid #fda4af" },
      focus: styles.inputFocus,
      active: { background: "#fecdd3" },
    };
  }
  return { base: {}, hover: {}, focus: {}, active: {} };
}

function useInteractiveFieldState(disabled) {
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  return {
    isHovered,
    isFocused,
    handlers: {
      onMouseEnter: (event, callback) => {
        if (!disabled) setIsHovered(true);
        callback?.(event);
      },
      onMouseLeave: (event, callback) => {
        setIsHovered(false);
        callback?.(event);
      },
      onFocus: (event, callback) => {
        if (!disabled) setIsFocused(true);
        callback?.(event);
      },
      onBlur: (event, callback) => {
        setIsFocused(false);
        callback?.(event);
      },
    },
  };
}

function joinClassNames(...classNames) {
  return classNames.filter(Boolean).join(" ");
}

const InteractiveSurface = React.forwardRef(function InteractiveSurface(
  {
    as: Component = "div",
    style,
    className,
    hoverClassName,
    disabled = false,
    onMouseEnter,
    onMouseLeave,
    children,
    ...props
  },
  ref,
) {
  return (
    <Component
      {...props}
      ref={ref}
      style={style}
      className={joinClassNames(className, !disabled ? hoverClassName : "")}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </Component>
  );
});

const FloatingSurface = React.forwardRef(function FloatingSurface(
  { as: Component = "div", style, className, motionClassName, children, ...props },
  ref,
) {
  return (
    <Component
      {...props}
      ref={ref}
      style={style}
      className={joinClassNames("flowra-floating-surface", motionClassName, className)}
    >
      {children}
    </Component>
  );
});

function InteractiveButton({
  variant = "smallButton",
  style,
  disabled,
  onMouseEnter,
  onMouseLeave,
  onMouseDown,
  onMouseUp,
  onFocus,
  onBlur,
  type = "button",
  ...props
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const variantStyles = getButtonVariantStyles(variant);
  const interactiveStyle = {
    ...variantStyles.base,
    ...style,
    ...(!disabled && isHovered ? variantStyles.hover : null),
    ...(!disabled && isFocused ? variantStyles.focus : null),
    ...(!disabled && isPressed ? variantStyles.active : null),
    ...(disabled ? { transform: "none", cursor: "not-allowed" } : null),
  };

  return (
    <button
      {...props}
      type={type}
      disabled={disabled}
      style={interactiveStyle}
      onMouseEnter={(event) => {
        if (!disabled) setIsHovered(true);
        onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        setIsHovered(false);
        setIsPressed(false);
        onMouseLeave?.(event);
      }}
      onMouseDown={(event) => {
        if (!disabled) setIsPressed(true);
        onMouseDown?.(event);
      }}
      onMouseUp={(event) => {
        setIsPressed(false);
        onMouseUp?.(event);
      }}
      onFocus={(event) => {
        if (!disabled) setIsFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setIsFocused(false);
        setIsPressed(false);
        onBlur?.(event);
      }}
    />
  );
}

function InteractiveSwitch({ checked, onChange, disabled = false, ariaLabel }) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const trackStyle = {
    ...styles.switchTrack,
    ...(checked ? styles.switchTrackChecked : styles.switchTrackUnchecked),
    ...(!disabled && isHovered ? styles.switchTrackHover : null),
    ...(!disabled && isFocused ? styles.switchTrackFocus : null),
    ...(!disabled && isPressed ? styles.switchTrackPressed : null),
    ...(disabled ? styles.switchTrackDisabled : null),
  };
  const thumbStyle = {
    ...styles.switchThumb,
    transform: checked ? "translateX(20px)" : "translateX(0)",
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      style={trackStyle}
      onClick={() => onChange(!checked)}
      onMouseEnter={() => {
        if (!disabled) setIsHovered(true);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsPressed(false);
      }}
      onMouseDown={() => {
        if (!disabled) setIsPressed(true);
      }}
      onMouseUp={() => {
        setIsPressed(false);
      }}
      onFocus={() => {
        if (!disabled) setIsFocused(true);
      }}
      onBlur={() => {
        setIsFocused(false);
        setIsPressed(false);
      }}
    >
      <span style={thumbStyle} />
    </button>
  );
}

function InteractiveInput({
  style,
  disabled,
  onFocus,
  onBlur,
  onMouseEnter,
  onMouseLeave,
  ...props
}) {
  const { isHovered, isFocused, handlers } = useInteractiveFieldState(disabled);
  return (
    <input
      {...props}
      disabled={disabled}
      style={{
        ...styles.input,
        ...style,
        ...(!disabled && isHovered ? styles.inputHover : null),
        ...(!disabled && isFocused ? styles.inputFocus : null),
        ...(disabled ? { opacity: 0.7, cursor: "not-allowed" } : null),
      }}
      onMouseEnter={(event) => handlers.onMouseEnter(event, onMouseEnter)}
      onMouseLeave={(event) => handlers.onMouseLeave(event, onMouseLeave)}
      onFocus={(event) => handlers.onFocus(event, onFocus)}
      onBlur={(event) => handlers.onBlur(event, onBlur)}
    />
  );
}

function InteractiveSelect({
  style,
  disabled,
  onFocus,
  onBlur,
  onMouseEnter,
  onMouseLeave,
  ...props
}) {
  const { isHovered, isFocused, handlers } = useInteractiveFieldState(disabled);
  return (
    <select
      {...props}
      disabled={disabled}
      style={{
        ...styles.select,
        ...style,
        ...(!disabled && isHovered ? styles.inputHover : null),
        ...(!disabled && isFocused ? styles.inputFocus : null),
        ...(disabled ? { opacity: 0.7, cursor: "not-allowed" } : null),
      }}
      onMouseEnter={(event) => handlers.onMouseEnter(event, onMouseEnter)}
      onMouseLeave={(event) => handlers.onMouseLeave(event, onMouseLeave)}
      onFocus={(event) => handlers.onFocus(event, onFocus)}
      onBlur={(event) => handlers.onBlur(event, onBlur)}
    />
  );
}

function InteractiveTextarea({
  style,
  disabled,
  onFocus,
  onBlur,
  onMouseEnter,
  onMouseLeave,
  ...props
}) {
  const { isHovered, isFocused, handlers } = useInteractiveFieldState(disabled);
  return (
    <textarea
      {...props}
      disabled={disabled}
      style={{
        ...styles.input,
        ...style,
        ...(!disabled && isHovered ? styles.inputHover : null),
        ...(!disabled && isFocused ? styles.inputFocus : null),
        ...(disabled ? { opacity: 0.7, cursor: "not-allowed" } : null),
      }}
      onMouseEnter={(event) => handlers.onMouseEnter(event, onMouseEnter)}
      onMouseLeave={(event) => handlers.onMouseLeave(event, onMouseLeave)}
      onFocus={(event) => handlers.onFocus(event, onFocus)}
      onBlur={(event) => handlers.onBlur(event, onBlur)}
    />
  );
}

function Field({
  label,
  value,
  onChange,
  suffix = "",
  min,
  step = 1000,
  precision = 0,
  disabled,
  labelAdornment = null,
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [hoveredStepper, setHoveredStepper] = useState("");

  return (
    <div>
      <label style={{ ...styles.label, display: "flex", alignItems: "center", gap: "6px" }}>
        <span>{label}</span>
        {labelAdornment}
      </label>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <div
          style={{
            ...styles.numberFieldWrap,
            ...(!disabled && isHovered ? styles.inputHover : null),
            ...(!disabled && isFocused ? styles.inputFocus : null),
            ...(disabled ? { opacity: 0.7 } : null),
          }}
          onMouseEnter={() => {
            if (!disabled) setIsHovered(true);
          }}
          onMouseLeave={() => {
            setIsHovered(false);
            setHoveredStepper("");
          }}
        >
          <input
            type="number"
            min={min}
            step={step}
            value={getNumericInputDisplayValue(value, isFocused)}
            disabled={disabled}
            onChange={(event) =>
              onChange(normalizeNumericInput(event.target.value, { min, precision }))
            }
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            style={{
              ...styles.numberInput,
              color: isFocused ? "#475569" : styles.numberInput.color,
              background: isHovered || isFocused ? "rgba(241,245,249,0.34)" : "transparent",
              cursor: disabled ? "not-allowed" : "text",
            }}
          />
          <div style={styles.stepperColumn}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(stepNumericValue(value, step, "up", { min, precision }))}
              onMouseEnter={() => {
                if (!disabled) setHoveredStepper("up");
              }}
              onMouseLeave={() => setHoveredStepper("")}
              style={{
                ...styles.stepperButton,
                ...styles.stepperButtonTop,
                ...(!disabled && hoveredStepper === "up" ? styles.stepperButtonHover : null),
                ...(disabled ? { cursor: "not-allowed" } : null),
              }}
              aria-label={`增加${label}`}
            >
              ▲
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(stepNumericValue(value, step, "down", { min, precision }))}
              onMouseEnter={() => {
                if (!disabled) setHoveredStepper("down");
              }}
              onMouseLeave={() => setHoveredStepper("")}
              style={{
                ...styles.stepperButton,
                ...styles.stepperButtonBottom,
                ...(!disabled && hoveredStepper === "down" ? styles.stepperButtonHover : null),
                ...(disabled ? { cursor: "not-allowed" } : null),
              }}
              aria-label={`減少${label}`}
            >
              ▼
            </button>
          </div>
        </div>
        {suffix ? (
          <span style={{ fontSize: "12px", color: "#64748b", whiteSpace: "nowrap" }}>{suffix}</span>
        ) : null}
      </div>
    </div>
  );
}

function JpyExchangeRateBadge({
  rate,
  fetchedAt,
  source,
  loading,
  error,
  onRefresh,
  jpyCash,
  effectiveTwd,
  legacyTwd,
  disabled,
  onMigrateLegacy,
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const buttonRef = useRef(null);
  const closeTimerRef = useRef(null);

  const cancelClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => setOpen(false), 120);
  };
  useEffect(() => () => cancelClose(), []);

  useEffect(() => {
    if (!open) return undefined;
    const updateCoords = () => {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const safeLeft = clampTooltipLeft({
        triggerLeft: rect.left,
        tooltipMaxWidth: 300,
        viewportWidth: window.innerWidth,
      });
      setCoords({ top: rect.bottom + 6, left: safeLeft });
    };
    updateCoords();
    window.addEventListener("scroll", updateCoords, true);
    window.addEventListener("resize", updateCoords);
    return () => {
      window.removeEventListener("scroll", updateCoords, true);
      window.removeEventListener("resize", updateCoords);
    };
  }, [open]);

  const showLegacyHint = jpyCash <= 0 && legacyTwd > 0;
  const rateLabel = rate > 0 ? `1 ¥ = ${rate.toFixed(4)} 元` : "—";
  let statusLabel = "尚未取得";
  if (loading) {
    statusLabel = "更新中…";
  } else if (source === "fresh") {
    statusLabel = `${formatTimestamp(fetchedAt)} 更新`;
  } else if (source === "stale" && fetchedAt) {
    statusLabel = `上次更新 ${formatTimestamp(fetchedAt)}`;
  } else if (source === "fallback") {
    statusLabel = "暫用預設匯率";
  }

  return (
    <span
      style={{ position: "relative", display: "inline-flex", alignItems: "center", lineHeight: 0 }}
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
      onFocus={() => {
        cancelClose();
        setOpen(true);
      }}
      onBlur={scheduleClose}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label="顯示目前匯率資訊"
        aria-expanded={open}
        style={{
          width: "16px",
          height: "16px",
          borderRadius: "999px",
          border: "1px solid #cbd5e1",
          background: open ? "#e2e8f0" : "#ffffff",
          color: "#64748b",
          fontSize: "10px",
          fontWeight: 700,
          fontStyle: "italic",
          fontFamily: "Georgia, serif",
          cursor: "help",
          padding: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background 120ms ease, color 120ms ease",
        }}
      >
        i
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              role="tooltip"
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
              style={{
                position: "fixed",
                top: coords.top,
                left: coords.left,
                zIndex: 1000,
                minWidth: "240px",
                maxWidth: "300px",
                padding: "10px 12px",
                borderRadius: "10px",
                background: "#ffffff",
                color: "#0f172a",
                fontSize: "12px",
                lineHeight: 1.45,
                border: "1px solid #e2e8f0",
                boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                textAlign: "left",
                fontWeight: 400,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                }}
              >
                <span style={{ color: "#64748b" }}>目前匯率</span>
                <strong style={{ color: "#0f172a", fontVariantNumeric: "tabular-nums" }}>
                  {rateLabel}
                </strong>
              </div>
              <div style={{ color: "#94a3b8", fontSize: "11px" }}>{statusLabel}</div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                }}
              >
                <span style={{ color: "#64748b" }}>換算後</span>
                <strong style={{ color: "#0f172a", fontVariantNumeric: "tabular-nums" }}>
                  NT$ {currency(effectiveTwd)}
                </strong>
              </div>
              <div>
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={loading || disabled}
                  style={{
                    width: "100%",
                    border: "1px solid #cbd5e1",
                    background: "#f8fafc",
                    color: "#0f172a",
                    padding: "4px 8px",
                    borderRadius: "8px",
                    fontSize: "11px",
                    cursor: loading || disabled ? "not-allowed" : "pointer",
                    opacity: loading || disabled ? 0.6 : 1,
                  }}
                >
                  {loading ? "更新中…" : "重新整理匯率"}
                </button>
              </div>
              {error ? (
                <div style={{ color: "#b45309", fontSize: "11px" }}>讀取失敗：{error}</div>
              ) : null}
              {showLegacyHint ? (
                <div
                  style={{
                    borderTop: "1px solid #e2e8f0",
                    paddingTop: "8px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  <span style={{ color: "#64748b", fontSize: "11px" }}>
                    偵測到舊版資料 NT$ {currency(legacyTwd)}，建議改填日幣金額。
                  </span>
                  <button
                    type="button"
                    onClick={onMigrateLegacy}
                    disabled={disabled || rate <= 0}
                    style={{
                      border: "1px solid #cbd5e1",
                      background: "#f8fafc",
                      color: "#0f172a",
                      padding: "4px 8px",
                      borderRadius: "8px",
                      fontSize: "11px",
                      cursor: disabled || rate <= 0 ? "not-allowed" : "pointer",
                      opacity: disabled || rate <= 0 ? 0.6 : 1,
                    }}
                  >
                    依目前匯率換算
                  </button>
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

function TextField({ label, value, onChange, disabled, type = "text", placeholder = "" }) {
  return (
    <div>
      {label ? <label style={styles.label}>{label}</label> : null}
      <InteractiveInput
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function MonthPicker({ label, value, onChange, baseMonth, horizon, disabled }) {
  const options = monthOptions(addMonths(baseMonth, -1), horizon + 13);
  const fallbackValue = options[0]?.value || baseMonth;
  const safeValue = options.some((option) => option.value === value) ? value : fallbackValue;
  const parsed = parseYearMonth(safeValue);
  const years = Array.from(new Set(options.map((option) => parseYearMonth(option.value).year)));
  const monthsForYear = options
    .map((option) => parseYearMonth(option.value))
    .filter((option) => option.year === parsed.year)
    .map((option) => option.month);

  const changeYear = (nextYear) => {
    const preferred = options.find((option) => {
      const parsedOption = parseYearMonth(option.value);
      return parsedOption.year === nextYear && parsedOption.month === parsed.month;
    });
    const fallback = options.find((option) => parseYearMonth(option.value).year === nextYear);
    onChange((preferred || fallback || options[0]).value);
  };

  const changeMonth = (nextMonth) => {
    const next = options.find((option) => {
      const parsedOption = parseYearMonth(option.value);
      return parsedOption.year === parsed.year && parsedOption.month === nextMonth;
    });
    if (next) {
      onChange(next.value);
    }
  };

  return (
    <div>
      <label style={styles.label}>{label}</label>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)",
          gap: "8px",
        }}
      >
        <InteractiveSelect
          value={parsed.year}
          disabled={disabled}
          onChange={(event) => changeYear(Number(event.target.value))}
        >
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </InteractiveSelect>
        <InteractiveSelect
          value={parsed.month}
          disabled={disabled}
          onChange={(event) => changeMonth(Number(event.target.value))}
        >
          {monthsForYear.map((month) => (
            <option key={month} value={month}>
              {month} 月
            </option>
          ))}
        </InteractiveSelect>
      </div>
    </div>
  );
}

function BaseMonthPicker({ value, onChange, disabled }) {
  const parsed = parseYearMonth(value);
  const years = Array.from({ length: 7 }, (_, index) => parsed.year - 2 + index);
  return (
    <div>
      <label style={styles.label}>試算起始月</label>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)",
          gap: "8px",
        }}
      >
        <InteractiveSelect
          value={parsed.year}
          disabled={disabled}
          onChange={(event) => onChange(formatYearMonth(Number(event.target.value), parsed.month))}
        >
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </InteractiveSelect>
        <InteractiveSelect
          value={parsed.month}
          disabled={disabled}
          onChange={(event) => onChange(formatYearMonth(parsed.year, Number(event.target.value)))}
        >
          {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
            <option key={month} value={month}>
              {month} 月
            </option>
          ))}
        </InteractiveSelect>
      </div>
    </div>
  );
}

function StatCard({ label, value, hidden, danger }) {
  return (
    <InteractiveSurface style={styles.statCard} hoverClassName="flowra-hover-card">
      <p style={styles.statLabel}>{label}</p>
      <p style={{ ...styles.statValue, color: danger ? "#dc2626" : "#0f172a" }}>
        {hidden ? "★★★" : `NT$ ${currency(value)}`}
      </p>
    </InteractiveSurface>
  );
}

function NetPill({ value, hidden }) {
  if (hidden) {
    return <span style={{ fontWeight: 700 }}>★★★</span>;
  }
  const positive = value >= 0;
  const color = positive ? "#047857" : "#dc2626";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "2px",
        padding: "2px 8px",
        borderRadius: "999px",
        fontWeight: 700,
        fontSize: "12px",
        color,
        background: `${color}12`,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {positive ? "+" : "−"}
      {currency(Math.abs(value))}
    </span>
  );
}

function MonthDetailTable({ rows, selectedMonthKey, hidden, mobile, monthRefs, readonly }) {
  if (!rows.length) return <EmptyChartState />;

  if (mobile) {
    return (
      <div style={{ display: "grid", gap: "10px" }}>
        {rows.map((row) => {
          const active = row.monthKey === selectedMonthKey;
          const balanceNegative = row.balance < 0;
          return (
            <div
              key={row.monthKey}
              ref={(node) => {
                monthRefs.current[row.monthKey] = node;
              }}
              style={{
                border: `1px solid ${active ? "#0284c7" : "#e2e8f0"}`,
                borderLeft: `3px solid ${active ? "#0284c7" : balanceNegative ? "#dc2626" : "#e2e8f0"}`,
                borderRadius: "14px",
                padding: "12px 14px",
                background: active ? "#f0f9ff" : "#ffffff",
                transition: `background ${MOTION.fast}, border-color ${MOTION.fast}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "12px",
                  alignItems: "center",
                  marginBottom: "10px",
                }}
              >
                <strong style={{ fontSize: "14px", color: "#0f172a" }}>{row.fullLabel}</strong>
                <NetPill value={row.net} hidden={hidden} />
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: "8px 14px",
                  fontSize: "12px",
                }}
              >
                <MobileStat label="月初手上現金" value={row.startBalance} hidden={hidden} />
                <MobileStat
                  label="月底剩餘現金"
                  value={row.balance}
                  hidden={hidden}
                  danger={balanceNegative}
                />
                <MobileStat label="本月收入" value={row.income} hidden={hidden} accent="#047857" />
                <MobileStat label="本月支出" value={row.expense} hidden={hidden} accent="#dc2626" />
              </div>
              {row.oneTimeItems.filter((item) => item.type === "expense").length > 0 ? (
                <div
                  style={{
                    marginTop: "10px",
                    paddingTop: "10px",
                    borderTop: "1px dashed #e2e8f0",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#94a3b8",
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                    }}
                  >
                    單筆
                  </span>
                  <span
                    style={{
                      fontSize: "13px",
                      fontWeight: 700,
                      color: "#dc2626",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {hidden ? "★★★" : `NT$ ${currency(row.oneTimeExpense)}`}
                  </span>
                </div>
              ) : null}
              {readonly ? (
                <div style={{ ...styles.readonlyBadge, marginTop: "8px" }}>唯讀</div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  const groupBoundary = { borderLeft: "1px solid #f1f5f9" };
  const sectionHead = {
    ...styles.th,
    fontSize: "10px",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "#94a3b8",
    padding: "8px 10px 4px",
  };
  const numericTd = { ...styles.td, fontVariantNumeric: "tabular-nums" };
  const subTd = { ...numericTd, color: "#64748b", fontSize: "12px" };

  return (
    <div className="flowra-table-wrap" style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={{ ...sectionHead, textAlign: "left" }}></th>
            <th style={sectionHead}>結餘</th>
            <th colSpan={3} style={{ ...sectionHead, ...groupBoundary, color: "#047857" }}>
              收入
            </th>
            <th colSpan={5} style={{ ...sectionHead, ...groupBoundary, color: "#dc2626" }}>
              支出
            </th>
            <th colSpan={2} style={{ ...sectionHead, ...groupBoundary }}>
              結算
            </th>
          </tr>
          <tr>
            <th style={{ ...styles.th, textAlign: "left" }}>月份</th>
            <th style={styles.th}>月初手上現金</th>
            <th style={{ ...styles.th, ...groupBoundary }}>薪資</th>
            <th style={styles.th}>補貼</th>
            <th style={styles.th}>單筆</th>
            <th style={{ ...styles.th, ...groupBoundary }}>房租</th>
            <th style={styles.th}>生活費</th>
            <th style={styles.th}>學貸</th>
            <th style={styles.th}>單筆</th>
            <th style={styles.th}>分期</th>
            <th style={{ ...styles.th, ...groupBoundary }}>月淨額</th>
            <th style={styles.th}>月底剩餘現金</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const active = row.monthKey === selectedMonthKey;
            const balanceNegative = row.balance < 0;
            const stripBg = index % 2 === 0 ? "#ffffff" : "#fafbfc";
            return (
              <InteractiveSurface
                as="tr"
                key={row.monthKey}
                ref={(node) => {
                  monthRefs.current[row.monthKey] = node;
                }}
                style={{ ...styles.tableRow, background: active ? "#f0f9ff" : stripBg }}
                className={joinClassNames("flowra-table-row", active ? "is-active" : "")}
              >
                <td style={{ ...styles.td, textAlign: "left", fontWeight: 700, color: "#0f172a" }}>
                  {active ? (
                    <span
                      style={{
                        display: "inline-block",
                        width: "3px",
                        height: "14px",
                        borderRadius: "3px",
                        background: "#0284c7",
                        verticalAlign: "middle",
                        marginRight: "8px",
                      }}
                    />
                  ) : null}
                  {row.fullLabel}
                </td>
                <td style={numericTd}>{hidden ? "★★★" : currency(row.startBalance)}</td>
                <td style={{ ...subTd, ...groupBoundary }}>
                  {hidden ? "★★★" : currency(row.salary)}
                </td>
                <td style={subTd}>{hidden ? "★★★" : currency(row.subsidy)}</td>
                <td style={subTd}>{hidden ? "★★★" : currency(row.oneTimeIncome)}</td>
                <td style={{ ...subTd, ...groupBoundary }}>
                  {hidden ? "★★★" : currency(row.rent)}
                </td>
                <td style={subTd}>{hidden ? "★★★" : currency(row.living)}</td>
                <td style={subTd}>{hidden ? "★★★" : currency(row.studentLoan)}</td>
                <td style={subTd}>{hidden ? "★★★" : currency(row.oneTimeExpense)}</td>
                <td style={subTd}>{hidden ? "★★★" : currency(row.installments)}</td>
                <td style={{ ...styles.td, ...groupBoundary, textAlign: "right" }}>
                  <NetPill value={row.net} hidden={hidden} />
                </td>
                <td
                  style={{
                    ...numericTd,
                    fontWeight: 800,
                    color: balanceNegative ? "#dc2626" : "#0f172a",
                  }}
                >
                  {hidden ? "★★★" : currency(row.balance)}
                </td>
              </InteractiveSurface>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MobileStat({ label, value, hidden, accent, danger }) {
  const valueColor = danger ? "#dc2626" : accent || "#0f172a";
  return (
    <div>
      <div
        style={{
          fontSize: "11px",
          color: "#94a3b8",
          fontWeight: 700,
          letterSpacing: "0.04em",
          marginBottom: "2px",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "13px",
          fontWeight: 700,
          color: valueColor,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {hidden ? "★★★" : `NT$ ${currency(value)}`}
      </div>
    </div>
  );
}

const MOTION = {
  fast: "160ms ease",
  medium: "200ms ease",
};

const INTERACTIVE_TRANSITION = `transform ${MOTION.fast}, box-shadow ${MOTION.fast}, border-color ${MOTION.fast}, background ${MOTION.fast}, opacity ${MOTION.fast}`;
const INTERACTIVE_WILL_CHANGE = "transform, box-shadow";

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f8fafc",
    color: "#0f172a",
    fontFamily: "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif",
    padding: "28px 18px 40px",
  },
  container: { maxWidth: "1340px", margin: "0 auto" },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: "20px",
    alignItems: "stretch",
    marginBottom: "28px",
    flexWrap: "wrap",
    padding: "22px 24px",
    borderRadius: "30px",
    border: "1px solid rgba(203,213,225,0.7)",
    background: "#ffffff",
  },
  title: {
    display: "inline-block",
    fontSize: "clamp(48px, 8vw, 76px)",
    lineHeight: 0.92,
    fontWeight: 980,
    letterSpacing: "-0.08em",
    margin: "0 0 12px",
    background: "linear-gradient(135deg, #2563eb 0%, #0ea5e9 48%, #22d3ee 100%)",
    color: "#1d4ed8",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    WebkitTextFillColor: "transparent",
    textShadow: "0 10px 24px rgba(14,165,233,0.16)",
  },
  subtitle: { maxWidth: "780px", fontSize: "14px", color: "#475569", lineHeight: 1.8, margin: 0 },
  button: {
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
    color: "#334155",
    borderRadius: "14px",
    padding: "10px 15px",
    cursor: "pointer",
    fontWeight: 800,
    transition: INTERACTIVE_TRANSITION,
    willChange: INTERACTIVE_WILL_CHANGE,
  },
  buttonHover: { background: "#f1f5f9", border: "1px solid #cbd5e1" },
  smallButton: {
    border: "1px solid #dbe4ee",
    background: "#ffffff",
    color: "#0f172a",
    borderRadius: "14px",
    padding: "8px 12px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "13px",
    transition: INTERACTIVE_TRANSITION,
    willChange: INTERACTIVE_WILL_CHANGE,
  },
  smallButtonHover: { background: "#f8fafc", border: "1px solid #cbd5e1" },
  tinyButton: {
    border: "1px solid #dbe4ee",
    background: "#f8fafc",
    color: "#334155",
    borderRadius: "999px",
    padding: "5px 10px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "12px",
    transition: INTERACTIVE_TRANSITION,
    willChange: INTERACTIVE_WILL_CHANGE,
  },
  tinyButtonHover: { background: "#f1f5f9", border: "1px solid #cbd5e1" },
  numberFieldWrap: {
    flex: 1,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 42px",
    alignItems: "stretch",
    minHeight: "42px",
    border: "1px solid #cbd5e1",
    borderRadius: "16px",
    background: "#ffffff",
    overflow: "hidden",
    transition: INTERACTIVE_TRANSITION,
    willChange: INTERACTIVE_WILL_CHANGE,
  },
  numberInput: {
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    height: "100%",
    border: "none",
    outline: "none",
    padding: "8px 14px",
    fontSize: "14px",
    fontWeight: 500,
    background: "transparent",
    color: "#0f172a",
  },
  stepperColumn: {
    display: "grid",
    gridTemplateRows: "1fr 1fr",
    borderLeft: "1px solid #cbd5e1",
    background: "#f8fafc",
  },
  stepperButton: {
    border: "none",
    background: "transparent",
    color: "#475569",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: "10px",
    lineHeight: 1,
    display: "grid",
    placeItems: "center",
    padding: 0,
    transition: INTERACTIVE_TRANSITION,
    willChange: INTERACTIVE_WILL_CHANGE,
  },
  stepperButtonHover: { background: "rgba(255,255,255,0.52)", color: "#1e293b" },
  stepperButtonTop: {
    borderBottom: "1px solid #cbd5e1",
  },
  stepperButtonBottom: {},
  dragHandle: {
    border: "1px solid transparent",
    background: "transparent",
    color: "#cbd5e1",
    borderRadius: "8px",
    // The visual icon stays small (16x10), but the hit area meets the
    // 44px touch-target minimum so phone users can grip it reliably.
    width: "44px",
    minHeight: "44px",
    alignSelf: "stretch",
    padding: 0,
    cursor: "grab",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    opacity: 0.45,
    transition:
      "opacity 160ms ease, background 160ms ease, color 160ms ease, border-color 160ms ease",
  },
  pillButton: {
    border: "1px solid #dbe4ee",
    background: "white",
    color: "#475569",
    borderRadius: "999px",
    padding: "8px 13px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "12px",
    transition: INTERACTIVE_TRANSITION,
    willChange: INTERACTIVE_WILL_CHANGE,
  },
  activePill: {
    border: "1px solid #cbd5e1",
    background: "#e2e8f0",
    color: "#475569",
    borderRadius: "999px",
    padding: "8px 13px",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: "12px",
    transition: INTERACTIVE_TRANSITION,
    willChange: INTERACTIVE_WILL_CHANGE,
  },
  floatingAiButton: {
    position: "fixed",
    right: "18px",
    bottom: "calc(env(safe-area-inset-bottom, 0px) + 18px)",
    zIndex: 35,
    width: "64px",
    height: "64px",
    padding: 0,
    borderRadius: "999px",
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    boxShadow: "0 16px 36px rgba(15, 23, 42, 0.12), 0 4px 12px rgba(15, 23, 42, 0.06)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  switchTrack: {
    width: "48px",
    height: "28px",
    borderRadius: "999px",
    border: "1px solid transparent",
    padding: "3px",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "flex-start",
    transition: INTERACTIVE_TRANSITION,
    willChange: INTERACTIVE_WILL_CHANGE,
    flexShrink: 0,
  },
  switchTrackChecked: {
    background: "#d97706",
    borderColor: "#d97706",
  },
  switchTrackUnchecked: {
    background: "#e2e8f0",
    borderColor: "#cbd5e1",
  },
  switchTrackHover: {
    boxShadow: "0 10px 24px rgba(15,23,42,0.08)",
  },
  switchTrackFocus: {
    boxShadow: "0 0 0 3px rgba(217,119,6,0.18)",
  },
  switchTrackPressed: {
    transform: "scale(0.98)",
  },
  switchTrackDisabled: {
    opacity: 0.6,
    cursor: "not-allowed",
  },
  switchThumb: {
    width: "20px",
    height: "20px",
    borderRadius: "999px",
    background: "#ffffff",
    boxShadow: "0 2px 8px rgba(15,23,42,0.18)",
    transition: "transform 160ms ease",
  },
  dangerButton: {
    border: "1px solid #fecaca",
    background: "#fff1f2",
    color: "#be123c",
    borderRadius: "999px",
    padding: "5px 10px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "12px",
    transition: INTERACTIVE_TRANSITION,
    willChange: INTERACTIVE_WILL_CHANGE,
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: "18px",
    marginBottom: "26px",
  },
  card: {
    background: "#ffffff",
    borderRadius: "20px",
    border: "1px solid #e2e8f0",
    padding: "22px",
    marginBottom: "20px",
    transition: INTERACTIVE_TRANSITION,
    willChange: INTERACTIVE_WILL_CHANGE,
  },
  statCard: {
    background: "#ffffff",
    borderRadius: "16px",
    border: "1px solid #e2e8f0",
    padding: "18px 18px 16px",
    transition: INTERACTIVE_TRANSITION,
    willChange: INTERACTIVE_WILL_CHANGE,
  },
  cardTitle: { fontSize: "18px", fontWeight: 900, letterSpacing: "-0.01em", margin: "0 0 14px" },
  statLabel: {
    color: "#64748b",
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.03em",
    margin: 0,
  },
  statValue: { fontSize: "28px", fontWeight: 900, letterSpacing: "-0.03em", margin: "10px 0 0" },
  mainGridDesktop: {
    display: "grid",
    gridTemplateColumns: "minmax(320px, 430px) minmax(0, 1fr)",
    gap: "24px",
    alignItems: "start",
  },
  mainGridMobile: { display: "grid", gridTemplateColumns: "1fr", gap: "20px" },
  inputGrid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" },
  inputGridSingle: { display: "grid", gridTemplateColumns: "1fr", gap: "12px" },
  label: {
    display: "block",
    fontSize: "12px",
    fontWeight: 700,
    color: "#64748b",
    marginBottom: "7px",
  },
  switchField: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "14px",
    marginTop: "12px",
    padding: "12px 14px",
    borderRadius: "16px",
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
    flexWrap: "wrap",
  },
  switchCopy: {
    display: "grid",
    gap: "4px",
    flex: "1 1 220px",
    minWidth: 0,
  },
  switchControl: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "flex-end",
    flexShrink: 0,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    height: "40px",
    border: "1px solid #cbd5e1",
    borderRadius: "14px",
    padding: "8px 12px",
    fontSize: "14px",
    background: "#ffffff",
    transition: INTERACTIVE_TRANSITION,
  },
  inputHover: { border: "1px solid #cbd5e1" },
  inputFocus: { border: "1px solid #94a3b8", boxShadow: "0 0 0 3px rgba(148,163,184,0.22)" },
  select: {
    width: "100%",
    boxSizing: "border-box",
    height: "40px",
    minWidth: 0,
    border: "1px solid #cbd5e1",
    borderRadius: "14px",
    padding: "8px 26px 8px 10px",
    fontSize: "13px",
    color: "#0f172a",
    background: "#ffffff",
    backgroundImage:
      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'><path d='M2 3.5 L5 6.5 L8 3.5' stroke='%2364748b' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 9px center",
    backgroundSize: "10px 10px",
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
    transition: INTERACTIVE_TRANSITION,
  },
  item: {
    border: "1px solid #e2e8f0",
    borderRadius: "16px",
    background: "#ffffff",
    padding: "14px",
    marginBottom: "12px",
    transition: INTERACTIVE_TRANSITION,
    willChange: INTERACTIVE_WILL_CHANGE,
  },
  mutedBox: {
    background: "#f8fafc",
    borderRadius: "14px",
    padding: "14px",
    marginTop: "12px",
    border: "1px solid #e2e8f0",
  },
  miniGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "8px",
    fontSize: "12px",
  },
  alert: {
    display: "flex",
    gap: "12px",
    background: "#fff1f2",
    border: "1px solid #fecdd3",
    color: "#be123c",
    padding: "16px 18px",
    borderRadius: "16px",
    marginBottom: "24px",
  },
  tableWrap: {
    overflowX: "auto",
    border: "1px solid #e2e8f0",
    borderRadius: "16px",
    background: "white",
  },
  table: { width: "100%", minWidth: "1120px", borderCollapse: "collapse", fontSize: "13px" },
  th: {
    background: "#f8fafc",
    color: "#475569",
    textAlign: "right",
    padding: "12px 10px",
    fontSize: "12px",
    fontWeight: 800,
    borderBottom: "1px solid #e2e8f0",
    position: "sticky",
    top: 0,
    zIndex: 1,
  },
  tableRow: { transition: `background ${MOTION.fast}` },
  td: { textAlign: "right", padding: "12px 10px", borderTop: "1px solid #edf2f7" },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    border: "1px solid #dbe4ee",
    borderRadius: "999px",
    padding: "5px 9px",
    fontSize: "11px",
    fontWeight: 700,
  },
  metaText: { margin: 0, color: "#64748b", fontSize: "13px", lineHeight: 1.65 },
  inlineHint: { display: "inline-flex", alignItems: "center", color: "#475569", fontSize: "12px" },
  exportGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "10px",
  },
  chartTheme: CHART_THEME_VARS,
  surfaceRow: {
    borderRadius: "18px",
    border: "1px solid transparent",
    background: "transparent",
    transition: INTERACTIVE_TRANSITION,
  },
  dropdownMenu: {
    position: "absolute",
    top: "calc(100% + 8px)",
    right: 0,
    minWidth: "220px",
    borderRadius: "16px",
    border: "1px solid #dbe4ee",
    background: "white",
    padding: "8px",
    display: "grid",
    gap: "6px",
    zIndex: 20,
  },
  dropdownItem: {
    border: "none",
    borderRadius: "12px",
    background: "#f8fafc",
    color: "#0f172a",
    textAlign: "left",
    padding: "10px 12px",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
    transition: INTERACTIVE_TRANSITION,
    willChange: INTERACTIVE_WILL_CHANGE,
  },
  sharePopover: {
    position: "absolute",
    top: "calc(100% + 8px)",
    left: 0,
    width: "min(460px, calc(100vw - 56px))",
    borderRadius: "20px",
    border: "1px solid #dbe4ee",
    background: "white",
    padding: "14px",
    zIndex: 30,
  },
  readonlyBadge: {
    marginTop: "10px",
    display: "inline-block",
    borderRadius: "999px",
    padding: "5px 9px",
    background: "#f8fafc",
    color: "#475569",
    fontSize: "11px",
    fontWeight: 800,
  },
  mobileMetrics: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "8px",
    fontSize: "13px",
    color: "#334155",
  },
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.48)",
    display: "grid",
    placeItems: "center",
    padding: "20px",
    zIndex: 50,
  },
  modalCard: {
    width: "min(680px, 100%)",
    background: "white",
    borderRadius: "24px",
    border: "1px solid #dbe4ee",
    padding: "20px",
  },
};

export default function PersonalFinanceCashflowSimulator() {
  // Read everything we need from localStorage in one synchronous pass
  // on the first render. Each downstream hook then initialises lazily
  // from this snapshot — no setState-in-effect required at mount.
  const [initialBoot] = useState(readInitialBoot);
  const {
    value: scenario,
    setValue: setScenario,
    replace: replaceScenario,
    reset: resetScenarioHistory,
  } = useUndoableState(() => initialBoot.localDraft || createDefaultScenario());
  const [sessionMeta, setSessionMeta] = useState(() => initialBoot.sessionMeta);
  // The user's explicit month selection. The displayed month
  // (`selectedMonthKey` below) falls back to the first projected row
  // when the user hasn't picked one, so we don't have to mirror that
  // default into state.
  const [userSelectedMonthKey, setUserSelectedMonthKey] = useState("");
  const [expenseMode, setExpenseMode] = useState("absolute");
  const [expenseView, setExpenseView] = useState("group");
  const [isOneTimeOpen, setIsOneTimeOpen] = useState(false);
  const [isInstallmentsOpen, setIsInstallmentsOpen] = useState(false);
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
  const [openOneTimeItemIds, setOpenOneTimeItemIds] = useState({});
  const [openInstallmentItemIds, setOpenInstallmentItemIds] = useState({});
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [hydrationNotice, setHydrationNotice] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [exportMenuCoords, setExportMenuCoords] = useState({ top: 0, right: 0 });
  const exportTriggerRef = useRef(null);
  const [isPreparingPdf, setIsPreparingPdf] = useState(false);
  const [isPreparingReportExport, setIsPreparingReportExport] = useState(false);
  const [isOffline, setIsOffline] = useState(() =>
    typeof navigator === "undefined" ? false : !navigator.onLine,
  );
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1200 : window.innerWidth,
  );
  const [bulkInstallmentText, setBulkInstallmentText] = useState("");
  const [bulkInstallmentErrors, setBulkInstallmentErrors] = useState([]);
  const [bulkInstallmentPreview, setBulkInstallmentPreview] = useState([]);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiHistory, setAiHistory] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDraftMessage, setAiDraftMessage] = useState("");
  const [aiProposal, setAiProposal] = useState(null);
  const [aiError, setAiError] = useState("");
  const [aiQuota, setAiQuota] = useState(null);
  const [compareB, setCompareB] = useState(null);
  const snackbar = useSnackbar();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const aiRequestControllerRef = useRef(null);
  const aiRequestIdRef = useRef(0);
  const aiLoadingStartedAtRef = useRef(0);
  const monthRefs = useRef({});
  const fileInputRef = useRef(null);
  const cloudHydratedRef = useRef(false);
  const hasLocalDraftRef = useRef(Boolean(initialBoot.localDraft));
  const hasPendingCloudSyncRef = useRef(Boolean(initialBoot.pendingCloudSync));
  const pendingExistedAtMountRef = useRef(Boolean(initialBoot.pendingCloudSync));
  const pendingUpdatedAtAtMountRef = useRef(initialBoot.pendingCloudSync?.updatedAt || null);
  // Synchronous boot: hydration is "initialised" from the very first
  // render because we already wired the local draft into useUndoableState
  // and the initial cloud sync status into useCloudSync above.
  const hydrationInitializedRef = useRef(true);
  const autoSyncTimerRef = useRef(null);
  const scenarioInitializedRef = useRef(false);
  const skipNextScenarioDirtyRef = useRef(false);
  const reportRef = useRef(null);
  const trendChartRef = useRef(null);
  const incomeChartRef = useRef(null);
  const compositionChartRef = useRef(null);
  const monthDetailRef = useRef(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const isExporting = isPreparingPdf || isPreparingReportExport;
  const mobile = !isExporting && viewportWidth < 860;
  const hiddenAmounts = false;
  const readonlyShared = false;
  const jpyExchangeRate = useJpyExchangeRate();
  // useDeferredValue lets React drop intermediate scenarios when the user is
  // typing fast, so buildProjection only re-runs once the input settles.
  const deferredScenario = useDeferredValue(scenario);
  const effectiveJpyTwd = useMemo(
    () => resolveJpyCashTwd(deferredScenario.basics, jpyExchangeRate.rate),
    [deferredScenario.basics, jpyExchangeRate.rate],
  );
  const projectionResult = useMemo(
    () => buildProjection(deferredScenario, jpyExchangeRate.rate),
    [deferredScenario, jpyExchangeRate.rate],
  );
  const rows = useMemo(
    () => (Array.isArray(projectionResult) ? projectionResult : projectionResult.rows),
    [projectionResult],
  );
  const installmentRows = useMemo(
    () => (Array.isArray(projectionResult) ? [] : projectionResult.installmentRows),
    [projectionResult],
  );
  const editableInstallments = useMemo(
    () => decorateInstallments(scenario.installments),
    [scenario.installments],
  );
  const generatedAt = useMemo(() => new Date(), []);
  const reportPeriodLabel = useMemo(() => {
    if (!rows.length) return `${formatMonthLabel(scenario.meta.baseMonth)} 起`;
    return `${rows[0].fullLabel} - ${rows[rows.length - 1].fullLabel}`;
  }, [rows, scenario.meta.baseMonth]);
  const generatedAtLabel = useMemo(
    () =>
      generatedAt.toLocaleString("zh-TW", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [generatedAt],
  );
  const lastSyncedAtLabel = useMemo(
    () => formatRelativeTimestamp(sessionMeta.lastSyncedAt),
    [sessionMeta.lastSyncedAt],
  );

  const transitionApply = useCallback(
    (nextScenario, options = {}) => {
      skipNextScenarioDirtyRef.current = options.markDirty === false;
      const migrated = migrateLegacyScenario(nextScenario);
      syncItemIdSequenceFromScenario(migrated);
      // Authoritative loads (mount hydration, cloud refresh) wipe the
      // history; user-initiated replacements still flow through the
      // same replace path so local draft persistence stays consistent.
      if (options.markDirty === false) {
        resetScenarioHistory(migrated);
      } else {
        replaceScenario(migrated);
      }
      setUserSelectedMonthKey("");
    },
    [resetScenarioHistory, replaceScenario],
  );

  const resolveSyncPayloadForHook = useCallback(
    (candidate) => resolveSyncPayload(candidate, scenario),
    [scenario],
  );

  // ── AI scenario handlers ─────────────────────────────────────────────────
  const cancelAiRequest = useCallback(() => {
    aiRequestControllerRef.current?.abort();
    aiRequestControllerRef.current = null;
    setAiLoading(false);
    setAiDraftMessage("");
  }, []);

  useEffect(() => {
    if (!aiLoading) return undefined;

    aiLoadingStartedAtRef.current = Date.now();

    const updateDraftMessage = () => {
      setAiDraftMessage(getAiStreamingStatusText(Date.now() - aiLoadingStartedAtRef.current));
    };

    updateDraftMessage();
    const intervalId = window.setInterval(updateDraftMessage, 250);

    return () => window.clearInterval(intervalId);
  }, [aiLoading]);

  const handleAiSend = useCallback(
    async (text) => {
      if (aiLoading) return;
      setAiError("");
      setAiHistory((h) => [...h, { role: "user", content: text }]);
      const controller = new AbortController();
      const requestId = aiRequestIdRef.current + 1;
      aiRequestIdRef.current = requestId;
      aiRequestControllerRef.current = controller;
      setAiLoading(true);
      try {
        const supa = createFlowraSupabaseClient();
        const res = await callAiScenario(supa, {
          scenario,
          userMessage: text,
          history: aiHistory,
          signal: controller.signal,
        });
        if (aiRequestIdRef.current !== requestId) return;
        setAiQuota({ used: res.used, quota: res.quota });
        if (res.kind === "clarify") {
          setAiDraftMessage("");
          setAiHistory((h) => [...h, { role: "assistant", questions: res.questions }]);
        } else if (res.kind === "diff") {
          setAiDraftMessage("");
          setAiHistory((h) => [...h, { role: "assistant", content: AI_DIFF_READY_MESSAGE }]);
          setAiProposal(res.diff);
        }
      } catch (e) {
        if (e?.name === "AbortError") return;
        setAiDraftMessage("");
        setAiError(e.message || "AI 輔助分析失敗");
      } finally {
        if (aiRequestIdRef.current === requestId) {
          aiRequestControllerRef.current = null;
          setAiLoading(false);
        }
      }
    },
    [scenario, aiHistory, aiLoading],
  );

  const handleAiApply = useCallback(() => {
    try {
      if (!aiProposal) return;
      const scenarioB = applyDiff(scenario, aiProposal);
      const projB = buildProjection(scenarioB, jpyExchangeRate.rate);
      const rowsB = Array.isArray(projB) ? projB : projB.rows;
      setCompareB({ scenario: scenarioB, rows: rowsB, summary: aiProposal.summary || "" });
      setAiProposal(null);
      setAiOpen(false);
    } catch (e) {
      setAiError(`AI 提議無法套用：${e.message}`);
    }
  }, [scenario, aiProposal, jpyExchangeRate.rate]);

  const handleAiDiscard = useCallback(() => setAiProposal(null), []);
  const handleAiNewChat = useCallback(() => {
    cancelAiRequest();
    setAiHistory([]);
    setAiProposal(null);
    setAiError("");
  }, [cancelAiRequest]);
  const handleAiStop = useCallback(() => {
    cancelAiRequest();
  }, [cancelAiRequest]);
  const handleAiClose = useCallback(() => {
    cancelAiRequest();
    setAiOpen(false);
  }, [cancelAiRequest]);
  const handleLeaveCompare = useCallback(() => setCompareB(null), []);
  const handleAdoptB = useCallback(() => {
    if (!compareB) return;
    transitionApply(compareB.scenario);
    setCompareB(null);
  }, [compareB, transitionApply]);
  // ── end AI handlers ──────────────────────────────────────────────────────

  const applyCloudPayload = useCallback(
    (payload) => transitionApply(payload, { markDirty: false }),
    [transitionApply],
  );

  useEffect(() => () => cancelAiRequest(), [cancelAiRequest]);

  const cloud = useCloudSync({
    resolveSyncPayload: resolveSyncPayloadForHook,
    setSessionMeta,
    writeSessionMeta,
    isOffline,
    applyCloudPayload,
    hasPendingCloudSyncRef,
    initialSyncStatus: useMemo(
      () =>
        resolveInitialCloudSyncStatus({
          localDraft: initialBoot.localDraft,
          pendingCloudSync: initialBoot.pendingCloudSync,
          lastSyncedAt: initialBoot.sessionMeta.lastSyncedAt,
        }),
      [initialBoot],
    ),
  });
  const {
    authState: cloudAuthState,
    setupState: cloudSetupState,
    syncStatus: cloudSyncStatus,
    userEmail: cloudUserEmail,
    notice: cloudNotice,
    isBackupLoading: isCloudBackupLoading,
    isSigningIn: isSigningInWithGoogle,
    isHydrated: isCloudHydrated,
    cloudFeaturesEnabled,
    cloudSetupMessage,
    supabaseReady,
    isDevMode,
    setSyncStatus: setCloudSyncStatus,
    setIsHydrated: setIsCloudHydrated,
    refreshBackup: refreshCloudBackup,
    syncToCloud: syncScenarioToCloud,
    signIn: signInWithGoogleHandler,
    signOut: signOutFromSupabase,
  } = cloud;

  const aiDisabledReason = !supabaseReady
    ? "雲端尚未啟用，無法使用 AI 輔助分析"
    : cloudAuthState !== "authenticated"
      ? "請先登入才能使用 AI 輔助分析"
      : "";

  // Persist the latest "lastOpenedAt" timestamp on mount. This is a
  // pure side effect to localStorage — no state needs to track this
  // value (it's only ever read on next boot via readSessionMeta), so
  // we don't synchronously call setSessionMeta here.
  useEffect(() => {
    if (typeof window === "undefined") return;
    writeSessionMeta({ lastOpenedAt: new Date().toISOString() });
  }, []);

  useEffect(() => {
    syncItemIdSequenceFromScenario(scenario);
  }, [scenario]);

  // selectedMonthKey is purely derived: user pick wins, otherwise the
  // first projected row's month. No effect needed.
  const selectedMonthKey = userSelectedMonthKey || rows[0]?.monthKey || "";

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Hydration banner auto-dismiss after 8 seconds. The banner stays
  // permanent for the cloud-overrode-local case because that's the
  // path where the user might want to restore the discarded draft.
  useEffect(() => {
    if (!hydrationNotice) return undefined;
    if (hydrationNotice.source === "cloud" && hydrationNotice.savedDraft) return undefined;
    const timer = setTimeout(() => setHydrationNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [hydrationNotice]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const updateOnlineState = () => setIsOffline(!navigator.onLine);

    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);

    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  useEffect(() => {
    if (!scenarioInitializedRef.current) {
      scenarioInitializedRef.current = true;
      return;
    }
    if (skipNextScenarioDirtyRef.current) {
      skipNextScenarioDirtyRef.current = false;
      return;
    }
    if (typeof window !== "undefined" && window.localStorage) {
      const persisted = toPersistedScenario(scenario);
      const updatedAt = new Date().toISOString();
      writeDraftScenario(window.localStorage, persisted);
      writePendingCloudSync(window.localStorage, persisted, updatedAt);
      hasLocalDraftRef.current = true;
      hasPendingCloudSyncRef.current = true;
    }
    setCloudSyncStatus((current) => (current === "syncing" ? current : "pending"));
  }, [scenario, setCloudSyncStatus]);

  useEffect(() => {
    if (!selectedMonthKey || !monthRefs.current[selectedMonthKey]) return;
    monthRefs.current[selectedMonthKey].scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
  }, [selectedMonthKey]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      cloudAuthState !== "authenticated" ||
      cloudSetupState !== "ready" ||
      cloudSyncStatus !== "pending" ||
      !isCloudHydrated ||
      isOffline
    ) {
      return undefined;
    }

    const pendingCloudSync = readPendingCloudSync(window.localStorage);
    if (!pendingCloudSync?.payload) return undefined;

    autoSyncTimerRef.current = window.setTimeout(async () => {
      autoSyncTimerRef.current = null;
      await syncScenarioToCloud(pendingCloudSync.payload, { silent: true });
    }, 1500);

    return () => {
      if (autoSyncTimerRef.current) {
        window.clearTimeout(autoSyncTimerRef.current);
        autoSyncTimerRef.current = null;
      }
    };
  }, [
    cloudAuthState,
    cloudSetupState,
    cloudSyncStatus,
    isCloudHydrated,
    isOffline,
    scenario,
    syncScenarioToCloud,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const isEditableTarget = (target) => {
      if (!target) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsExportMenuOpen(false);
        setShortcutsOpen(false);
        return;
      }
      if (event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        setShortcutsOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!isExportMenuOpen || typeof window === "undefined") return undefined;
    const update = () => {
      if (!exportTriggerRef.current) return;
      const rect = exportTriggerRef.current.getBoundingClientRect();
      setExportMenuCoords({
        top: rect.bottom + 8,
        right: clampDropdownRight({
          triggerRight: rect.right,
          menuMinWidth: 220,
          viewportWidth: window.innerWidth,
        }),
      });
    };
    update();
    const onPointerDown = (event) => {
      if (!exportTriggerRef.current) return;
      if (exportTriggerRef.current.contains(event.target)) return;
      if (event.target.closest && event.target.closest("[data-export-menu]")) return;
      setIsExportMenuOpen(false);
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [isExportMenuOpen]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !supabaseReady ||
      cloudAuthState !== "authenticated" ||
      cloudSetupState !== "ready" ||
      !hydrationInitializedRef.current ||
      cloudHydratedRef.current
    ) {
      return undefined;
    }
    let cancelled = false;
    const hydrateFromCloud = async () => {
      const { data: cloudBackup } = await refreshCloudBackup({ silent: true, applyPayload: false });
      if (cancelled) return;
      cloudHydratedRef.current = true;

      // Always re-read the latest local draft — it may have changed between
      // mount and the cloud fetch resolving (e.g. user typed during loading).
      const localDraft = window.localStorage ? readDraftScenario(window.localStorage) : null;

      const hydration = resolveHydrationSource({
        localDraft,
        cloudPayload: cloudBackup?.payload || null,
        cloudUpdatedAt: cloudBackup?.updated_at || null,
        pendingExistedAtMount: pendingExistedAtMountRef.current,
        pendingUpdatedAtAtMount: pendingUpdatedAtAtMountRef.current,
      });

      if (hydration.source === "cloud" && hydration.payload) {
        transitionApply(hydration.payload, { markDirty: false });
        // Cloud is authoritative now — discard any pending record so the
        // autoSync effect cannot push stale (or default-shaped) local data
        // back over the freshly-restored cloud copy.
        if (window.localStorage) {
          clearPendingCloudSync(window.localStorage);
        }
        hasPendingCloudSyncRef.current = false;
        setCloudSyncStatus("synced");
      }

      const notice = describeHydrationDecision({
        source: hydration.source,
        cloudPayload: cloudBackup?.payload || null,
        cloudUpdatedAt: cloudBackup?.updated_at || null,
        pendingExistedAtMount: pendingExistedAtMountRef.current,
        pendingUpdatedAtAtMount: pendingUpdatedAtAtMountRef.current,
        localDraft,
      });
      if (notice) setHydrationNotice(notice);

      setIsCloudHydrated(true);
    };

    if (isDevMode) {
      hydrateFromCloud();
      return () => {
        cancelled = true;
      };
    }

    const supabase = createFlowraSupabaseClient();
    if (!supabase) return undefined;

    supabase.auth.getSession().then(async ({ data, error }) => {
      if (cancelled || error || !data?.session || cloudHydratedRef.current) return;
      await hydrateFromCloud();
    });

    return () => {
      cancelled = true;
    };
  }, [
    cloudAuthState,
    cloudSetupState,
    isDevMode,
    supabaseReady,
    refreshCloudBackup,
    transitionApply,
    setCloudSyncStatus,
    setIsCloudHydrated,
  ]);

  const summary = useMemo(() => {
    const balances = rows.map((row) => row.balance);
    const minBalance = balances.length ? Math.min(...balances) : 0;
    const finalBalance = rows.length ? rows[rows.length - 1].balance : 0;
    const totalIncome = rows.reduce((sum, row) => sum + row.income, 0);
    const totalExpense = rows.reduce((sum, row) => sum + row.expense, 0);
    const totalInstallmentInterest = installmentRows.reduce((sum, row) => sum + row.interest, 0);
    return { minBalance, finalBalance, totalIncome, totalExpense, totalInstallmentInterest };
  }, [rows, installmentRows]);

  const patchMeta = (patch) => {
    setScenario((current) => cloneScenario(current, { meta: { ...current.meta, ...patch } }));
  };

  const patchBasics = (patch) => {
    setScenario((current) => cloneScenario(current, { basics: { ...current.basics, ...patch } }));
  };

  const updateOneTimeItem = (id, patch) => {
    setScenario((current) =>
      cloneScenario(current, {
        oneTimeItems: current.oneTimeItems.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
      }),
    );
  };

  const updateInstallment = (id, patch) => {
    setScenario((current) =>
      cloneScenario(current, {
        installments: current.installments.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
      }),
    );
  };

  const addOneTimeItem = () => {
    const id = makeItemId("one-time");
    setScenario((current) =>
      cloneScenario(current, {
        oneTimeItems: [
          ...current.oneTimeItems,
          {
            id,
            name: "新增單筆項目",
            amount: 1000,
            month: current.meta.baseMonth,
            type: "expense",
            category: "other",
          },
        ],
      }),
    );
    setIsOneTimeOpen(true);
    setOpenOneTimeItemIds((current) => ({ ...current, [id]: true }));
  };

  const addInstallment = () => {
    const id = makeItemId("installment");
    setScenario((current) =>
      cloneScenario(current, {
        installments: [
          ...current.installments,
          {
            id,
            name: "新增分期",
            principal: 10000,
            apr: 10,
            terms: 6,
            startMonth: addMonths(current.meta.baseMonth, 1),
          },
        ],
      }),
    );
    setIsInstallmentsOpen(true);
    setOpenInstallmentItemIds((current) => ({ ...current, [id]: true }));
  };

  const restoreOneTimeItem = (snapshot, index) => {
    setScenario((current) => {
      if (current.oneTimeItems.some((item) => item.id === snapshot.id)) return current;
      const next = [...current.oneTimeItems];
      const insertAt = Math.max(0, Math.min(next.length, index));
      next.splice(insertAt, 0, snapshot);
      return cloneScenario(current, { oneTimeItems: next });
    });
  };

  const restoreInstallment = (snapshot, index) => {
    setScenario((current) => {
      if (current.installments.some((item) => item.id === snapshot.id)) return current;
      const next = [...current.installments];
      const insertAt = Math.max(0, Math.min(next.length, index));
      next.splice(insertAt, 0, snapshot);
      return cloneScenario(current, { installments: next });
    });
  };

  const removeOneTimeItem = (id) => {
    const index = scenario.oneTimeItems.findIndex((item) => item.id === id);
    const snapshot = index >= 0 ? scenario.oneTimeItems[index] : null;
    setScenario((current) =>
      cloneScenario(current, {
        oneTimeItems: current.oneTimeItems.filter((item) => item.id !== id),
      }),
    );
    setOpenOneTimeItemIds((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (snapshot) {
      snackbar.push({
        message: `已刪除「${snapshot.name || "未命名項目"}」`,
        actionLabel: "復原",
        onAction: () => restoreOneTimeItem(snapshot, index),
      });
    }
  };

  const removeInstallment = (id) => {
    const index = scenario.installments.findIndex((item) => item.id === id);
    const snapshot = index >= 0 ? scenario.installments[index] : null;
    setScenario((current) =>
      cloneScenario(current, {
        installments: current.installments.filter((item) => item.id !== id),
      }),
    );
    setOpenInstallmentItemIds((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (snapshot) {
      snackbar.push({
        message: `已刪除「${snapshot.name || "未命名分期"}」`,
        actionLabel: "復原",
        onAction: () => restoreInstallment(snapshot, index),
      });
    }
  };

  const duplicateOneTimeItem = (id) => {
    setScenario((current) => {
      const target = current.oneTimeItems.find((item) => item.id === id);
      if (!target) return current;
      const duplicate = { ...target, id: makeItemId("one-time"), name: `${target.name} 副本` };
      return cloneScenario(current, { oneTimeItems: [...current.oneTimeItems, duplicate] });
    });
  };

  const duplicateInstallment = (id) => {
    setScenario((current) => {
      const target = current.installments.find((item) => item.id === id);
      if (!target) return current;
      const duplicate = {
        ...target,
        id: makeItemId("installment"),
        name: `${target.name} 副本`,
      };
      return cloneScenario(current, { installments: [...current.installments, duplicate] });
    });
  };

  const importBulkInstallments = () => {
    if (bulkInstallmentErrors.length > 0 || bulkInstallmentPreview.length === 0) {
      return;
    }
    setScenario((current) =>
      cloneScenario(current, {
        installments: [...current.installments, ...bulkInstallmentPreview],
      }),
    );
    setBulkInstallmentText("");
    setBulkInstallmentPreview([]);
    setBulkInstallmentErrors([]);
    setIsBulkImportOpen(false);
    setIsInstallmentsOpen(true);
  };

  const previewBulkInstallments = () => {
    const result = parseInstallmentLines(bulkInstallmentText, scenario.meta.baseMonth);
    setBulkInstallmentErrors(result.errors);
    setBulkInstallmentPreview(result.parsed);
  };

  const handleOneTimeDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setScenario((current) => {
      const oldIndex = current.oneTimeItems.findIndex((item) => item.id === active.id);
      const newIndex = current.oneTimeItems.findIndex((item) => item.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return current;
      return cloneScenario(current, {
        oneTimeItems: arrayMove(current.oneTimeItems, oldIndex, newIndex),
      });
    });
  };

  const handleInstallmentDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setScenario((current) => {
      const oldIndex = current.installments.findIndex((item) => item.id === active.id);
      const newIndex = current.installments.findIndex((item) => item.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return current;
      return cloneScenario(current, {
        installments: arrayMove(current.installments, oldIndex, newIndex),
      });
    });
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(toPersistedScenario(scenario), null, 2)], {
      type: "application/json",
    });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${exportFileBase(scenario.meta.baseMonth)}.json`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const sheet = XLSX.utils.json_to_sheet(
      rows.map((row) => ({
        月份: row.fullLabel,
        月初現金: Math.round(row.startBalance),
        薪資: Math.round(row.salary),
        補貼: Math.round(row.subsidy),
        一次收入: Math.round(row.oneTimeIncome),
        房租: Math.round(row.rent),
        生活費: Math.round(row.living),
        學貸: Math.round(row.studentLoan),
        一次支出: Math.round(row.oneTimeExpense),
        分期: Math.round(row.installments),
        月淨額: Math.round(row.net),
        月底現金: Math.round(row.balance),
      })),
    );
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "月度明細");
    XLSX.writeFile(workbook, `${exportFileBase(scenario.meta.baseMonth)}.xlsx`);
  };

  const captureNodeAsPng = async (node, toPng) => {
    // Wait two animation frames so the export-mode CSS (forced 1200px width,
    // overflow:visible, mobile→desktop) has applied before measuring.
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
    const width = Math.max(node.scrollWidth, node.offsetWidth);
    const height = Math.max(node.scrollHeight, node.offsetHeight);
    return toPng(node, {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: "#ffffff",
      width,
      height,
      style: {
        transform: "none",
        margin: "0",
        width: `${width}px`,
        height: `${height}px`,
      },
    });
  };

  const exportPng = async () => {
    if (!reportRef.current) return;
    try {
      setIsPreparingReportExport(true);
      const { toPng } = await import("html-to-image");
      const dataUrl = await captureNodeAsPng(reportRef.current, toPng);
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = `${exportFileBase(scenario.meta.baseMonth)}.png`;
      anchor.click();
    } catch (error) {
      window.alert("圖片下載失敗，請稍後再試。");
    } finally {
      setIsPreparingReportExport(false);
    }
  };

  const exportChartPng = async (targetRef, fileSuffix) => {
    if (!targetRef?.current) return;
    try {
      targetRef.current.classList.add("flowra-capture-export");
      const { toPng } = await import("html-to-image");
      const dataUrl = await captureNodeAsPng(targetRef.current, toPng);
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = `${exportFileBase(scenario.meta.baseMonth)}-${fileSuffix}.png`;
      anchor.click();
    } catch (error) {
      window.alert("圖表下載失敗，請稍後再試。");
    } finally {
      targetRef.current.classList.remove("flowra-capture-export");
    }
  };

  const exportPdf = async () => {
    if (!reportRef.current) return;
    try {
      setIsPreparingPdf(true);
      const [{ toPng }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
      const dataUrl = await captureNodeAsPng(reportRef.current, toPng);
      const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const usableWidth = pageWidth - margin * 2;
      const usableHeight = pageHeight - margin * 2;
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = dataUrl;
      });
      const renderWidth = usableWidth;
      const renderHeight = (img.height * renderWidth) / img.width;
      let heightLeft = renderHeight;
      let position = margin;
      pdf.addImage(dataUrl, "PNG", margin, position, renderWidth, renderHeight);
      heightLeft -= usableHeight;
      while (heightLeft > 0) {
        position = margin - (renderHeight - heightLeft);
        pdf.addPage();
        pdf.addImage(dataUrl, "PNG", margin, position, renderWidth, renderHeight);
        heightLeft -= usableHeight;
      }
      pdf.save(`${exportFileBase(scenario.meta.baseMonth)}.pdf`);
    } catch (error) {
      window.alert("報表下載失敗，請稍後再試。");
    } finally {
      setIsPreparingPdf(false);
    }
  };

  const printReport = () => {
    window.print();
  };

  const importJson = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const validation = validateImportedScenario(parsed);
      if (!validation.ok) {
        setImportPreview({ status: "error", message: validation.message, fileName: file.name });
        event.target.value = "";
        return;
      }
      const incoming = migrateLegacyScenario(parsed);
      setImportPreview({
        status: "ready",
        fileName: file.name,
        mode: validation.mode || "current",
        incoming,
      });
    } catch (error) {
      setImportPreview({
        status: "error",
        message: "資料匯入失敗，請確認檔案格式正確。",
        fileName: file?.name || "",
      });
    }
    event.target.value = "";
  };

  const confirmImport = () => {
    if (!importPreview || importPreview.status !== "ready") return;
    transitionApply(importPreview.incoming);
    setImportPreview(null);
  };

  const importPreviewDiff = useMemo(
    () =>
      importPreview?.status === "ready"
        ? computeImportDiff(scenario, importPreview.incoming)
        : null,
    [importPreview, scenario],
  );

  const focusCompositionMonth = (monthKey) => {
    setUserSelectedMonthKey(monthKey);
    if (compositionChartRef.current) {
      compositionChartRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
        inline: "nearest",
      });
    }
  };

  const mainGridClassName =
    "flowra-main-grid grid grid-cols-1 gap-5 xl:grid-cols-[minmax(320px,430px)_minmax(0,1fr)] xl:items-start";
  const inputGridClassName = "grid grid-cols-1 gap-3 sm:grid-cols-2";
  const cloudStatusLine = formatAutoSyncStatus({
    cloudAuthState,
    cloudSetupState,
    cloudSyncStatus,
    lastSyncedAtLabel,
    isOffline,
    cloudSetupMessage,
  });
  const cloudStatusIsWarning =
    cloudAuthState !== "authenticated" ||
    (cloudAuthState === "authenticated" &&
      cloudSetupState !== "ready" &&
      cloudSetupState !== "checking");

  return (
    <div style={styles.page}>
      <style>{`
        @media print {
          .flowra-no-print {
            display: none !important;
          }
          .flowra-print-root {
            background: white !important;
            padding: 0 !important;
          }
          .flowra-print-card {
            box-shadow: none !important;
            border-color: #cbd5e1 !important;
            break-inside: avoid;
          }
        }
        .flowra-pdf-export .flowra-no-report-export,
        .flowra-pdf-export .flowra-no-print,
        .flowra-pdf-export .flowra-no-export,
        .flowra-report-export .flowra-no-report-export,
        .flowra-report-export .flowra-no-print,
        .flowra-report-export .flowra-no-export,
        .flowra-capture-export .flowra-no-print,
        .flowra-capture-export .flowra-no-export {
          display: none !important;
        }
        .flowra-pdf-export .flowra-main-grid {
          grid-template-columns: 1fr !important;
        }
        .flowra-report-export .flowra-main-grid {
          grid-template-columns: 1fr !important;
        }
        .flowra-pdf-export,
        .flowra-report-export,
        .flowra-capture-export {
          width: 1200px !important;
          max-width: 1200px !important;
          min-width: 1200px !important;
        }
        .flowra-pdf-export .flowra-table-wrap,
        .flowra-report-export .flowra-table-wrap,
        .flowra-capture-export .flowra-table-wrap {
          overflow: visible !important;
        }
        .flowra-pdf-export .flowra-collapsible,
        .flowra-report-export .flowra-collapsible,
        .flowra-capture-export .flowra-collapsible {
          grid-template-rows: 1fr !important;
          opacity: 1 !important;
        }
        .flowra-pdf-export .flowra-collapsible[data-open="false"],
        .flowra-report-export .flowra-collapsible[data-open="false"],
        .flowra-capture-export .flowra-collapsible[data-open="false"] {
          display: none !important;
        }
        .flowra-pdf-export .flowra-collapsible-inner,
        .flowra-report-export .flowra-collapsible-inner,
        .flowra-capture-export .flowra-collapsible-inner {
          overflow: visible !important;
        }
        .flowra-hover-card:hover {
          border-color: #cbd5e1 !important;
        }
        .flowra-table-row:hover {
          background: #f8fafc !important;
        }
        .flowra-table-row.is-active:hover {
          background: #e2e8f0 !important;
        }
        .flowra-surface-row:hover {
          border-color: #e2e8f0 !important;
          background: #f8fafc !important;
        }
        .flowra-sortable-item:hover .flowra-drag-handle,
        .flowra-sortable-item:focus-within .flowra-drag-handle {
          opacity: 0.95;
          color: #94a3b8;
        }
        .flowra-drag-handle:hover:not(.is-dragging) {
          opacity: 1 !important;
          background: #f1f5f9;
          color: #475569;
          border-color: #e2e8f0 !important;
        }
        .flowra-drag-handle.is-dragging {
          opacity: 1 !important;
          background: #f1f5f9;
          color: #334155;
          border-color: #e2e8f0 !important;
        }
        @media (hover: none) {
          .flowra-drag-handle {
            opacity: 0.6 !important;
          }
        }
        .flowra-drag-handle:focus-visible {
          outline: 2px solid #94a3b8;
          outline-offset: 2px;
        }
        .flowra-surface-enter {
          animation: flowra-surface-enter 160ms ease both;
        }
        @keyframes flowra-surface-enter {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .flowra-tab-content-enter {
          animation: flowra-tab-content-enter 220ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes flowra-tab-content-enter {
          from {
            opacity: 0.58;
            transform: translateX(8px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        input[type="number"]::-webkit-outer-spin-button,
        input[type="number"]::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        input[type="number"] {
          -moz-appearance: textfield;
          appearance: textfield;
        }
      `}</style>
      <div
        style={{ ...styles.container, ...styles.chartTheme }}
        className={`flowra-print-root${isPreparingPdf ? " flowra-pdf-export" : ""}${isPreparingReportExport ? " flowra-report-export" : ""}`}
        ref={reportRef}
      >
        <div style={styles.header}>
          <div>
            <h1 style={{ ...styles.title, userSelect: "none", WebkitUserSelect: "none" }}>
              Flowra
            </h1>
            <p style={styles.subtitle}>用來試算未來幾個月的現金流與支出變化。</p>
            <div style={{ ...styles.metaText, marginTop: "10px" }}>
              試算期間：{reportPeriodLabel}　|　產生時間：{generatedAtLabel}
            </div>
          </div>
        </div>
        <div style={styles.summaryGrid}>
          <StatCard
            label="最後剩餘現金"
            value={summary.finalBalance}
            hidden={hiddenAmounts}
            danger={summary.finalBalance < 0}
          />
          <StatCard
            label="最低剩餘現金"
            value={summary.minBalance}
            hidden={hiddenAmounts}
            danger={summary.minBalance < 0}
          />
          <StatCard label="這段期間總收入" value={summary.totalIncome} hidden={hiddenAmounts} />
          <StatCard
            label="分期利息總額"
            value={summary.totalInstallmentInterest}
            hidden={hiddenAmounts}
          />
        </div>

        {summary.minBalance < 0 ? (
          <div style={styles.alert}>
            <div>
              <strong>現金可能不夠用</strong>
              <div>
                依目前設定，這段期間最低會剩 {maskCurrency(summary.minBalance, hiddenAmounts)}
                。建議降低生活開銷、延後支出、增加收入或調整分期期數。
              </div>
            </div>
          </div>
        ) : null}

        {isOffline ? (
          <div
            className="flowra-no-print flowra-no-report-export"
            style={{
              marginBottom: "12px",
              padding: "10px 14px",
              borderRadius: "12px",
              border: "1px solid #fcd34d",
              background: "#fffbeb",
              color: "#92400e",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              fontSize: "13px",
            }}
            role="alert"
            data-testid="offline-banner"
          >
            <span
              aria-hidden="true"
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "999px",
                background: "#d97706",
                flexShrink: 0,
              }}
            />
            <span style={{ fontWeight: 700 }}>目前離線</span>
            <span style={{ color: "#a16207" }}>變更會暫存在這台裝置，恢復連線後會自動同步。</span>
          </div>
        ) : null}

        {hydrationNotice && hydrationNotice.source !== "cloud" ? (
          <div
            className="flowra-no-print flowra-no-report-export"
            style={{
              marginBottom: "16px",
              padding: "12px 16px",
              borderRadius: "12px",
              border: "1px solid #cbd5e1",
              background: "#f8fafc",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px",
              color: "#0f172a",
              fontSize: "13px",
            }}
            role="status"
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
              <strong>保留本機未同步編輯</strong>
              <span style={{ color: "#475569", fontSize: "12px" }}>
                你的本機版本（{formatTimestamp(hydrationNotice.pendingUpdatedAt)}）比雲端新，
                雲端會在下次同步時被覆蓋。
              </span>
            </div>
            <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
              <InteractiveButton variant="smallButton" onClick={() => setHydrationNotice(null)}>
                關閉
              </InteractiveButton>
            </div>
          </div>
        ) : null}

        <div className={mainGridClassName}>
          <div className="flowra-no-print flowra-no-report-export">
            <InteractiveSurface as="section" style={styles.card} hoverClassName="flowra-hover-card">
              <h2 style={styles.cardTitle}>試算設定</h2>

              <SettingsGroup title="試算期間" accent="#64748b">
                <div className={inputGridClassName}>
                  <BaseMonthPicker
                    value={scenario.meta.baseMonth}
                    onChange={(value) => patchMeta({ baseMonth: value })}
                    disabled={readonlyShared}
                  />
                  <Field
                    label="試算幾個月"
                    value={scenario.basics.monthsToProject}
                    onChange={(value) =>
                      patchBasics({ monthsToProject: Math.max(0, Math.round(value)) })
                    }
                    suffix="月"
                    min={0}
                    step={1}
                    disabled={readonlyShared}
                  />
                </div>
              </SettingsGroup>

              <SettingsGroup title="可用現金" accent="#d97706">
                <div className={inputGridClassName}>
                  <Field
                    label="目前手上台幣"
                    value={scenario.basics.startingTwd}
                    onChange={(value) => patchBasics({ startingTwd: value })}
                    suffix="元"
                    disabled={readonlyShared}
                  />
                  <Field
                    label="日幣現金"
                    value={scenario.basics.jpyCash}
                    onChange={(value) =>
                      patchBasics({ jpyCash: Math.max(0, Math.round(n(value))) })
                    }
                    suffix="円"
                    step={1000}
                    min={0}
                    disabled={readonlyShared}
                    labelAdornment={
                      <JpyExchangeRateBadge
                        rate={jpyExchangeRate.rate}
                        fetchedAt={jpyExchangeRate.fetchedAt}
                        source={jpyExchangeRate.source}
                        loading={jpyExchangeRate.loading}
                        error={jpyExchangeRate.error}
                        onRefresh={() => jpyExchangeRate.refresh()}
                        jpyCash={n(scenario.basics.jpyCash)}
                        effectiveTwd={effectiveJpyTwd}
                        legacyTwd={n(scenario.basics.jpyCashTwd)}
                        onMigrateLegacy={() => {
                          const legacy = n(scenario.basics.jpyCashTwd);
                          if (legacy <= 0 || jpyExchangeRate.rate <= 0) return;
                          patchBasics({
                            jpyCash: Math.max(0, Math.round(legacy / jpyExchangeRate.rate)),
                          });
                        }}
                        disabled={readonlyShared}
                      />
                    }
                  />
                </div>
                <div style={styles.switchField}>
                  <div style={styles.switchCopy}>
                    <span style={{ ...styles.label, margin: 0, whiteSpace: "nowrap" }}>
                      把日幣現金算進可用資金
                    </span>
                  </div>
                  <div style={styles.switchControl}>
                    <InteractiveSwitch
                      checked={scenario.basics.includeJpyCash}
                      onChange={(value) => patchBasics({ includeJpyCash: value })}
                      disabled={readonlyShared}
                      ariaLabel="切換是否將日幣現金計入可用資金"
                    />
                  </div>
                </div>
              </SettingsGroup>

              <SettingsGroup title="每月收入" accent="#16a34a">
                <div className={inputGridClassName}>
                  <Field
                    label="每月薪水"
                    value={scenario.basics.monthlySalary}
                    onChange={(value) => patchBasics({ monthlySalary: value })}
                    suffix="元"
                    disabled={readonlyShared}
                  />
                  <MonthPicker
                    label="薪資開始月份"
                    value={scenario.basics.salaryStartsMonth}
                    onChange={(value) => patchBasics({ salaryStartsMonth: value })}
                    baseMonth={scenario.meta.baseMonth}
                    horizon={scenario.basics.monthsToProject}
                    disabled={readonlyShared}
                  />
                  <Field
                    label="每月租屋補助"
                    value={scenario.basics.monthlySubsidy}
                    onChange={(value) => patchBasics({ monthlySubsidy: value })}
                    suffix="元"
                    disabled={readonlyShared}
                  />
                  <MonthPicker
                    label="補貼開始月份"
                    value={scenario.basics.subsidyStartsMonth}
                    onChange={(value) => patchBasics({ subsidyStartsMonth: value })}
                    baseMonth={scenario.meta.baseMonth}
                    horizon={scenario.basics.monthsToProject}
                    disabled={readonlyShared}
                  />
                </div>
              </SettingsGroup>

              <SettingsGroup title="每月固定開銷" accent="#dc2626" last>
                <div className={inputGridClassName}>
                  <Field
                    label="每月房租"
                    value={scenario.basics.monthlyRent}
                    onChange={(value) => patchBasics({ monthlyRent: value })}
                    suffix="元"
                    disabled={readonlyShared}
                  />
                  <Field
                    label="每月生活開銷"
                    value={scenario.basics.monthlyLivingCost}
                    onChange={(value) => patchBasics({ monthlyLivingCost: value })}
                    suffix="元"
                    disabled={readonlyShared}
                  />
                  <Field
                    label="每月學貸還款"
                    value={scenario.basics.monthlyStudentLoan}
                    onChange={(value) => patchBasics({ monthlyStudentLoan: value })}
                    suffix="元"
                    disabled={readonlyShared}
                  />
                </div>
              </SettingsGroup>
            </InteractiveSurface>

            <InteractiveSurface
              as="section"
              style={{ ...styles.card, padding: "12px 18px", marginBottom: "12px" }}
              hoverClassName="flowra-hover-card"
            >
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => setIsOneTimeOpen((value) => !value)}
                  aria-expanded={isOneTimeOpen}
                  style={sectionToggleStyle}
                >
                  <Chevron open={isOneTimeOpen} />
                  <span>單筆收入 / 支出</span>
                  <CountPill count={scenario.oneTimeItems.length} />
                </button>
                <InteractiveButton
                  variant="smallButton"
                  onClick={addOneTimeItem}
                  disabled={readonlyShared}
                  style={iconButtonStyle}
                  title="新增單筆收支"
                  aria-label="新增單筆收支"
                >
                  <PlusIcon />
                </InteractiveButton>
              </div>
              <Collapsible open={isOneTimeOpen}>
                {scenario.oneTimeItems.length === 0 ? (
                  <ListEmptyState
                    icon={
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    }
                    title="還沒有單筆收支"
                    description="把獎金、退稅、年費、紅包等一次性現金流加進來，現金流圖會立刻反映。"
                    actions={[
                      <InteractiveButton
                        key="add"
                        variant="smallButton"
                        onClick={addOneTimeItem}
                        disabled={readonlyShared}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                          <PlusIcon />
                          立即新增第一筆
                        </span>
                      </InteractiveButton>,
                    ]}
                  />
                ) : (
                  <div
                    style={listScrollContainerStyle(
                      !isExporting && scenario.oneTimeItems.length > LIST_SCROLL_THRESHOLD,
                    )}
                  >
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleOneTimeDragEnd}
                    >
                      <SortableContext
                        items={scenario.oneTimeItems.map((item) => item.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {scenario.oneTimeItems.map((item) => {
                          const itemIsOpen = Boolean(openOneTimeItemIds[item.id]);
                          const isIncome = item.type === "income";
                          const accent = isIncome ? "#16a34a" : "#dc2626";
                          const categoryMeta = CATEGORY_META[item.category] || CATEGORY_META.other;
                          const chipColor = isIncome ? "#15803d" : categoryMeta.color;
                          return (
                            <SortableItemShell key={item.id} id={item.id}>
                              <div
                                style={{
                                  ...styles.item,
                                  borderLeft: `4px solid ${accent}`,
                                  padding: "10px 12px",
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setOpenOneTimeItemIds((current) => ({
                                        ...current,
                                        [item.id]: !current[item.id],
                                      }))
                                    }
                                    aria-expanded={itemIsOpen}
                                    style={itemToggleStyle}
                                  >
                                    <Chevron open={itemIsOpen} />
                                    <div
                                      style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "2px",
                                        minWidth: 0,
                                        flex: 1,
                                      }}
                                    >
                                      <span
                                        style={{
                                          fontWeight: 800,
                                          color: "#0f172a",
                                          overflow: "hidden",
                                          textOverflow: "ellipsis",
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        {item.name}
                                      </span>
                                      <span
                                        style={{
                                          fontSize: "12px",
                                          color: "#475569",
                                          display: "flex",
                                          alignItems: "center",
                                          flexWrap: "wrap",
                                          gap: "6px",
                                        }}
                                      >
                                        <span style={{ fontWeight: 800, color: accent }}>
                                          {isIncome ? "+" : "−"}
                                          {maskCurrency(item.amount, hiddenAmounts)}
                                        </span>
                                        <span style={{ color: "#cbd5e1" }}>·</span>
                                        <span>{formatMonthLabel(item.month, true)}</span>
                                        <span style={{ color: "#cbd5e1" }}>·</span>
                                        <span
                                          style={{
                                            ...styles.chip,
                                            padding: "1px 8px",
                                            fontSize: "11px",
                                            color: chipColor,
                                            borderColor: `${chipColor}33`,
                                            background: `${chipColor}10`,
                                          }}
                                        >
                                          {isIncome ? "收入" : categoryMeta.label}
                                        </span>
                                      </span>
                                    </div>
                                  </button>
                                  <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                                    <InteractiveButton
                                      variant="tinyButton"
                                      onClick={() => duplicateOneTimeItem(item.id)}
                                      disabled={readonlyShared}
                                      style={{
                                        padding: "6px",
                                        borderRadius: "10px",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                      }}
                                      title="複製"
                                      aria-label="複製"
                                    >
                                      <CopyIcon />
                                    </InteractiveButton>
                                    <InteractiveButton
                                      variant="dangerButton"
                                      onClick={() => removeOneTimeItem(item.id)}
                                      disabled={readonlyShared}
                                      style={{
                                        padding: "6px",
                                        borderRadius: "10px",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                      }}
                                      title="刪除"
                                      aria-label="刪除"
                                    >
                                      <TrashIcon />
                                    </InteractiveButton>
                                  </div>
                                </div>
                                <Collapsible open={itemIsOpen}>
                                  <div
                                    style={{
                                      paddingTop: "12px",
                                      borderTop: "1px dashed #e2e8f0",
                                    }}
                                  >
                                    <TextField
                                      label="項目名稱"
                                      value={item.name}
                                      onChange={(value) =>
                                        updateOneTimeItem(item.id, { name: value })
                                      }
                                      disabled={readonlyShared}
                                    />
                                    <div className={`${inputGridClassName} mt-2.5`}>
                                      <Field
                                        label="金額"
                                        value={item.amount}
                                        onChange={(value) =>
                                          updateOneTimeItem(item.id, { amount: value })
                                        }
                                        step={1000}
                                        disabled={readonlyShared}
                                      />
                                      <MonthPicker
                                        label="月份"
                                        value={item.month}
                                        onChange={(value) =>
                                          updateOneTimeItem(item.id, { month: value })
                                        }
                                        baseMonth={scenario.meta.baseMonth}
                                        horizon={scenario.basics.monthsToProject}
                                        disabled={readonlyShared}
                                      />
                                      <div>
                                        <label style={styles.label}>類型</label>
                                        <InteractiveSelect
                                          value={item.type}
                                          disabled={readonlyShared}
                                          onChange={(event) =>
                                            updateOneTimeItem(item.id, {
                                              type: event.target.value,
                                            })
                                          }
                                        >
                                          <option value="income">收入</option>
                                          <option value="expense">支出</option>
                                        </InteractiveSelect>
                                      </div>
                                      <div>
                                        <label style={styles.label}>分類</label>
                                        <InteractiveSelect
                                          value={item.category}
                                          disabled={readonlyShared}
                                          onChange={(event) =>
                                            updateOneTimeItem(item.id, {
                                              category: event.target.value,
                                            })
                                          }
                                        >
                                          {CATEGORY_OPTIONS.map((key) => (
                                            <option key={key} value={key}>
                                              {CATEGORY_META[key].label}
                                            </option>
                                          ))}
                                        </InteractiveSelect>
                                      </div>
                                    </div>
                                  </div>
                                </Collapsible>
                              </div>
                            </SortableItemShell>
                          );
                        })}
                      </SortableContext>
                    </DndContext>
                  </div>
                )}
              </Collapsible>
            </InteractiveSurface>

            <InteractiveSurface
              as="section"
              style={{ ...styles.card, padding: "12px 18px", marginBottom: "12px" }}
              hoverClassName="flowra-hover-card"
            >
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => setIsInstallmentsOpen((value) => !value)}
                  aria-expanded={isInstallmentsOpen}
                  style={sectionToggleStyle}
                >
                  <Chevron open={isInstallmentsOpen} />
                  <span>分期付款</span>
                  <CountPill count={editableInstallments.length} />
                </button>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <InteractiveButton
                    variant="smallButton"
                    onClick={() => setIsBulkImportOpen((value) => !value)}
                    disabled={readonlyShared}
                    style={iconButtonStyle}
                    title="批次匯入分期"
                    aria-label="批次匯入分期"
                  >
                    <UploadIcon />
                  </InteractiveButton>
                  <InteractiveButton
                    variant="smallButton"
                    onClick={addInstallment}
                    disabled={readonlyShared}
                    style={iconButtonStyle}
                    title="新增分期"
                    aria-label="新增分期"
                  >
                    <PlusIcon />
                  </InteractiveButton>
                </div>
              </div>
              <Collapsible open={isInstallmentsOpen}>
                {editableInstallments.length === 0 ? (
                  <ListEmptyState
                    icon={
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="3" y="6" width="18" height="13" rx="2" />
                        <path d="M3 10h18M7 15h4" />
                      </svg>
                    }
                    title="還沒有分期付款"
                    description="新增信用卡分期、貸款或訂閱付款，未來月份的支出會自動納入預測。"
                    actions={[
                      <InteractiveButton
                        key="add"
                        variant="smallButton"
                        onClick={addInstallment}
                        disabled={readonlyShared}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                          <PlusIcon />
                          新增分期
                        </span>
                      </InteractiveButton>,
                      <InteractiveButton
                        key="bulk"
                        variant="smallButton"
                        onClick={() => setIsBulkImportOpen(true)}
                        disabled={readonlyShared}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                          <UploadIcon />
                          批次匯入
                        </span>
                      </InteractiveButton>,
                    ]}
                  />
                ) : (
                  <div
                    style={listScrollContainerStyle(
                      !isExporting && editableInstallments.length > LIST_SCROLL_THRESHOLD,
                    )}
                  >
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleInstallmentDragEnd}
                    >
                      <SortableContext
                        items={editableInstallments.map((item) => item.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {editableInstallments.map((item) => {
                          const itemIsOpen = Boolean(openInstallmentItemIds[item.id]);
                          const endMonth = addMonths(item.startMonth, item.terms - 1);
                          return (
                            <SortableItemShell key={item.id} id={item.id}>
                              <div
                                style={{
                                  ...styles.item,
                                  borderLeft: "4px solid #0284c7",
                                  padding: "10px 12px",
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setOpenInstallmentItemIds((current) => ({
                                        ...current,
                                        [item.id]: !current[item.id],
                                      }))
                                    }
                                    aria-expanded={itemIsOpen}
                                    style={itemToggleStyle}
                                  >
                                    <Chevron open={itemIsOpen} />
                                    <div
                                      style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "2px",
                                        minWidth: 0,
                                        flex: 1,
                                      }}
                                    >
                                      <span
                                        style={{
                                          fontWeight: 800,
                                          color: "#0f172a",
                                          overflow: "hidden",
                                          textOverflow: "ellipsis",
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        {item.name}
                                      </span>
                                      <span
                                        style={{
                                          fontSize: "12px",
                                          color: "#475569",
                                          display: "flex",
                                          alignItems: "center",
                                          flexWrap: "wrap",
                                          gap: "6px",
                                        }}
                                      >
                                        <span style={{ fontWeight: 800, color: "#0284c7" }}>
                                          月付 {maskCurrency(item.payment, hiddenAmounts)}
                                        </span>
                                        <span style={{ color: "#cbd5e1" }}>·</span>
                                        <span>{item.terms} 期</span>
                                        <span style={{ color: "#cbd5e1" }}>·</span>
                                        <span>
                                          {formatMonthLabel(item.startMonth, true)} →{" "}
                                          {formatMonthLabel(endMonth, true)}
                                        </span>
                                      </span>
                                    </div>
                                  </button>
                                  <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                                    <InteractiveButton
                                      variant="tinyButton"
                                      onClick={() => duplicateInstallment(item.id)}
                                      disabled={readonlyShared}
                                      style={{
                                        padding: "6px",
                                        borderRadius: "10px",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                      }}
                                      title="複製"
                                      aria-label="複製"
                                    >
                                      <CopyIcon />
                                    </InteractiveButton>
                                    <InteractiveButton
                                      variant="dangerButton"
                                      onClick={() => removeInstallment(item.id)}
                                      disabled={readonlyShared}
                                      style={{
                                        padding: "6px",
                                        borderRadius: "10px",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                      }}
                                      title="刪除"
                                      aria-label="刪除"
                                    >
                                      <TrashIcon />
                                    </InteractiveButton>
                                  </div>
                                </div>
                                <Collapsible open={itemIsOpen}>
                                  <div
                                    style={{
                                      paddingTop: "12px",
                                      borderTop: "1px dashed #e2e8f0",
                                    }}
                                  >
                                    <TextField
                                      label="項目名稱"
                                      value={item.name}
                                      onChange={(value) =>
                                        updateInstallment(item.id, { name: value })
                                      }
                                      disabled={readonlyShared}
                                    />
                                    <div className={`${inputGridClassName} mt-2.5`}>
                                      <Field
                                        label="本金"
                                        value={item.principal}
                                        onChange={(value) =>
                                          updateInstallment(item.id, { principal: value })
                                        }
                                        disabled={readonlyShared}
                                      />
                                      <Field
                                        label="年百分率 APR"
                                        value={item.apr}
                                        onChange={(value) =>
                                          updateInstallment(item.id, { apr: value })
                                        }
                                        suffix="%"
                                        step={0.1}
                                        precision={1}
                                        min={0}
                                        disabled={readonlyShared}
                                      />
                                      <Field
                                        label="期數"
                                        value={item.terms}
                                        onChange={(value) =>
                                          updateInstallment(item.id, {
                                            terms: Math.max(1, Math.round(value)),
                                          })
                                        }
                                        step={1}
                                        min={1}
                                        disabled={readonlyShared}
                                      />
                                      <MonthPicker
                                        label="開始月份"
                                        value={item.startMonth}
                                        onChange={(value) =>
                                          updateInstallment(item.id, { startMonth: value })
                                        }
                                        baseMonth={scenario.meta.baseMonth}
                                        horizon={scenario.basics.monthsToProject}
                                        disabled={readonlyShared}
                                      />
                                    </div>
                                    <div style={{ ...styles.mutedBox, ...styles.miniGrid }}>
                                      <div>
                                        <div style={styles.statLabel}>月付</div>
                                        <strong>{maskCurrency(item.payment, hiddenAmounts)}</strong>
                                      </div>
                                      <div>
                                        <div style={styles.statLabel}>總繳</div>
                                        <strong>
                                          {maskCurrency(item.totalPaid, hiddenAmounts)}
                                        </strong>
                                      </div>
                                      <div>
                                        <div style={styles.statLabel}>利息</div>
                                        <strong>
                                          {maskCurrency(item.interest, hiddenAmounts)}
                                        </strong>
                                      </div>
                                    </div>
                                  </div>
                                </Collapsible>
                              </div>
                            </SortableItemShell>
                          );
                        })}
                      </SortableContext>
                    </DndContext>
                  </div>
                )}
              </Collapsible>
            </InteractiveSurface>

            <InteractiveSurface as="section" style={styles.card} hoverClassName="flowra-hover-card">
              <h2 style={styles.cardTitle}>資料管理</h2>
              <div
                style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "flex-start" }}
              >
                {DATA_MANAGEMENT_ACTIONS.map((action) => {
                  if (action.key === "syncBackup") {
                    return (
                      <InteractiveButton
                        key={action.key}
                        onClick={() => syncScenarioToCloud()}
                        disabled={!cloudFeaturesEnabled}
                        style={iconButtonStyle}
                        title={action.label}
                        aria-label={action.label}
                      >
                        <CloudUploadIcon />
                      </InteractiveButton>
                    );
                  }
                  if (action.key === "importData") {
                    return (
                      <InteractiveButton
                        key={action.key}
                        onClick={() => fileInputRef.current?.click()}
                        style={iconButtonStyle}
                        title={action.label}
                        aria-label={action.label}
                      >
                        <UploadIcon size={16} />
                      </InteractiveButton>
                    );
                  }
                  if (action.key === "restoreBackup") {
                    return (
                      <InteractiveButton
                        key={action.key}
                        onClick={() => refreshCloudBackup({ applyPayload: true })}
                        disabled={!cloudFeaturesEnabled || isCloudBackupLoading}
                        style={iconButtonStyle}
                        title={isCloudBackupLoading ? "還原中..." : action.label}
                        aria-label={isCloudBackupLoading ? "還原中..." : action.label}
                      >
                        <CloudDownloadIcon />
                      </InteractiveButton>
                    );
                  }
                  if (action.key === "exportData") {
                    return (
                      <div key={action.key} ref={exportTriggerRef} style={{ position: "relative" }}>
                        <InteractiveButton
                          onClick={() => setIsExportMenuOpen((value) => !value)}
                          aria-expanded={isExportMenuOpen}
                          style={iconButtonStyle}
                          title={action.label}
                          aria-label={action.label}
                        >
                          <DownloadIcon size={16} />
                        </InteractiveButton>
                        {isExportMenuOpen && typeof document !== "undefined"
                          ? createPortal(
                              <FloatingSurface
                                data-export-menu="true"
                                style={{
                                  ...styles.dropdownMenu,
                                  position: "fixed",
                                  top: exportMenuCoords.top,
                                  right: exportMenuCoords.right,
                                  zIndex: 1000,
                                }}
                                motionClassName="flowra-surface-enter"
                              >
                                <InteractiveButton
                                  variant="dropdownItem"
                                  onClick={() => {
                                    setIsExportMenuOpen(false);
                                    exportPng();
                                  }}
                                >
                                  下載整頁圖片
                                </InteractiveButton>
                                <InteractiveButton
                                  variant="dropdownItem"
                                  onClick={() => {
                                    setIsExportMenuOpen(false);
                                    exportPdf();
                                  }}
                                >
                                  下載報表
                                </InteractiveButton>
                                <InteractiveButton
                                  variant="dropdownItem"
                                  onClick={() => {
                                    setIsExportMenuOpen(false);
                                    exportExcel();
                                  }}
                                >
                                  下載表格檔
                                </InteractiveButton>
                                <InteractiveButton
                                  variant="dropdownItem"
                                  onClick={() => {
                                    setIsExportMenuOpen(false);
                                    exportJson();
                                  }}
                                >
                                  下載完整資料
                                </InteractiveButton>
                                <InteractiveButton
                                  variant="dropdownItem"
                                  onClick={() => {
                                    setIsExportMenuOpen(false);
                                    printReport();
                                  }}
                                >
                                  列印
                                </InteractiveButton>
                              </FloatingSurface>,
                              document.body,
                            )
                          : null}
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                onChange={importJson}
                style={{ display: "none" }}
              />
              <div style={{ ...styles.mutedBox, marginTop: "12px" }}>
                <div
                  style={{
                    ...styles.metaText,
                    margin: 0,
                    color: cloudStatusIsWarning ? "#b45309" : "#475569",
                  }}
                >
                  雲端備份：{cloudStatusLine}
                </div>
                {cloudNotice ? (
                  <div style={{ ...styles.metaText, marginTop: "6px", color: "#dc2626" }}>
                    {cloudNotice}
                  </div>
                ) : null}
                <div
                  style={{
                    marginTop: "12px",
                    padding: "8px 14px",
                    borderRadius: "14px",
                    border: "1px solid #e2e8f0",
                    background: "#ffffff",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "10px",
                      marginBottom: cloudAuthState === "authenticated" ? 0 : "10px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ color: "#94a3b8", flexShrink: 0 }}
                        aria-hidden="true"
                      >
                        <circle cx="8" cy="6" r="2.6" />
                        <path d="M2.5 13.5 C3.5 10.8 5.6 9.6 8 9.6 C10.4 9.6 12.5 10.8 13.5 13.5" />
                      </svg>
                      <span
                        style={{
                          fontSize: "13px",
                          fontWeight: 700,
                          color: "#0f172a",
                          flexShrink: 0,
                        }}
                      >
                        帳號
                      </span>
                      <span
                        style={{
                          fontSize: "12px",
                          color: cloudAuthState === "authenticated" ? "#475569" : "#94a3b8",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          minWidth: 0,
                        }}
                      >
                        {cloudAuthState === "authenticated"
                          ? cloudUserEmail || "已登入"
                          : cloudAuthState === "checking"
                            ? "確認中…"
                            : "尚未登入"}
                      </span>
                      {isDevMode ? (
                        <span
                          style={{
                            fontSize: "11px",
                            lineHeight: 1,
                            padding: "4px 6px",
                            borderRadius: "999px",
                            background: "#e0f2fe",
                            color: "#0369a1",
                            border: "1px solid #bae6fd",
                            flexShrink: 0,
                          }}
                        >
                          開發者模式
                        </span>
                      ) : null}
                    </div>
                    {cloudAuthState === "authenticated" && !isDevMode ? (
                      <InteractiveButton
                        variant="smallButton"
                        onClick={signOutFromSupabase}
                        style={{ flexShrink: 0 }}
                      >
                        登出
                      </InteractiveButton>
                    ) : null}
                  </div>
                  {cloudAuthState === "authenticated" ? (
                    isDevMode ? (
                      <div style={{ ...styles.metaText, fontSize: "12px", margin: "10px 0 0" }}>
                        開發者模式已啟用，雲端備份與 AI 輔助分析會使用本機 mock 資料。
                      </div>
                    ) : null
                  ) : (
                    <>
                      <div style={{ ...styles.metaText, fontSize: "12px", margin: "0 0 8px" }}>
                        使用 Google 帳號登入後即可同步雲端備份。
                      </div>
                      <InteractiveButton
                        variant="smallButton"
                        onClick={signInWithGoogleHandler}
                        disabled={!supabaseReady || isSigningInWithGoogle}
                        style={{
                          width: "100%",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "8px",
                          padding: "10px 14px",
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
                          <path
                            fill="#4285F4"
                            d="M17.64 9.2a10.3 10.3 0 0 0-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.79 2.71v2.26h2.9c1.7-1.56 2.69-3.87 2.69-6.61z"
                          />
                          <path
                            fill="#34A853"
                            d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.95v2.33A9 9 0 0 0 9 18z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M3.97 10.71A5.42 5.42 0 0 1 3.68 9c0-.59.1-1.17.29-1.71V4.96H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.04l3.02-2.33z"
                          />
                          <path
                            fill="#EA4335"
                            d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .95 4.96L3.97 7.3C4.68 5.16 6.66 3.58 9 3.58z"
                          />
                        </svg>
                        {isSigningInWithGoogle ? "前往登入…" : "使用 Google 帳號登入"}
                      </InteractiveButton>
                    </>
                  )}
                </div>
              </div>
            </InteractiveSurface>
          </div>

          <div>
            <InteractiveSurface
              as="section"
              style={{ ...styles.card, position: "relative" }}
              hoverClassName="flowra-hover-card"
              className="flowra-print-card"
              ref={trendChartRef}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "12px",
                  alignItems: "center",
                  marginBottom: "8px",
                }}
              >
                <h2 style={styles.cardTitle}>每月剩餘現金變化</h2>
                <InteractiveButton
                  variant="smallButton"
                  onClick={() => exportChartPng(trendChartRef, "cash-trend")}
                  className="flowra-no-print"
                  style={{
                    padding: "8px",
                    borderRadius: "10px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  title="下載圖片"
                  aria-label="下載圖片"
                >
                  <DownloadIcon />
                </InteractiveButton>
              </div>
              <CashTrendChart
                rows={rows}
                reserveLine={reserveTarget(scenario)}
                selectedMonthKey={selectedMonthKey}
                onSelectMonth={setUserSelectedMonthKey}
              />
            </InteractiveSurface>

            <InteractiveSurface
              as="section"
              style={{ ...styles.card, position: "relative" }}
              hoverClassName="flowra-hover-card"
              className="flowra-print-card"
              ref={incomeChartRef}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "12px",
                  alignItems: "center",
                  marginBottom: "8px",
                }}
              >
                <h2 style={styles.cardTitle}>每月收支比較</h2>
                <InteractiveButton
                  variant="smallButton"
                  onClick={() => exportChartPng(incomeChartRef, "income-expense")}
                  className="flowra-no-print"
                  style={{
                    padding: "8px",
                    borderRadius: "10px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  title="下載圖片"
                  aria-label="下載圖片"
                >
                  <DownloadIcon />
                </InteractiveButton>
              </div>
              <IncomeExpenseChart
                rows={rows}
                onSelectMonth={focusCompositionMonth}
                selectedMonthKey={selectedMonthKey}
              />
            </InteractiveSurface>

            <InteractiveSurface
              as="section"
              style={{ ...styles.card, position: "relative" }}
              hoverClassName="flowra-hover-card"
              className="flowra-print-card"
              ref={compositionChartRef}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "12px",
                  alignItems: "center",
                  marginBottom: "8px",
                }}
              >
                <h2 style={styles.cardTitle}>支出組成變化</h2>
                <InteractiveButton
                  variant="smallButton"
                  onClick={() => exportChartPng(compositionChartRef, "expense-composition")}
                  className="flowra-no-print"
                  style={{
                    padding: "8px",
                    borderRadius: "10px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  title="下載圖片"
                  aria-label="下載圖片"
                >
                  <DownloadIcon />
                </InteractiveButton>
              </div>
              <ExpenseCompositionChart
                rows={rows}
                mode={expenseMode}
                view={expenseView}
                setMode={setExpenseMode}
                setView={setExpenseView}
                selectedMonthKey={selectedMonthKey}
                hidden={hiddenAmounts}
              />
            </InteractiveSurface>
          </div>
        </div>

        <InteractiveSurface
          as="section"
          style={{ ...styles.card, position: "relative", marginTop: "20px" }}
          hoverClassName="flowra-hover-card"
          className="flowra-print-card"
          ref={monthDetailRef}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "12px",
              alignItems: "center",
              marginBottom: "8px",
            }}
          >
            <h2 style={styles.cardTitle}>每月明細</h2>
            <InteractiveButton
              variant="smallButton"
              onClick={() => exportChartPng(monthDetailRef, "month-detail")}
              className="flowra-no-print"
              style={{
                padding: "8px",
                borderRadius: "10px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              title="下載圖片"
              aria-label="下載圖片"
            >
              <DownloadIcon />
            </InteractiveButton>
          </div>
          <MonthDetailTable
            rows={rows}
            selectedMonthKey={selectedMonthKey}
            hidden={hiddenAmounts}
            mobile={mobile}
            monthRefs={monthRefs}
            readonly={readonlyShared}
          />
        </InteractiveSurface>
        {isBulkImportOpen ? (
          <div
            style={styles.modalBackdrop}
            className="flowra-no-print"
            onClick={() => setIsBulkImportOpen(false)}
          >
            <FloatingSurface
              style={styles.modalCard}
              motionClassName="flowra-surface-enter"
              onClick={(event) => event.stopPropagation()}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "12px",
                  alignItems: "center",
                  marginBottom: "12px",
                }}
              >
                <div>
                  <h2 style={styles.cardTitle}>批次匯入分期</h2>
                  <p style={styles.metaText}>一行一筆：名稱, 本金, 利率, 期數, 起始月</p>
                </div>
                <InteractiveButton onClick={() => setIsBulkImportOpen(false)}>
                  關閉
                </InteractiveButton>
              </div>
              <InteractiveTextarea
                value={bulkInstallmentText}
                disabled={readonlyShared}
                onChange={(event) => setBulkInstallmentText(event.target.value)}
                placeholder={"iPhone 分期, 36000, 10, 12, 2026-06\n旅費分期, 12000, 0, 4, 下個月"}
                style={{ minHeight: "180px", paddingTop: "10px", resize: "vertical" }}
              />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "8px",
                  alignItems: "center",
                  marginTop: "10px",
                  flexWrap: "wrap",
                }}
              >
                <span style={styles.metaText}>
                  支援 `YYYY-MM`、`下個月`、`再下個月`。解析失敗會保留原文方便修正。
                </span>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <InteractiveButton onClick={previewBulkInstallments} disabled={readonlyShared}>
                    預覽解析
                  </InteractiveButton>
                  <InteractiveButton
                    onClick={importBulkInstallments}
                    disabled={
                      readonlyShared ||
                      bulkInstallmentPreview.length === 0 ||
                      bulkInstallmentErrors.length > 0
                    }
                  >
                    確認匯入
                  </InteractiveButton>
                </div>
              </div>
              {bulkInstallmentPreview.length ? (
                <div style={{ ...styles.mutedBox, marginTop: "12px" }}>
                  <div style={{ ...styles.label, marginBottom: "8px" }}>
                    預覽通過 {bulkInstallmentPreview.length} 筆
                  </div>
                  <div
                    style={{ display: "grid", gap: "8px", maxHeight: "180px", overflow: "auto" }}
                  >
                    {bulkInstallmentPreview.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "12px",
                          fontSize: "12px",
                          color: "#334155",
                        }}
                      >
                        <span>{item.name}</span>
                        <span>
                          {currency(item.principal)} / {item.apr}% / {item.terms} 期 /{" "}
                          {item.startMonth}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {bulkInstallmentErrors.length ? (
                <div style={{ marginTop: "12px" }} data-testid="bulk-installment-errors">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      marginBottom: "8px",
                      color: "#be123c",
                      fontSize: "12px",
                      fontWeight: 700,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: "16px",
                        height: "16px",
                        borderRadius: "999px",
                        background: "#fecdd3",
                        color: "#9f1239",
                        display: "grid",
                        placeItems: "center",
                        fontSize: "11px",
                      }}
                    >
                      !
                    </span>
                    解析失敗 {bulkInstallmentErrors.length} 筆（解決後才能匯入）
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gap: "8px",
                      maxHeight: "220px",
                      overflow: "auto",
                    }}
                  >
                    {bulkInstallmentErrors.map((error) => (
                      <div
                        key={`${error.lineNumber}-${error.line}`}
                        style={{
                          borderRadius: "12px",
                          background: "#fff1f2",
                          border: "1px solid #fecdd3",
                          padding: "10px 12px",
                          color: "#be123c",
                          fontSize: "12px",
                          display: "grid",
                          gap: "6px",
                        }}
                        role="alert"
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              minWidth: "44px",
                              padding: "2px 8px",
                              borderRadius: "999px",
                              background: "#be123c",
                              color: "#fff",
                              fontWeight: 700,
                              fontSize: "11px",
                            }}
                          >
                            第 {error.lineNumber} 行
                          </span>
                          <span style={{ color: "#9f1239" }}>{error.message}</span>
                        </div>
                        <code
                          style={{
                            display: "block",
                            background: "#ffe4e6",
                            color: "#881337",
                            padding: "6px 8px",
                            borderRadius: "8px",
                            fontFamily: "ui-monospace, SFMono-Regular, monospace",
                            fontSize: "11px",
                            wordBreak: "break-all",
                          }}
                        >
                          {error.line}
                        </code>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </FloatingSurface>
          </div>
        ) : null}

        {importPreview ? (
          <div
            style={styles.modalBackdrop}
            className="flowra-no-print"
            onClick={() => setImportPreview(null)}
          >
            <FloatingSurface
              style={styles.modalCard}
              motionClassName="flowra-surface-enter"
              onClick={(event) => event.stopPropagation()}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "12px",
                  alignItems: "flex-start",
                  marginBottom: "12px",
                }}
              >
                <div>
                  <h2 style={styles.cardTitle}>匯入資料預覽</h2>
                  <p style={styles.metaText}>
                    來源檔案：{importPreview.fileName || "—"}
                    {importPreview.mode === "legacy" ? "（舊版資料，將自動升級）" : ""}
                  </p>
                </div>
                <InteractiveButton onClick={() => setImportPreview(null)}>關閉</InteractiveButton>
              </div>

              {importPreview.status === "error" ? (
                <div style={{ ...styles.alert, marginBottom: 0 }}>
                  <strong>無法匯入</strong>
                  <div>{importPreview.message}</div>
                </div>
              ) : (
                <>
                  <div
                    style={{
                      ...styles.mutedBox,
                      marginTop: 0,
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: "10px 16px",
                      fontSize: "13px",
                    }}
                  >
                    {importPreviewDiff.basics.map((row) => (
                      <div
                        key={row.key}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "2px",
                          padding: "6px 8px",
                          borderRadius: "8px",
                          background: row.changed ? "#fef9c3" : "transparent",
                        }}
                      >
                        <span style={{ fontSize: "11px", color: "#64748b" }}>{row.label}</span>
                        <span
                          style={{
                            fontSize: "13px",
                            fontWeight: 700,
                            color: "#0f172a",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {currency(row.incoming)} {row.suffix}
                        </span>
                        {row.changed ? (
                          <span style={{ fontSize: "11px", color: "#92400e" }}>
                            （目前 {currency(row.current)}）
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "12px",
                      marginTop: "12px",
                      fontSize: "13px",
                      color: "#475569",
                    }}
                  >
                    <span>
                      一次收支：{importPreviewDiff.oneTime.incoming} 筆 ／ 分期：
                      {importPreviewDiff.installments.incoming} 筆
                    </span>
                    <span>
                      （目前 {importPreviewDiff.oneTime.current} ／{" "}
                      {importPreviewDiff.installments.current}）
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: "16px",
                      display: "flex",
                      gap: "8px",
                      justifyContent: "flex-end",
                    }}
                  >
                    <InteractiveButton onClick={() => setImportPreview(null)}>
                      取消
                    </InteractiveButton>
                    <InteractiveButton variant="activePill" onClick={confirmImport}>
                      確認取代
                    </InteractiveButton>
                  </div>
                  <p
                    style={{
                      ...styles.metaText,
                      marginTop: "10px",
                      marginBottom: 0,
                      fontSize: "11px",
                    }}
                  >
                    {getImportReplaceNotice()}
                  </p>
                </>
              )}
            </FloatingSurface>
          </div>
        ) : null}
      </div>
      {!aiOpen && !compareB ? (
        <InteractiveButton
          data-testid="ai-trigger"
          variant="floatingAiButton"
          onClick={() => setAiOpen(true)}
          disabled={!cloudFeaturesEnabled}
          title={aiDisabledReason}
          aria-label={cloudFeaturesEnabled ? "開啟 AI 輔助分析" : aiDisabledReason}
        >
          <span aria-hidden="true" style={{ display: "inline-flex", color: "#2563eb" }}>
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3.5" y="5" width="6.5" height="13" rx="2" />
              <rect x="14" y="5" width="6.5" height="13" rx="2" />
              <path d="M7 9.5h0.01" />
              <path d="M17.25 9.5h0.01" />
              <path d="M6.2 14c1-.9 1.95-1.35 2.8-1.35 0.84 0 1.64.3 2.4.9" />
              <path d="M12.6 13.55c.74-.6 1.54-.9 2.4-.9.84 0 1.8.45 2.8 1.35" />
            </svg>
          </span>
        </InteractiveButton>
      ) : null}
      <AIScenarioChat
        open={aiOpen}
        onClose={handleAiClose}
        history={aiHistory}
        loading={aiLoading}
        draftMessage={aiDraftMessage}
        proposal={aiProposal}
        error={aiError}
        quota={aiQuota}
        onSend={handleAiSend}
        onApply={handleAiApply}
        onDiscardProposal={handleAiDiscard}
        onNewChat={handleAiNewChat}
        onStop={handleAiStop}
        disabled={!cloudFeaturesEnabled}
        disabledReason={aiDisabledReason}
      />
      {compareB && (
        <ScenarioCompareView
          rowsA={rows}
          rowsB={compareB.rows}
          proposalSummary={compareB.summary}
          onAdopt={handleAdoptB}
          onLeave={handleLeaveCompare}
        />
      )}
      <UndoSnackbar
        items={snackbar.items}
        onTrigger={snackbar.trigger}
        onDismiss={snackbar.dismiss}
      />
      <KeyboardShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
