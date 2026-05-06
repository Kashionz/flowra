import React, { useEffect, useMemo, useRef, useState } from "react";
import "./styles/flowra.css";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CHART_COLORS, CHART_THEME_VARS, ChartSurface, ChartTooltip, ChartTooltipCard } from "./components/ui/chart.jsx";
import { TEMPLATE_DEFINITIONS } from "./lib/templates/index.js";
import {
  checkFlowraCloudSetup,
  createFlowraSupabaseClient,
  getLatestCloudBackup,
  getCurrentSupabaseUser,
  getSupabaseConfigHint,
  isSupabaseConfigured,
  sendSupabaseMagicLink,
  signOutSupabase,
  upsertCloudBackup,
} from "./lib/flowraSupabase.js";
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
const DEFAULT_TEMPLATE_KEY = "current";
const LEGACY_SCENARIO_NAME = "有房貸租屋族";
const RENAMED_SCENARIO_NAME = "目前情境";
const STORAGE_SESSION_META_KEY = "flowra.cashflow.session-meta";
const SESSION_META_DEFAULT = {
  lastOpenedAt: "",
  lastSyncedAt: "",
  lastSyncAttemptAt: "",
};
const CATEGORY_META = {
  medical: { label: "醫療", color: "#dc2626" },
  travel: { label: "旅遊", color: "#0284c7" },
  gift: { label: "禮金", color: "#d946ef" },
  tax: { label: "稅務", color: "#ea580c" },
  tech: { label: "3C", color: "#7c3aed" },
  social: { label: "社交", color: "#0891b2" },
  other: { label: "其他", color: "#64748b" },
};
const CATEGORY_OPTIONS = Object.keys(CATEGORY_META);
let nextId = 1;
function makeId(prefix = "id") {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function currency(value) {
  return Math.round(n(value)).toLocaleString("zh-TW");
}

function clampMonthIndex(value) {
  return Math.max(0, Math.round(n(value)));
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function currentBaseMonth() {
  const today = new Date();
  return `${today.getFullYear()}-${pad2(today.getMonth() + 1)}`;
}

function exportFileBase(baseMonth) {
  return `flowra-report-${baseMonth}`;
}

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

function parseYearMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ""));
  if (!match) {
    return { year: 2026, month: 5 };
  }
  const year = Number(match[1]);
  const month = Math.min(12, Math.max(1, Number(match[2])));
  return { year, month };
}

function formatYearMonth(year, month) {
  return `${year}-${pad2(month)}`;
}

function addMonths(baseMonth, offset) {
  const { year, month } = parseYearMonth(baseMonth);
  const date = new Date(year, month - 1 + Math.round(n(offset)), 1);
  return formatYearMonth(date.getFullYear(), date.getMonth() + 1);
}

function diffMonths(baseMonth, targetMonth) {
  const a = parseYearMonth(baseMonth);
  const b = parseYearMonth(targetMonth);
  return (b.year - a.year) * 12 + (b.month - a.month);
}

function formatMonthLabel(monthKey, short = false) {
  const { year, month } = parseYearMonth(monthKey);
  return short ? `${month}月` : `${year}年${month}月`;
}

function monthlyPayment(principal, aprPercent, terms) {
  const p = Math.max(0, n(principal));
  const months = Math.max(1, Math.round(n(terms)));
  const monthlyRate = n(aprPercent) / 100 / 12;
  if (monthlyRate === 0) return p / months;
  return (p * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
}

function createTemplateScenario(templateKey = DEFAULT_TEMPLATE_KEY) {
  const baseMonth = currentBaseMonth();
  const template = TEMPLATE_DEFINITIONS[templateKey] || TEMPLATE_DEFINITIONS[DEFAULT_TEMPLATE_KEY];
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
      jpyCashTwd: template.basics.jpyCashTwd,
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
      id: makeId("one-time"),
      name: item.name,
      amount: item.amount,
      month: addMonths(baseMonth, item.monthOffset),
      type: item.type,
      category: item.category,
    })),
    installments: template.installments.map((item) => ({
      id: makeId("installment"),
      name: item.name,
      principal: item.principal,
      apr: item.apr,
      terms: item.terms,
      startMonth: addMonths(baseMonth, item.startOffset),
    })),
  };
}

function createDefaultScenario() {
  return createTemplateScenario(DEFAULT_TEMPLATE_KEY);
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
        template.meta
      ),
      basics: {
        ...template.basics,
        ...(raw.basics || {}),
      },
      oneTimeItems: Array.isArray(raw.oneTimeItems)
        ? raw.oneTimeItems.map((item) => ({
            id: item.id || makeId("one-time"),
            name: item.name || "未命名項目",
            amount: n(item.amount),
            month: item.month || addMonths(raw.meta?.baseMonth || template.meta.baseMonth, 0),
            type: item.type === "income" ? "income" : "expense",
            category: CATEGORY_OPTIONS.includes(item.category) ? item.category : "other",
          }))
        : [],
      installments: Array.isArray(raw.installments)
        ? raw.installments.map((item) => ({
            id: item.id || makeId("installment"),
            name: item.name || "未命名分期",
            principal: n(item.principal),
            apr: n(item.apr),
            terms: Math.max(1, Math.round(n(item.terms))),
            startMonth: item.startMonth || addMonths(raw.meta?.baseMonth || template.meta.baseMonth, 0),
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
      template.meta
    ),
    basics: {
      startingTwd: n(raw.startingTwd),
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
          id: item.id || makeId("one-time"),
          name: item.name || "舊版一次項目",
          amount: n(item.amount),
          month: addMonths(baseMonth, clampMonthIndex(item.month)),
          type: item.type === "income" ? "income" : "expense",
          category: "other",
        }))
      : [],
    installments: Array.isArray(raw.installments || raw.installmentRows)
      ? (raw.installments || raw.installmentRows).map((item) => ({
          id: item.id || makeId("installment"),
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
    return { ok: false, message: `這份資料來自較新的版本（v${raw.schemaVersion}），目前只支援到 v${SCHEMA_VERSION}。` };
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
      errors.push({ lineNumber: index + 1, line, message: "欄位不足，格式需為：名稱, 本金, 利率, 期數, 起始月" });
      return;
    }
    const [name, principalRaw, aprRaw, termsRaw, startMonthRaw] = parts;
    const principal = n(principalRaw);
    const apr = n(aprRaw);
    const terms = Math.max(1, Math.round(n(termsRaw)));
    const startMonth = resolveRelativeMonth(startMonthRaw, baseMonth);

    if (!name || principal <= 0 || terms <= 0 || !startMonth) {
      errors.push({ lineNumber: index + 1, line, message: "請確認名稱、本金、期數與起始月（YYYY-MM / 下個月 / 再下個月）" });
      return;
    }

    parsed.push({
      id: makeId("installment"),
      name,
      principal,
      apr,
      terms,
      startMonth,
    });
  });

  return { parsed, errors };
}

function buildProjection(scenario) {
  const { basics, oneTimeItems, installments, meta } = scenario;
  const totalMonths = Math.max(0, Math.round(n(basics.monthsToProject)));
  if (totalMonths === 0) {
    return [];
  }

  let balance = n(basics.startingTwd) + (basics.includeJpyCash ? n(basics.jpyCashTwd) : 0);
  const rows = [];

  const installmentRows = installments.map((item) => {
    const terms = Math.max(1, Math.round(n(item.terms)));
    const payment = monthlyPayment(item.principal, item.apr, terms);
    return {
      ...item,
      terms,
      payment,
      totalPaid: payment * terms,
      interest: payment * terms - n(item.principal),
    };
  });

  for (let monthIndex = 0; monthIndex < totalMonths; monthIndex += 1) {
    const monthKey = addMonths(meta.baseMonth, monthIndex);
    const salary = diffMonths(basics.salaryStartsMonth, monthKey) >= 0 ? n(basics.monthlySalary) : 0;
    const subsidy = diffMonths(basics.subsidyStartsMonth, monthKey) >= 0 ? n(basics.monthlySubsidy) : 0;
    const rent = n(basics.monthlyRent);
    const living = n(basics.monthlyLivingCost);
    const studentLoan = n(basics.monthlyStudentLoan);
    const oneTimeForMonth = oneTimeItems.filter((item) => item.month === monthKey);
    const oneTimeIncome = oneTimeForMonth.filter((item) => item.type === "income").reduce((sum, item) => sum + n(item.amount), 0);
    const oneTimeExpense = oneTimeForMonth.filter((item) => item.type === "expense").reduce((sum, item) => sum + n(item.amount), 0);
    const installmentExpense = installmentRows.reduce((sum, item) => {
      const start = diffMonths(meta.baseMonth, item.startMonth);
      const endExclusive = start + item.terms;
      return monthIndex >= start && monthIndex < endExclusive ? sum + item.payment : sum;
    }, 0);
    const totalIncome = salary + subsidy + oneTimeIncome;
    const totalExpense = rent + living + studentLoan + oneTimeExpense + installmentExpense;
    const startBalance = balance;
    const net = totalIncome - totalExpense;
    balance += net;

    const expenseByCategory = oneTimeForMonth
      .filter((item) => item.type === "expense")
      .reduce((acc, item) => {
        const category = CATEGORY_OPTIONS.includes(item.category) ? item.category : "other";
        acc[category] = (acc[category] || 0) + n(item.amount);
        return acc;
      }, {});

    rows.push({
      monthIndex,
      monthKey,
      name: formatMonthLabel(monthKey, true),
      fullLabel: formatMonthLabel(monthKey),
      startBalance,
      salary,
      subsidy,
      oneTimeIncome,
      income: totalIncome,
      rent,
      living,
      studentLoan,
      oneTimeExpense,
      installments: installmentExpense,
      expense: totalExpense,
      net,
      balance,
      oneTimeItems: oneTimeForMonth,
      expenseByCategory,
      expenseByGroup: {
        fixed: rent + studentLoan,
        variable: living + installmentExpense,
        oneTime: oneTimeExpense,
      },
    });
  }

  return { rows, installmentRows };
}

function reserveTarget(scenario) {
  const basics = scenario.basics;
  return (n(basics.monthlyRent) + n(basics.monthlyLivingCost) + n(basics.monthlyStudentLoan)) * 3;
}

function maskCurrency(value, hidden) {
  return hidden ? "★★★" : `NT$ ${currency(value)}`;
}

function getErrorMessage(error, fallback) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error && error.message) {
    return String(error.message);
  }
  return fallback;
}

function isScenarioPayload(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value.meta &&
      typeof value.meta === "object" &&
      value.basics &&
      typeof value.basics === "object"
  );
}

function resolveSyncPayload(candidate, scenario) {
  return isScenarioPayload(candidate) ? candidate : toPersistedScenario(scenario);
}

function withTimeout(promise, timeoutMs, message) {
  let timerId;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    window.clearTimeout(timerId);
  });
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
    balance: { label: "月底現金", color: CHART_COLORS.balance },
    salary: { label: "薪資" },
    expense: { label: "總支出" },
    net: { label: "月淨額" },
  };

  return (
    <ChartSurface ariaLabel="月底現金趨勢圖，包含破產線、緊急預備金線與今天標記。" config={chartConfig}>
      <RechartsLineChart data={rows} margin={{ top: 18, right: 18, left: 0, bottom: 8 }}>
        <Customized component={() => <title>月底現金趨勢圖</title>} />
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 6" vertical={false} />
        <XAxis dataKey="monthKey" tickFormatter={(value) => formatMonthLabel(value, true)} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={ChartCurrencyTick} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} width={44} />
        <ChartTooltip
          content={<ChartTooltipCard />}
          formatter={(value, name) => [Math.round(n(value)), name]}
          labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel || ""}
        />
        <ReferenceLine y={0} stroke={CHART_COLORS.danger} strokeDasharray="6 6" ifOverflow="extendDomain" label={{ value: "破產線", fill: CHART_COLORS.danger, fontSize: 11, position: "insideTopLeft" }} />
        <ReferenceLine y={reserveLine} stroke={CHART_COLORS.reserve} strokeDasharray="6 6" ifOverflow="extendDomain" label={{ value: "預備金", fill: CHART_COLORS.reserve, fontSize: 11, position: "insideBottomLeft" }} />
        {todayMonthKey ? <ReferenceLine x={todayMonthKey} stroke="#475569" strokeDasharray="4 4" label={{ value: "今天", fill: "#475569", fontSize: 11, position: "top" }} /> : null}
        <Line type="monotone" dataKey="salary" hide name="薪資" />
        <Line type="monotone" dataKey="expense" hide name="總支出" />
        <Line type="monotone" dataKey="net" hide name="月淨額" />
        <Line
          type="monotone"
          dataKey="balance"
          name="月底現金"
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
    <text x={x + width / 2} y={y - 8} textAnchor="middle" fontSize="11" fill={payload.net < 0 ? CHART_COLORS.danger : "#047857"}>
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
    <ChartSurface ariaLabel="每月收入與支出比較圖，點擊長條會切到對應月份。" config={chartConfig}>
      <RechartsBarChart data={rows} margin={{ top: 18, right: 18, left: 0, bottom: 8 }} barGap={6}>
        <Customized component={() => <title>每月收入與支出比較圖</title>} />
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 6" vertical={false} />
        <XAxis dataKey="monthKey" tickFormatter={(value) => formatMonthLabel(value, true)} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={ChartCurrencyTick} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} width={44} />
        <ChartTooltip content={<ChartTooltipCard />} labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel || ""} />
        <Bar dataKey="income" name="收入" radius={[8, 8, 0, 0]}>
          {rows.map((row) => (
            <Cell key={`${row.monthKey}-income`} fill={row.monthKey === selectedMonthKey ? "#15803d" : CHART_COLORS.income} cursor="pointer" onClick={() => onSelectMonth(row.monthKey)} />
          ))}
        </Bar>
        <Bar dataKey="expense" name="支出" radius={[8, 8, 0, 0]}>
          <LabelList dataKey="net" content={<NetLabel />} />
          {rows.map((row) => (
            <Cell key={`${row.monthKey}-expense`} fill={row.monthKey === selectedMonthKey ? "#ea580c" : CHART_COLORS.expense} cursor="pointer" onClick={() => onSelectMonth(row.monthKey)} />
          ))}
        </Bar>
      </RechartsBarChart>
    </ChartSurface>
  );
}

function ExpenseCompositionChart({ rows, mode, view, setMode, setView, selectedMonthKey, hidden }) {
  if (!rows.length) return <EmptyChartState />;
  const seriesKeys = view === "category" ? CATEGORY_OPTIONS : ["fixed", "variable", "oneTime"];
  const colors =
    view === "category"
      ? Object.fromEntries(CATEGORY_OPTIONS.map((key) => [key, CATEGORY_META[key].color]))
      : { fixed: CHART_COLORS.fixed, variable: CHART_COLORS.variable, oneTime: CHART_COLORS.oneTime };
  const labels =
    view === "category"
      ? Object.fromEntries(CATEGORY_OPTIONS.map((key) => [key, CATEGORY_META[key].label]))
      : { fixed: "固定支出", variable: "浮動支出", oneTime: "一次性支出" };
  const totals = rows.map((row) =>
    seriesKeys.reduce((sum, key) => sum + n(view === "category" ? row.expenseByCategory[key] : row.expenseByGroup[key]), 0)
  );
  const max = Math.max(1, ...totals);
  const valueFor = (row, key) => n(view === "category" ? row.expenseByCategory[key] : row.expenseByGroup[key]);
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
      next[key] = mode === "ratio" ? Math.round(normalizeRatio(row, key) * 1000) / 10 : valueFor(row, key);
    });
    return next;
  });
  const selectedRow = rows.find((row) => row.monthKey === selectedMonthKey) || null;
  const selectedTotal = selectedRow ? seriesKeys.reduce((sum, key) => sum + valueFor(selectedRow, key), 0) : 0;
  const chartConfig = Object.fromEntries(
    seriesKeys.map((key) => [
      key,
      {
        label: labels[key],
        color: colors[key],
      },
    ])
  );

  return (
    <div>
      {selectedRow ? (
        <div style={{ ...styles.mutedBox, marginBottom: "12px" }}>
          <div style={{ ...styles.label, marginBottom: "8px" }}>鑽取月份</div>
          <div style={{ fontSize: "13px", color: "#334155", fontWeight: 700, marginBottom: "8px" }}>{selectedRow.fullLabel}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "8px" }}>
            {seriesKeys.map((key) => {
              const amount = valueFor(selectedRow, key);
              const ratio = selectedTotal > 0 ? Math.round((amount / selectedTotal) * 1000) / 10 : 0;
              return (
                <div key={key} style={{ background: "white", borderRadius: "14px", border: "1px solid #dbe4ee", padding: "10px" }}>
                  <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "4px" }}>{labels[key]}</div>
                  <div style={{ fontSize: "14px", fontWeight: 800, color: "#0f172a" }}>{hidden ? "★★★" : `NT$ ${currency(amount)}`}</div>
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>{ratio}%</div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="flowra-no-export" style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
        <InteractiveButton variant={mode === "absolute" ? "activePill" : "pillButton"} onClick={() => setMode("absolute")}>
          絕對金額
        </InteractiveButton>
        <InteractiveButton variant={mode === "ratio" ? "activePill" : "pillButton"} onClick={() => setMode("ratio")}>
          佔比百分比
        </InteractiveButton>
        <InteractiveButton variant={view === "group" ? "activePill" : "pillButton"} onClick={() => setView("group")}>
          按支出群組
        </InteractiveButton>
        <InteractiveButton variant={view === "category" ? "activePill" : "pillButton"} onClick={() => setView("category")}>
          按分類
        </InteractiveButton>
      </div>
      <ChartSurface
        ariaLabel={`支出組成堆疊面積圖，現在顯示${view === "category" ? "按分類" : "按支出群組"}與${mode === "ratio" ? "佔比百分比" : "絕對金額"}。`}
        config={chartConfig}
        footer={seriesKeys.map((key) => (
          <div key={key} style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#475569" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "999px", background: colors[key] }} />
            {labels[key]}
          </div>
        ))}
      >
        <RechartsAreaChart data={chartData} margin={{ top: 18, right: 18, left: 0, bottom: 8 }}>
          <Customized component={() => <title>支出組成堆疊面積圖</title>} />
          <defs>
            {seriesKeys.map((key) => (
              <linearGradient key={key} id={`flowra-gradient-${key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors[key]} stopOpacity={0.78} />
                <stop offset="95%" stopColor={colors[key]} stopOpacity={0.08} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 6" vertical={false} />
          <XAxis dataKey="monthKey" tickFormatter={(value) => formatMonthLabel(value, true)} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
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
            formatter={(value, name) => (mode === "ratio" ? [`${value}%`, name] : [Math.round(n(value)), name])}
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
  );
}

const COLLAPSE_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const COLLAPSE_DURATION = "300ms";

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
      <path d="M4 2.5 L8 6 L4 9.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
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

function Collapsible({ open, children, topGap = 12 }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: open ? "1fr" : "0fr",
        transition: `grid-template-rows ${COLLAPSE_DURATION} ${COLLAPSE_EASE}, opacity ${COLLAPSE_DURATION} ${COLLAPSE_EASE}`,
        opacity: open ? 1 : 0,
      }}
    >
      <div style={{ overflow: "hidden", minHeight: 0 }}>
        <div style={{ paddingTop: open ? topGap : 0, transition: `padding-top ${COLLAPSE_DURATION} ${COLLAPSE_EASE}` }}>
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
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
  if (variant === "dropdownItem") {
    return {
      base: styles.dropdownItem,
      hover: { background: "#f8fafc" },
      focus: styles.inputFocus,
      active: { background: "#e2e8f0" },
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
  { as: Component = "div", style, className, hoverClassName, disabled = false, onMouseEnter, onMouseLeave, children, ...props },
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

const FloatingSurface = React.forwardRef(function FloatingSurface({ as: Component = "div", style, className, motionClassName, children, ...props }, ref) {
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

function InteractiveInput({ style, disabled, onFocus, onBlur, onMouseEnter, onMouseLeave, ...props }) {
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

function InteractiveSelect({ style, disabled, onFocus, onBlur, onMouseEnter, onMouseLeave, ...props }) {
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

function InteractiveTextarea({ style, disabled, onFocus, onBlur, onMouseEnter, onMouseLeave, ...props }) {
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

function Field({ label, value, onChange, suffix = "", min, step = 1000, disabled }) {
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [hoveredStepper, setHoveredStepper] = useState("");

  return (
    <div>
      <label style={styles.label}>{label}</label>
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
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(Math.round(n(event.target.value)))}
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
              onClick={() => onChange(n(value) + step)}
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
              onClick={() => onChange(Math.max(n(min ?? -Infinity), n(value) - step))}
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
        {suffix ? <span style={{ fontSize: "12px", color: "#64748b", whiteSpace: "nowrap" }}>{suffix}</span> : null}
      </div>
    </div>
  );
}

function TextField({ label, value, onChange, disabled, type = "text", placeholder = "" }) {
  return (
    <div>
      {label ? <label style={styles.label}>{label}</label> : null}
      <InteractiveInput type={type} value={value} placeholder={placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
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
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)", gap: "8px" }}>
        <InteractiveSelect value={parsed.year} disabled={disabled} onChange={(event) => changeYear(Number(event.target.value))}>
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </InteractiveSelect>
        <InteractiveSelect value={parsed.month} disabled={disabled} onChange={(event) => changeMonth(Number(event.target.value))}>
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
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)", gap: "8px" }}>
        <InteractiveSelect value={parsed.year} disabled={disabled} onChange={(event) => onChange(formatYearMonth(Number(event.target.value), parsed.month))}>
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </InteractiveSelect>
        <InteractiveSelect value={parsed.month} disabled={disabled} onChange={(event) => onChange(formatYearMonth(parsed.year, Number(event.target.value)))}>
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
      <p style={{ ...styles.statValue, color: danger ? "#dc2626" : "#0f172a" }}>{hidden ? "★★★" : `NT$ ${currency(value)}`}</p>
    </InteractiveSurface>
  );
}

function OneTimePreview({ row, hidden }) {
  const chips = row.oneTimeItems
    .filter((item) => item.type === "expense")
    .slice(0, 2)
    .map((item) => CATEGORY_META[item.category] || CATEGORY_META.other);
  if (!chips.length) {
    return <span style={{ color: "#94a3b8" }}>無</span>;
  }
  return (
    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" }}>
      {chips.map((chip, index) => (
        <span key={`${chip.label}-${index}`} style={{ ...styles.chip, color: chip.color, border: `1px solid ${chip.color}40`, background: `${chip.color}10` }}>
          {chip.label}
        </span>
      ))}
    </div>
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
      {positive ? "+" : "−"}{currency(Math.abs(value))}
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
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", marginBottom: "10px" }}>
                <strong style={{ fontSize: "14px", color: "#0f172a" }}>{row.fullLabel}</strong>
                <NetPill value={row.net} hidden={hidden} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px 14px", fontSize: "12px" }}>
                <MobileStat label="月初現金" value={row.startBalance} hidden={hidden} />
                <MobileStat label="月底現金" value={row.balance} hidden={hidden} danger={balanceNegative} />
                <MobileStat label="收入合計" value={row.income} hidden={hidden} accent="#047857" />
                <MobileStat label="支出合計" value={row.expense} hidden={hidden} accent="#dc2626" />
              </div>
              {row.oneTimeItems.filter((item) => item.type === "expense").length > 0 ? (
                <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px dashed #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.05em", textTransform: "uppercase" }}>一次性</span>
                  <OneTimePreview row={row} hidden={hidden} />
                </div>
              ) : null}
              {readonly ? <div style={{ ...styles.readonlyBadge, marginTop: "8px" }}>唯讀</div> : null}
            </div>
          );
        })}
      </div>
    );
  }

  const groupBoundary = { borderLeft: "1px solid #f1f5f9" };
  const sectionHead = { ...styles.th, fontSize: "10px", letterSpacing: "0.06em", textTransform: "uppercase", color: "#94a3b8", padding: "8px 10px 4px" };
  const numericTd = { ...styles.td, fontVariantNumeric: "tabular-nums" };
  const subTd = { ...numericTd, color: "#64748b", fontSize: "12px" };

  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={{ ...sectionHead, textAlign: "left" }}></th>
            <th style={sectionHead}>結餘</th>
            <th colSpan={3} style={{ ...sectionHead, ...groupBoundary, color: "#047857" }}>收入</th>
            <th colSpan={5} style={{ ...sectionHead, ...groupBoundary, color: "#dc2626" }}>支出</th>
            <th colSpan={2} style={{ ...sectionHead, ...groupBoundary }}>結算</th>
          </tr>
          <tr>
            <th style={{ ...styles.th, textAlign: "left" }}>月份</th>
            <th style={styles.th}>月初現金</th>
            <th style={{ ...styles.th, ...groupBoundary }}>薪資</th>
            <th style={styles.th}>補貼</th>
            <th style={styles.th}>一次性</th>
            <th style={{ ...styles.th, ...groupBoundary }}>房租</th>
            <th style={styles.th}>生活費</th>
            <th style={styles.th}>學貸</th>
            <th style={styles.th}>一次性</th>
            <th style={styles.th}>分期</th>
            <th style={{ ...styles.th, ...groupBoundary }}>月淨額</th>
            <th style={styles.th}>月底現金</th>
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
                  {active ? <span style={{ display: "inline-block", width: "3px", height: "14px", borderRadius: "3px", background: "#0284c7", verticalAlign: "middle", marginRight: "8px" }} /> : null}
                  {row.fullLabel}
                </td>
                <td style={numericTd}>{hidden ? "★★★" : currency(row.startBalance)}</td>
                <td style={{ ...subTd, ...groupBoundary }}>{hidden ? "★★★" : currency(row.salary)}</td>
                <td style={subTd}>{hidden ? "★★★" : currency(row.subsidy)}</td>
                <td style={subTd}>{hidden ? "★★★" : currency(row.oneTimeIncome)}</td>
                <td style={{ ...subTd, ...groupBoundary }}>{hidden ? "★★★" : currency(row.rent)}</td>
                <td style={subTd}>{hidden ? "★★★" : currency(row.living)}</td>
                <td style={subTd}>{hidden ? "★★★" : currency(row.studentLoan)}</td>
                <td style={subTd}>
                  <OneTimePreview row={row} hidden={hidden} />
                </td>
                <td style={subTd}>{hidden ? "★★★" : currency(row.installments)}</td>
                <td style={{ ...styles.td, ...groupBoundary, textAlign: "right" }}>
                  <NetPill value={row.net} hidden={hidden} />
                </td>
                <td style={{ ...numericTd, fontWeight: 800, color: balanceNegative ? "#dc2626" : "#0f172a" }}>{hidden ? "★★★" : currency(row.balance)}</td>
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
      <div style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 700, letterSpacing: "0.04em", marginBottom: "2px" }}>{label}</div>
      <div style={{ fontSize: "13px", fontWeight: 700, color: valueColor, fontVariantNumeric: "tabular-nums" }}>
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
  badge: {
    display: "inline-flex",
    alignItems: "center",
    background: "rgba(255,255,255,0.94)",
    border: "1px solid rgba(203,213,225,0.9)",
    borderRadius: "999px",
    padding: "7px 13px",
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    color: "#475569",
    textTransform: "uppercase",
  },
  title: { fontSize: "clamp(32px, 5vw, 46px)", lineHeight: 1.04, fontWeight: 900, letterSpacing: "-0.03em", margin: "16px 0 10px" },
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
    width: "18px",
    minHeight: "32px",
    alignSelf: "stretch",
    padding: 0,
    cursor: "grab",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    opacity: 0.45,
    transition: "opacity 160ms ease, background 160ms ease, color 160ms ease, border-color 160ms ease",
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
  dangerButton: {
    border: "1px solid #fecaca",
    background: "#fff1f2",
    color: "#be123c",
    borderRadius: "12px",
    padding: "8px 11px",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: "12px",
    transition: INTERACTIVE_TRANSITION,
    willChange: INTERACTIVE_WILL_CHANGE,
  },
  summaryGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "18px", marginBottom: "26px" },
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
  statLabel: { color: "#64748b", fontSize: "12px", fontWeight: 700, letterSpacing: "0.03em", margin: 0 },
  statValue: { fontSize: "28px", fontWeight: 900, letterSpacing: "-0.03em", margin: "10px 0 0" },
  mainGridDesktop: { display: "grid", gridTemplateColumns: "minmax(320px, 430px) minmax(0, 1fr)", gap: "24px", alignItems: "start" },
  mainGridMobile: { display: "grid", gridTemplateColumns: "1fr", gap: "20px" },
  inputGrid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" },
  inputGridSingle: { display: "grid", gridTemplateColumns: "1fr", gap: "12px" },
  label: { display: "block", fontSize: "12px", fontWeight: 700, color: "#64748b", marginBottom: "7px" },
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
  mutedBox: { background: "#f8fafc", borderRadius: "14px", padding: "14px", marginTop: "12px", border: "1px solid #e2e8f0" },
  miniGrid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px", fontSize: "12px" },
  alert: { display: "flex", gap: "12px", background: "#fff1f2", border: "1px solid #fecdd3", color: "#be123c", padding: "16px 18px", borderRadius: "16px", marginBottom: "24px" },
  tableWrap: { overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: "16px", background: "white" },
  table: { width: "100%", minWidth: "1120px", borderCollapse: "collapse", fontSize: "13px" },
  th: { background: "#f8fafc", color: "#475569", textAlign: "right", padding: "12px 10px", fontSize: "12px", fontWeight: 800, borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0, zIndex: 1 },
  tableRow: { transition: `background ${MOTION.fast}` },
  td: { textAlign: "right", padding: "12px 10px", borderTop: "1px solid #edf2f7" },
  chip: { display: "inline-flex", alignItems: "center", gap: "4px", border: "1px solid #dbe4ee", borderRadius: "999px", padding: "5px 9px", fontSize: "11px", fontWeight: 700 },
  metaText: { margin: 0, color: "#64748b", fontSize: "13px", lineHeight: 1.65 },
  inlineHint: { display: "inline-flex", alignItems: "center", color: "#475569", fontSize: "12px" },
  exportGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" },
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
  readonlyBadge: { marginTop: "10px", display: "inline-block", borderRadius: "999px", padding: "5px 9px", background: "#f8fafc", color: "#475569", fontSize: "11px", fontWeight: 800 },
  mobileMetrics: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px", fontSize: "13px", color: "#334155" },
  modalBackdrop: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.48)", display: "grid", placeItems: "center", padding: "20px", zIndex: 50 },
  modalCard: {
    width: "min(680px, 100%)",
    background: "white",
    borderRadius: "24px",
    border: "1px solid #dbe4ee",
    padding: "20px",
  },
};

export default function PersonalFinanceCashflowSimulator() {
  const [scenario, setScenario] = useState(() => createDefaultScenario());
  const [sessionMeta, setSessionMeta] = useState(() => readSessionMeta());
  const [cloudBackupUpdatedAt, setCloudBackupUpdatedAt] = useState("");
  const [selectedMonthKey, setSelectedMonthKey] = useState("");
  const [expenseMode, setExpenseMode] = useState("absolute");
  const [expenseView, setExpenseView] = useState("group");
  const [isOneTimeOpen, setIsOneTimeOpen] = useState(false);
  const [isInstallmentsOpen, setIsInstallmentsOpen] = useState(false);
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
  const [openOneTimeItemIds, setOpenOneTimeItemIds] = useState({});
  const [openInstallmentItemIds, setOpenInstallmentItemIds] = useState({});
  const [cloudNotice, setCloudNotice] = useState("");
  const [cloudSyncStatus, setCloudSyncStatus] = useState("idle");
  const [cloudAuthState, setCloudAuthState] = useState(() => (isSupabaseConfigured() ? "checking" : "unconfigured"));
  const [cloudSetupState, setCloudSetupState] = useState(() => (isSupabaseConfigured() ? "checking" : "unconfigured"));
  const [cloudUserEmail, setCloudUserEmail] = useState("");
  const [authEmailInput, setAuthEmailInput] = useState("");
  const [isSendingMagicLink, setIsSendingMagicLink] = useState(false);
  const [isCloudBackupLoading, setIsCloudBackupLoading] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isPreparingPdf, setIsPreparingPdf] = useState(false);
  const [isPreparingReportExport, setIsPreparingReportExport] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === "undefined" ? 1200 : window.innerWidth));
  const [bulkInstallmentText, setBulkInstallmentText] = useState("");
  const [bulkInstallmentErrors, setBulkInstallmentErrors] = useState([]);
  const [bulkInstallmentPreview, setBulkInstallmentPreview] = useState([]);
  const monthRefs = useRef({});
  const fileInputRef = useRef(null);
  const cloudHydratedRef = useRef(false);
  const scenarioInitializedRef = useRef(false);
  const skipNextScenarioDirtyRef = useRef(false);
  const reportRef = useRef(null);
  const trendChartRef = useRef(null);
  const incomeChartRef = useRef(null);
  const compositionChartRef = useRef(null);
  const monthDetailRef = useRef(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const mobile = viewportWidth < 860;
  const hiddenAmounts = false;
  const readonlyShared = false;
  const supabaseReady = useMemo(() => isSupabaseConfigured(), []);
  const projectionResult = useMemo(() => buildProjection(scenario), [scenario]);
  const rows = Array.isArray(projectionResult) ? projectionResult : projectionResult.rows;
  const installmentRows = Array.isArray(projectionResult) ? [] : projectionResult.installmentRows;
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
    [generatedAt]
  );
  const lastOpenedAtLabel = useMemo(() => formatTimestamp(sessionMeta.lastOpenedAt), [sessionMeta.lastOpenedAt]);
  const lastSyncedAtLabel = useMemo(() => formatTimestamp(sessionMeta.lastSyncedAt), [sessionMeta.lastSyncedAt]);
  const lastSyncAttemptAtLabel = useMemo(() => formatTimestamp(sessionMeta.lastSyncAttemptAt), [sessionMeta.lastSyncAttemptAt]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("flowra.cashflow.draft");
      window.localStorage.removeItem("flowra.cashflow.pending-cloud-sync");
    }
    setSessionMeta(writeSessionMeta({ lastOpenedAt: new Date().toISOString() }));
  }, []);

  useEffect(() => {
    const selected = rows[0]?.monthKey || "";
    setSelectedMonthKey((current) => current || selected);
  }, [rows]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
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
    setCloudSyncStatus((current) => (current === "syncing" ? current : "pending"));
  }, [scenario]);

  useEffect(() => {
    if (!selectedMonthKey || !monthRefs.current[selectedMonthKey]) return;
    monthRefs.current[selectedMonthKey].scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }, [selectedMonthKey]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsExportMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!supabaseReady) {
      setCloudAuthState("unconfigured");
      return undefined;
    }
    const supabase = createFlowraSupabaseClient();
    if (!supabase) {
      setCloudAuthState("unconfigured");
      return undefined;
    }

    let mounted = true;
    setCloudAuthState("checking");

    getCurrentSupabaseUser().then(({ user }) => {
      if (mounted) {
        setCloudAuthState(user ? "authenticated" : "anonymous");
        setCloudUserEmail(user?.email || "");
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setCloudAuthState(session?.user ? "authenticated" : "anonymous");
        setCloudUserEmail(session?.user?.email || "");
      }
    });

    return () => {
      mounted = false;
      subscription?.subscription?.unsubscribe();
    };
  }, [supabaseReady]);

  useEffect(() => {
    if (!supabaseReady) {
      setCloudSetupState("unconfigured");
      return undefined;
    }

    let cancelled = false;
    setCloudSetupState("checking");

    checkFlowraCloudSetup().then(({ ready, error }) => {
      if (cancelled) return;
      if (ready) {
        setCloudSetupState("ready");
        return;
      }
      if (error?.message?.includes("尚未建立 Flowra 雲端資料表")) {
        setCloudSetupState("missing");
        setCloudNotice(error.message);
        return;
      }
      setCloudSetupState("error");
      if (error?.message) {
        setCloudNotice(error.message);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [supabaseReady]);

  useEffect(() => {
    if (typeof window === "undefined" || !supabaseReady || cloudHydratedRef.current) return undefined;
    const supabase = createFlowraSupabaseClient();
    if (!supabase) return undefined;

    let cancelled = false;
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (cancelled || error || !data?.session || cloudHydratedRef.current) return;
      cloudHydratedRef.current = true;
      await refreshCloudBackup({ silent: true, applyPayload: false });
    });

    return () => {
      cancelled = true;
    };
  }, [supabaseReady]);

  const summary = useMemo(() => {
    const balances = rows.map((row) => row.balance);
    const minBalance = balances.length ? Math.min(...balances) : 0;
    const finalBalance = rows.length ? rows[rows.length - 1].balance : 0;
    const totalIncome = rows.reduce((sum, row) => sum + row.income, 0);
    const totalExpense = rows.reduce((sum, row) => sum + row.expense, 0);
    const totalInstallmentInterest = installmentRows.reduce((sum, row) => sum + row.interest, 0);
    return { minBalance, finalBalance, totalIncome, totalExpense, totalInstallmentInterest };
  }, [rows, installmentRows]);

  const transitionApply = (nextScenario, options = {}) => {
    skipNextScenarioDirtyRef.current = options.markDirty === false;
    setScenario(migrateLegacyScenario(nextScenario));
    setSelectedMonthKey("");
  };

  const patchMeta = (patch) => {
    setScenario((current) => cloneScenario(current, { meta: { ...current.meta, ...patch } }));
  };

  const patchBasics = (patch) => {
    setScenario((current) => cloneScenario(current, { basics: { ...current.basics, ...patch } }));
  };

  const updateOneTimeItem = (id, patch) => {
    setScenario((current) =>
      cloneScenario(current, {
        oneTimeItems: current.oneTimeItems.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      })
    );
  };

  const updateInstallment = (id, patch) => {
    setScenario((current) =>
      cloneScenario(current, {
        installments: current.installments.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      })
    );
  };

  const addOneTimeItem = () => {
    const id = makeId("one-time");
    setScenario((current) =>
      cloneScenario(current, {
        oneTimeItems: [
          ...current.oneTimeItems,
          { id, name: "新增一次性項目", amount: 1000, month: current.meta.baseMonth, type: "expense", category: "other" },
        ],
      })
    );
    setIsOneTimeOpen(true);
    setOpenOneTimeItemIds((current) => ({ ...current, [id]: true }));
  };

  const addInstallment = () => {
    const id = makeId("installment");
    setScenario((current) =>
      cloneScenario(current, {
        installments: [
          ...current.installments,
          { id, name: "新增分期", principal: 10000, apr: 10, terms: 6, startMonth: addMonths(current.meta.baseMonth, 1) },
        ],
      })
    );
    setIsInstallmentsOpen(true);
    setOpenInstallmentItemIds((current) => ({ ...current, [id]: true }));
  };

  const removeOneTimeItem = (id) => {
    setScenario((current) => cloneScenario(current, { oneTimeItems: current.oneTimeItems.filter((item) => item.id !== id) }));
  };

  const removeInstallment = (id) => {
    setScenario((current) => cloneScenario(current, { installments: current.installments.filter((item) => item.id !== id) }));
  };

  const duplicateOneTimeItem = (id) => {
    setScenario((current) => {
      const target = current.oneTimeItems.find((item) => item.id === id);
      if (!target) return current;
      const duplicate = { ...target, id: makeId("one-time"), name: `${target.name} 副本` };
      return cloneScenario(current, { oneTimeItems: [...current.oneTimeItems, duplicate] });
    });
  };

  const duplicateInstallment = (id) => {
    setScenario((current) => {
      const target = current.installments.find((item) => item.id === id);
      if (!target) return current;
      const duplicate = { ...target, id: makeId("installment"), name: `${target.name} 副本` };
      return cloneScenario(current, { installments: [...current.installments, duplicate] });
    });
  };

  const importBulkInstallments = () => {
    if (bulkInstallmentErrors.length > 0 || bulkInstallmentPreview.length === 0) {
      return;
    }
    setScenario((current) => cloneScenario(current, { installments: [...current.installments, ...bulkInstallmentPreview] }));
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
      return cloneScenario(current, { oneTimeItems: arrayMove(current.oneTimeItems, oldIndex, newIndex) });
    });
  };

  const handleInstallmentDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setScenario((current) => {
      const oldIndex = current.installments.findIndex((item) => item.id === active.id);
      const newIndex = current.installments.findIndex((item) => item.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return current;
      return cloneScenario(current, { installments: arrayMove(current.installments, oldIndex, newIndex) });
    });
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(toPersistedScenario(scenario), null, 2)], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${exportFileBase(scenario.meta.baseMonth)}.json`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  const exportExcel = () => {
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
      }))
    );
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "月度明細");
    XLSX.writeFile(workbook, `${exportFileBase(scenario.meta.baseMonth)}.xlsx`);
  };

  const exportPng = async () => {
    if (!reportRef.current) return;
    try {
      setIsPreparingReportExport(true);
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
      const dataUrl = await toPng(reportRef.current, { pixelRatio: 2, cacheBust: true, backgroundColor: "#ffffff" });
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
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
      const dataUrl = await toPng(targetRef.current, { pixelRatio: 2, cacheBust: true, backgroundColor: "#ffffff" });
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
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
      const dataUrl = await toPng(reportRef.current, { pixelRatio: 2, cacheBust: true, backgroundColor: "#ffffff" });
      const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = dataUrl;
      });
      const ratio = Math.min((pageWidth - margin * 2) / img.width, (pageHeight - margin * 2) / img.height);
      const renderWidth = img.width * ratio;
      const renderHeight = img.height * ratio;
      const x = (pageWidth - renderWidth) / 2;
      const y = margin;
      pdf.addImage(dataUrl, "PNG", x, y, renderWidth, renderHeight);
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
        window.alert(validation.message);
        event.target.value = "";
        return;
      }
      transitionApply(parsed);
    } catch (error) {
      window.alert("資料匯入失敗，請確認檔案格式正確。");
    }
    event.target.value = "";
  };

  const sendMagicLink = async () => {
    const email = authEmailInput.trim();
    if (!email) {
      setCloudNotice("請先輸入登入信箱。");
      return;
    }

    setIsSendingMagicLink(true);
    try {
      const redirectTo = typeof window !== "undefined" ? window.location.href : undefined;
      const { error } = await sendSupabaseMagicLink(email, redirectTo);

      if (error) {
        setCloudNotice(error.message || "登入連結寄送失敗。");
        return;
      }

      setCloudNotice(`驗證信已寄到 ${email}，請在同一台裝置開啟信件完成登入。`);
    } catch (error) {
      setCloudNotice(getErrorMessage(error, "驗證信寄送失敗。"));
    } finally {
      setIsSendingMagicLink(false);
    }
  };

  const signOutFromSupabase = async () => {
    const { error } = await signOutSupabase();
    if (error) {
      setCloudNotice(error.message || "登出失敗。");
      return;
    }
    setCloudNotice("已登出。");
  };

  const refreshCloudBackup = async (options = {}) => {
    const { silent = false, applyPayload = false } = options;
    if (cloudSetupState !== "ready") {
      if (!silent) {
        setCloudNotice(cloudSetupMessage);
      }
      return { data: null, error: new Error(cloudSetupMessage) };
    }
    if (cloudAuthState !== "authenticated") {
      const error = new Error("請先登入，才能讀取雲端備份。");
      if (!silent) {
        setCloudNotice(error.message);
      }
      return { data: null, error };
    }

    setIsCloudBackupLoading(true);
    try {
      const { data, error } = await getLatestCloudBackup();
      if (error) {
        if (!silent) {
          setCloudNotice(error.message);
        }
        return { data: null, error };
      }

      if (!data?.payload) {
        setCloudBackupUpdatedAt("");
        if (!silent) {
          setCloudNotice("雲端目前沒有備份。");
        }
        return { data: null, error: null };
      }

      setCloudBackupUpdatedAt(data.updated_at || "");

      if (applyPayload) {
        transitionApply(data.payload, { markDirty: false });
        setCloudSyncStatus("synced");
        setCloudNotice("已從雲端還原最近備份。");
      } else if (!silent) {
        setCloudNotice(`已找到最近備份（${formatTimestamp(data.updated_at)}）。`);
      }

      return { data, error: null };
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("讀取雲端備份失敗。");
      if (!silent) {
        setCloudNotice(normalizedError.message);
      }
      return { data: null, error: normalizedError };
    } finally {
      setIsCloudBackupLoading(false);
    }
  };

  const syncScenarioToCloud = async (payloadOverride, options = {}) => {
    const safePayload = resolveSyncPayload(payloadOverride, scenario);
    const { silent = false } = options;
    const attemptAt = new Date().toISOString();
    setSessionMeta(writeSessionMeta({ lastSyncAttemptAt: attemptAt }));
    if (!supabaseReady) {
      setCloudNotice(getSupabaseConfigHint());
      return { error: new Error(getSupabaseConfigHint()) };
    }
    if (cloudSetupState !== "ready") {
      setCloudNotice(cloudSetupMessage);
      return { error: new Error(cloudSetupMessage) };
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setCloudSyncStatus("pending");
      if (!silent) {
        setCloudNotice("目前離線，這次變更尚未同步；恢復連線後請再手動同步。");
      }
      return { error: new Error("offline") };
    }
    setCloudSyncStatus("syncing");
    try {
      const { data, error } = await withTimeout(
        upsertCloudBackup({
          payload: safePayload,
        }),
        12000,
        "同步雲端備份逾時，請確認網路後再試。"
      );
      if (error) {
        setCloudSyncStatus("pending");
        setCloudNotice(error.message);
        return { error };
      }
      setCloudBackupUpdatedAt(data?.updated_at || new Date().toISOString());
      setCloudSyncStatus("synced");
      setSessionMeta(writeSessionMeta({ lastSyncedAt: new Date().toISOString(), lastSyncAttemptAt: attemptAt }));
      setCloudNotice("目前內容已同步到雲端備份。");
      return { error: null };
    } catch (error) {
      setCloudSyncStatus("pending");
      const normalizedError = error instanceof Error ? error : new Error("同步雲端備份失敗。");
      setCloudNotice(normalizedError.message);
      return { error: normalizedError };
    }
  };

  const focusCompositionMonth = (monthKey) => {
    setSelectedMonthKey(monthKey);
    if (compositionChartRef.current) {
      compositionChartRef.current.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
    }
  };

  const mainGridClassName = "flowra-main-grid grid grid-cols-1 gap-5 xl:grid-cols-[minmax(320px,430px)_minmax(0,1fr)] xl:items-start";
  const inputGridClassName = "grid grid-cols-1 gap-3 sm:grid-cols-2";
  const cloudAuthMessage =
    cloudAuthState === "authenticated"
      ? `已登入帳號${cloudUserEmail ? `（${cloudUserEmail}）` : ""}，可同步備份與還原。`
      : cloudAuthState === "checking"
        ? "正在檢查登入狀態。"
        : cloudAuthState === "anonymous"
          ? "尚未登入，請先寄送驗證信完成登入。"
          : getSupabaseConfigHint();
  const cloudSetupMessage =
    cloudSetupState === "ready"
      ? "雲端備份已就緒。"
      : cloudSetupState === "checking"
        ? "正在檢查雲端備份狀態。"
        : cloudSetupState === "missing"
          ? "雲端備份目前暫時不可用。"
          : cloudSetupState === "error"
            ? "雲端備份狀態檢查失敗。"
            : getSupabaseConfigHint();
  const cloudFeaturesEnabled = cloudAuthState === "authenticated" && cloudSetupState === "ready";

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
      `}</style>
      <div style={{ ...styles.container, ...styles.chartTheme }} className={`flowra-print-root${isPreparingPdf ? " flowra-pdf-export" : ""}${isPreparingReportExport ? " flowra-report-export" : ""}`} ref={reportRef}>
        <div style={styles.header}>
          <div>
            <div style={styles.badge}>
              個人現金流試算
            </div>
            <h1 style={styles.title}>未來財務趨勢模擬器</h1>
            <p style={styles.subtitle}>
              用來試算未來幾個月的現金流與支出變化。
            </p>
            <div style={{ ...styles.metaText, marginTop: "10px" }}>
              試算期間：{reportPeriodLabel}　|　產生時間：{generatedAtLabel}
            </div>
          </div>
        </div>

        <div style={styles.summaryGrid}>
          <StatCard label="期末現金" value={summary.finalBalance} hidden={hiddenAmounts} danger={summary.finalBalance < 0} />
          <StatCard label="期間最低現金" value={summary.minBalance} hidden={hiddenAmounts} danger={summary.minBalance < 0} />
          <StatCard label="期間總收入" value={summary.totalIncome} hidden={hiddenAmounts} />
          <StatCard label="估計分期利息合計" value={summary.totalInstallmentInterest} hidden={hiddenAmounts} />
        </div>

        {summary.minBalance < 0 ? (
          <div style={styles.alert}>
            <div>
              <strong>現金流會轉負</strong>
              <div>目前設定下，期間最低現金為 {maskCurrency(summary.minBalance, hiddenAmounts)}。建議降低生活費、延後支出、增加收入或調整分期期數。</div>
            </div>
          </div>
        ) : null}

        <div className={mainGridClassName}>
          <div className="flowra-no-print flowra-no-report-export">
            <InteractiveSurface as="section" style={styles.card} hoverClassName="flowra-hover-card">
              <h2 style={styles.cardTitle}>基本設定</h2>

              <SettingsGroup title="時間範圍" accent="#64748b">
                <div className={inputGridClassName}>
                  <BaseMonthPicker value={scenario.meta.baseMonth} onChange={(value) => patchMeta({ baseMonth: value })} disabled={readonlyShared} />
                  <Field label="試算月數" value={scenario.basics.monthsToProject} onChange={(value) => patchBasics({ monthsToProject: Math.max(0, Math.round(value)) })} suffix="月" min={0} step={1} disabled={readonlyShared} />
                </div>
              </SettingsGroup>

              <SettingsGroup title="可動用現金" accent="#d97706">
                <div className={inputGridClassName}>
                  <Field label="目前台幣餘額" value={scenario.basics.startingTwd} onChange={(value) => patchBasics({ startingTwd: value })} suffix="元" disabled={readonlyShared} />
                  <Field label="日幣現金折台幣" value={scenario.basics.jpyCashTwd} onChange={(value) => patchBasics({ jpyCashTwd: value })} suffix="元" disabled={readonlyShared} />
                </div>
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "10px", marginTop: "10px" }}>
                  <span style={{ ...styles.label, margin: 0 }}>日幣現金納入可動用資金</span>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <InteractiveButton
                      variant={scenario.basics.includeJpyCash ? "activePill" : "pillButton"}
                      onClick={() => patchBasics({ includeJpyCash: true })}
                      disabled={readonlyShared}
                    >
                      納入
                    </InteractiveButton>
                    <InteractiveButton
                      variant={!scenario.basics.includeJpyCash ? "activePill" : "pillButton"}
                      onClick={() => patchBasics({ includeJpyCash: false })}
                      disabled={readonlyShared}
                    >
                      不納入
                    </InteractiveButton>
                  </div>
                </div>
              </SettingsGroup>

              <SettingsGroup title="每月收入" accent="#16a34a">
                <div className={inputGridClassName}>
                  <Field label="每月薪資" value={scenario.basics.monthlySalary} onChange={(value) => patchBasics({ monthlySalary: value })} suffix="元" disabled={readonlyShared} />
                  <MonthPicker label="薪資開始月份" value={scenario.basics.salaryStartsMonth} onChange={(value) => patchBasics({ salaryStartsMonth: value })} baseMonth={scenario.meta.baseMonth} horizon={scenario.basics.monthsToProject} disabled={readonlyShared} />
                  <Field label="每月租屋補貼" value={scenario.basics.monthlySubsidy} onChange={(value) => patchBasics({ monthlySubsidy: value })} suffix="元" disabled={readonlyShared} />
                  <MonthPicker label="補貼開始月份" value={scenario.basics.subsidyStartsMonth} onChange={(value) => patchBasics({ subsidyStartsMonth: value })} baseMonth={scenario.meta.baseMonth} horizon={scenario.basics.monthsToProject} disabled={readonlyShared} />
                </div>
              </SettingsGroup>

              <SettingsGroup title="每月固定支出" accent="#dc2626" last>
                <div className={inputGridClassName}>
                  <Field label="每月房租" value={scenario.basics.monthlyRent} onChange={(value) => patchBasics({ monthlyRent: value })} suffix="元" disabled={readonlyShared} />
                  <Field label="每月生活費" value={scenario.basics.monthlyLivingCost} onChange={(value) => patchBasics({ monthlyLivingCost: value })} suffix="元" disabled={readonlyShared} />
                  <Field label="每月學貸" value={scenario.basics.monthlyStudentLoan} onChange={(value) => patchBasics({ monthlyStudentLoan: value })} suffix="元" disabled={readonlyShared} />
                </div>
              </SettingsGroup>
            </InteractiveSurface>

            <InteractiveSurface as="section" style={styles.card} hoverClassName="flowra-hover-card">
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => setIsOneTimeOpen((value) => !value)}
                  aria-expanded={isOneTimeOpen}
                  style={sectionToggleStyle}
                >
                  <Chevron open={isOneTimeOpen} />
                  <span>一次性收入 / 支出</span>
                  <CountPill count={scenario.oneTimeItems.length} />
                </button>
                <InteractiveButton variant="smallButton" onClick={addOneTimeItem} disabled={readonlyShared}>
                  + 新增
                </InteractiveButton>
              </div>
              <Collapsible open={isOneTimeOpen}>
                {scenario.oneTimeItems.length === 0
                  ? (
                    <div style={{ ...styles.mutedBox, marginTop: 0, textAlign: "center", color: "#64748b", fontSize: "13px" }}>
                      尚未新增任何一次性收支，按右上「+ 新增」開始。
                    </div>
                  )
                  : (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleOneTimeDragEnd}>
                    <SortableContext items={scenario.oneTimeItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                      {scenario.oneTimeItems.map((item) => {
                        const itemIsOpen = Boolean(openOneTimeItemIds[item.id]);
                        const isIncome = item.type === "income";
                        const accent = isIncome ? "#16a34a" : "#dc2626";
                        const categoryMeta = CATEGORY_META[item.category] || CATEGORY_META.other;
                        const chipColor = isIncome ? "#15803d" : categoryMeta.color;
                        return (
                          <SortableItemShell key={item.id} id={item.id}>
                            <div style={{ ...styles.item, borderLeft: `4px solid ${accent}`, padding: "10px 12px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                <button
                                  type="button"
                                  onClick={() => setOpenOneTimeItemIds((current) => ({ ...current, [item.id]: !current[item.id] }))}
                                  aria-expanded={itemIsOpen}
                                  style={itemToggleStyle}
                                >
                                  <Chevron open={itemIsOpen} />
                                  <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: 1 }}>
                                    <span style={{ fontWeight: 800, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
                                    <span style={{ fontSize: "12px", color: "#475569", display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                                      <span style={{ fontWeight: 800, color: accent }}>
                                        {isIncome ? "+" : "−"}{maskCurrency(item.amount, hiddenAmounts)}
                                      </span>
                                      <span style={{ color: "#cbd5e1" }}>·</span>
                                      <span>{formatMonthLabel(item.month, true)}</span>
                                      <span style={{ color: "#cbd5e1" }}>·</span>
                                      <span style={{ ...styles.chip, padding: "1px 8px", fontSize: "11px", color: chipColor, borderColor: `${chipColor}33`, background: `${chipColor}10` }}>
                                        {isIncome ? "收入" : categoryMeta.label}
                                      </span>
                                    </span>
                                  </div>
                                </button>
                                <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                                  <InteractiveButton variant="tinyButton" onClick={() => duplicateOneTimeItem(item.id)} disabled={readonlyShared}>
                                    複製
                                  </InteractiveButton>
                                  <InteractiveButton variant="dangerButton" style={{ padding: "5px 10px", borderRadius: "999px" }} onClick={() => removeOneTimeItem(item.id)} disabled={readonlyShared}>
                                    刪
                                  </InteractiveButton>
                                </div>
                              </div>
                              <Collapsible open={itemIsOpen}>
                                <div style={{ paddingTop: "12px", borderTop: "1px dashed #e2e8f0" }}>
                                  <TextField label="項目名稱" value={item.name} onChange={(value) => updateOneTimeItem(item.id, { name: value })} disabled={readonlyShared} />
                                  <div className={`${inputGridClassName} mt-2.5`}>
                                    <Field label="金額" value={item.amount} onChange={(value) => updateOneTimeItem(item.id, { amount: value })} step={1000} disabled={readonlyShared} />
                                    <MonthPicker
                                      label="月份"
                                      value={item.month}
                                      onChange={(value) => updateOneTimeItem(item.id, { month: value })}
                                      baseMonth={scenario.meta.baseMonth}
                                      horizon={scenario.basics.monthsToProject}
                                      disabled={readonlyShared}
                                    />
                                    <div>
                                      <label style={styles.label}>類型</label>
                                      <InteractiveSelect value={item.type} disabled={readonlyShared} onChange={(event) => updateOneTimeItem(item.id, { type: event.target.value })}>
                                        <option value="income">收入</option>
                                        <option value="expense">支出</option>
                                      </InteractiveSelect>
                                    </div>
                                    <div>
                                      <label style={styles.label}>分類</label>
                                      <InteractiveSelect value={item.category} disabled={readonlyShared} onChange={(event) => updateOneTimeItem(item.id, { category: event.target.value })}>
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
                )}
              </Collapsible>
            </InteractiveSurface>

            <InteractiveSurface as="section" style={styles.card} hoverClassName="flowra-hover-card">
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => setIsInstallmentsOpen((value) => !value)}
                  aria-expanded={isInstallmentsOpen}
                  style={sectionToggleStyle}
                >
                  <Chevron open={isInstallmentsOpen} />
                  <span>分期帳單</span>
                  <CountPill count={installmentRows.length} />
                </button>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <InteractiveButton variant="smallButton" onClick={() => setIsBulkImportOpen((value) => !value)} disabled={readonlyShared}>
                    批次匯入
                  </InteractiveButton>
                  <InteractiveButton variant="smallButton" onClick={addInstallment} disabled={readonlyShared}>
                    + 新增
                  </InteractiveButton>
                </div>
              </div>
              <Collapsible open={isInstallmentsOpen}>
                {installmentRows.length === 0
                  ? (
                    <div style={{ ...styles.mutedBox, marginTop: 0, textAlign: "center", color: "#64748b", fontSize: "13px" }}>
                      尚未新增分期帳單，可按「+ 新增」或「批次匯入」開始。
                    </div>
                  )
                  : (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleInstallmentDragEnd}>
                    <SortableContext items={installmentRows.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                      {installmentRows.map((item) => {
                        const itemIsOpen = Boolean(openInstallmentItemIds[item.id]);
                        const endMonth = addMonths(item.startMonth, item.terms - 1);
                        return (
                          <SortableItemShell key={item.id} id={item.id}>
                            <div style={{ ...styles.item, borderLeft: "4px solid #0284c7", padding: "10px 12px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                <button
                                  type="button"
                                  onClick={() => setOpenInstallmentItemIds((current) => ({ ...current, [item.id]: !current[item.id] }))}
                                  aria-expanded={itemIsOpen}
                                  style={itemToggleStyle}
                                >
                                  <Chevron open={itemIsOpen} />
                                  <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: 1 }}>
                                    <span style={{ fontWeight: 800, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
                                    <span style={{ fontSize: "12px", color: "#475569", display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                                      <span style={{ fontWeight: 800, color: "#0284c7" }}>
                                        月付 {maskCurrency(item.payment, hiddenAmounts)}
                                      </span>
                                      <span style={{ color: "#cbd5e1" }}>·</span>
                                      <span>{item.terms} 期</span>
                                      <span style={{ color: "#cbd5e1" }}>·</span>
                                      <span>{formatMonthLabel(item.startMonth, true)} → {formatMonthLabel(endMonth, true)}</span>
                                    </span>
                                  </div>
                                </button>
                                <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                                  <InteractiveButton variant="tinyButton" onClick={() => duplicateInstallment(item.id)} disabled={readonlyShared}>
                                    複製
                                  </InteractiveButton>
                                  <InteractiveButton variant="dangerButton" style={{ padding: "5px 10px", borderRadius: "999px" }} onClick={() => removeInstallment(item.id)} disabled={readonlyShared}>
                                    刪
                                  </InteractiveButton>
                                </div>
                              </div>
                              <Collapsible open={itemIsOpen}>
                                <div style={{ paddingTop: "12px", borderTop: "1px dashed #e2e8f0" }}>
                                  <TextField label="項目名稱" value={item.name} onChange={(value) => updateInstallment(item.id, { name: value })} disabled={readonlyShared} />
                                  <div className={`${inputGridClassName} mt-2.5`}>
                                    <Field label="本金" value={item.principal} onChange={(value) => updateInstallment(item.id, { principal: value })} disabled={readonlyShared} />
                                    <Field label="年百分率 APR" value={item.apr} onChange={(value) => updateInstallment(item.id, { apr: value })} suffix="%" step={1} disabled={readonlyShared} />
                                    <Field label="期數" value={item.terms} onChange={(value) => updateInstallment(item.id, { terms: Math.max(1, Math.round(value)) })} step={1} min={1} disabled={readonlyShared} />
                                    <MonthPicker
                                      label="開始月份"
                                      value={item.startMonth}
                                      onChange={(value) => updateInstallment(item.id, { startMonth: value })}
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
                                      <strong>{maskCurrency(item.totalPaid, hiddenAmounts)}</strong>
                                    </div>
                                    <div>
                                      <div style={styles.statLabel}>利息</div>
                                      <strong>{maskCurrency(item.interest, hiddenAmounts)}</strong>
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
                )}
              </Collapsible>
            </InteractiveSurface>

            <InteractiveSurface as="section" style={styles.card} hoverClassName="flowra-hover-card">
              <h2 style={styles.cardTitle}>匯入 / 備份 / 匯出</h2>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "flex-start" }}>
                <InteractiveButton onClick={() => syncScenarioToCloud()} disabled={!cloudFeaturesEnabled}>
                  同步備份
                </InteractiveButton>
                <InteractiveButton onClick={() => refreshCloudBackup({ applyPayload: true })} disabled={!cloudFeaturesEnabled || isCloudBackupLoading}>
                  {isCloudBackupLoading ? "還原中..." : "還原最近備份"}
                </InteractiveButton>
                <InteractiveButton onClick={() => fileInputRef.current?.click()}>
                  匯入資料
                </InteractiveButton>
                <div style={{ position: "relative" }}>
                  <InteractiveButton onClick={() => setIsExportMenuOpen((value) => !value)} aria-expanded={isExportMenuOpen}>
                    匯出
                  </InteractiveButton>
                  {isExportMenuOpen ? (
                    <FloatingSurface style={styles.dropdownMenu} motionClassName="flowra-surface-enter">
                      <InteractiveButton variant="dropdownItem" onClick={() => { setIsExportMenuOpen(false); exportPng(); }}>
                        下載整頁圖片
                      </InteractiveButton>
                      <InteractiveButton variant="dropdownItem" onClick={() => { setIsExportMenuOpen(false); exportPdf(); }}>
                        下載報表
                      </InteractiveButton>
                      <InteractiveButton variant="dropdownItem" onClick={() => { setIsExportMenuOpen(false); exportExcel(); }}>
                        下載表格檔
                      </InteractiveButton>
                      <InteractiveButton variant="dropdownItem" onClick={() => { setIsExportMenuOpen(false); exportJson(); }}>
                        下載完整資料
                      </InteractiveButton>
                      <InteractiveButton variant="dropdownItem" onClick={() => { setIsExportMenuOpen(false); printReport(); }}>
                        列印
                      </InteractiveButton>
                    </FloatingSurface>
                  ) : null}
                </div>
              </div>
              <input ref={fileInputRef} type="file" accept="application/json" onChange={importJson} style={{ display: "none" }} />
              <div style={{ ...styles.mutedBox, marginTop: "12px" }}>
                <div style={{ ...styles.metaText, marginTop: "6px" }}>
                  雲端備份狀態：
                  {cloudSyncStatus === "syncing" ? "同步中" : null}
                  {cloudSyncStatus === "pending" ? "內容已變更，尚未重新同步" : null}
                  {cloudSyncStatus === "synced" ? "已同步備份" : null}
                  {cloudSyncStatus === "idle" ? "尚未同步備份" : null}
                </div>
                <div style={{ ...styles.metaText, marginTop: "6px" }}>最近雲端備份：{formatTimestamp(cloudBackupUpdatedAt)}</div>
                <div style={{ ...styles.metaText, marginTop: "6px" }}>最近開啟：{lastOpenedAtLabel}</div>
                <div style={{ ...styles.metaText, marginTop: "6px" }}>最近嘗試同步：{lastSyncAttemptAtLabel}</div>
                <div style={{ ...styles.metaText, marginTop: "6px" }}>最近同步備份：{lastSyncedAtLabel}</div>
                <div style={{ ...styles.metaText, marginTop: "6px" }}>{cloudAuthMessage}</div>
                <div style={{ ...styles.metaText, marginTop: "6px" }}>{cloudSetupMessage}</div>
                {cloudNotice ? (
                  <div style={{ ...styles.metaText, marginTop: "6px" }}>{cloudNotice}</div>
                ) : null}
                <div style={{ marginTop: "12px", padding: "14px", borderRadius: "14px", border: "1px solid #e2e8f0", background: "#ffffff" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flex: 1 }}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#94a3b8", flexShrink: 0 }} aria-hidden="true">
                        <circle cx="8" cy="6" r="2.6" />
                        <path d="M2.5 13.5 C3.5 10.8 5.6 9.6 8 9.6 C10.4 9.6 12.5 10.8 13.5 13.5" />
                      </svg>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a", flexShrink: 0 }}>帳號</span>
                      <span style={{ fontSize: "12px", color: cloudAuthState === "authenticated" ? "#475569" : "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                        {cloudAuthState === "authenticated"
                          ? (cloudUserEmail || "已登入")
                          : cloudAuthState === "checking"
                            ? "確認中…"
                            : "尚未登入"}
                      </span>
                    </div>
                    {cloudAuthState === "authenticated" ? (
                      <InteractiveButton variant="smallButton" onClick={signOutFromSupabase} style={{ flexShrink: 0 }}>
                        登出
                      </InteractiveButton>
                    ) : null}
                  </div>
                  {cloudAuthState === "authenticated" ? (
                    <div style={{ ...styles.metaText, fontSize: "12px", margin: 0 }}>已連線，可直接同步備份或還原最近備份。</div>
                  ) : (
                    <>
                      <div style={{ ...styles.metaText, fontSize: "12px", margin: "0 0 8px" }}>輸入信箱寄送驗證信；完成登入後此頁會自動更新狀態。</div>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "stretch" }}>
                        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                          <InteractiveInput
                            type="email"
                            placeholder="email@example.com"
                            value={authEmailInput}
                            disabled={!supabaseReady || isSendingMagicLink}
                            onChange={(event) => setAuthEmailInput(event.target.value)}
                          />
                        </div>
                        <InteractiveButton
                          onClick={sendMagicLink}
                          disabled={!supabaseReady || isSendingMagicLink || !authEmailInput.trim()}
                          style={{ flexShrink: 0 }}
                        >
                          {isSendingMagicLink ? "寄送中…" : "寄送驗證信"}
                        </InteractiveButton>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </InteractiveSurface>

          </div>

          <div>
            <InteractiveSurface as="section" style={{ ...styles.card, position: "relative" }} hoverClassName="flowra-hover-card" className="flowra-print-card" ref={trendChartRef}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", marginBottom: "8px" }}>
                <h2 style={styles.cardTitle}>月底現金趨勢</h2>
                <InteractiveButton
                  variant="smallButton"
                  onClick={() => exportChartPng(trendChartRef, "cash-trend")}
                  className="flowra-no-print"
                  style={{ padding: "8px", borderRadius: "10px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
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
                onSelectMonth={setSelectedMonthKey}
              />
            </InteractiveSurface>

            <InteractiveSurface as="section" style={{ ...styles.card, position: "relative" }} hoverClassName="flowra-hover-card" className="flowra-print-card" ref={incomeChartRef}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", marginBottom: "8px" }}>
                <h2 style={styles.cardTitle}>每月收入與支出</h2>
                <InteractiveButton
                  variant="smallButton"
                  onClick={() => exportChartPng(incomeChartRef, "income-expense")}
                  className="flowra-no-print"
                  style={{ padding: "8px", borderRadius: "10px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                  title="下載圖片"
                  aria-label="下載圖片"
                >
                  <DownloadIcon />
                </InteractiveButton>
              </div>
              <IncomeExpenseChart rows={rows} onSelectMonth={focusCompositionMonth} selectedMonthKey={selectedMonthKey} />
            </InteractiveSurface>

            <InteractiveSurface as="section" style={{ ...styles.card, position: "relative" }} hoverClassName="flowra-hover-card" className="flowra-print-card" ref={compositionChartRef}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", marginBottom: "8px" }}>
                <h2 style={styles.cardTitle}>支出組成堆疊面積圖</h2>
                <InteractiveButton
                  variant="smallButton"
                  onClick={() => exportChartPng(compositionChartRef, "expense-composition")}
                  className="flowra-no-print"
                  style={{ padding: "8px", borderRadius: "10px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
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

        <InteractiveSurface as="section" style={{ ...styles.card, position: "relative", marginTop: "20px" }} hoverClassName="flowra-hover-card" className="flowra-print-card" ref={monthDetailRef}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", marginBottom: "8px" }}>
            <h2 style={{ ...styles.cardTitle, margin: 0 }}>月度明細</h2>
            <InteractiveButton
              variant="smallButton"
              onClick={() => exportChartPng(monthDetailRef, "month-detail")}
              className="flowra-no-print"
              style={{ padding: "8px", borderRadius: "10px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              title="下載圖片"
              aria-label="下載圖片"
            >
              <DownloadIcon />
            </InteractiveButton>
          </div>
          <MonthDetailTable rows={rows} selectedMonthKey={selectedMonthKey} hidden={hiddenAmounts} mobile={mobile} monthRefs={monthRefs} readonly={readonlyShared} />
        </InteractiveSurface>
        {isBulkImportOpen ? (
          <div style={styles.modalBackdrop} className="flowra-no-print" onClick={() => setIsBulkImportOpen(false)}>
            <FloatingSurface style={styles.modalCard} motionClassName="flowra-surface-enter" onClick={(event) => event.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", marginBottom: "12px" }}>
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
              <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center", marginTop: "10px", flexWrap: "wrap" }}>
                <span style={styles.metaText}>支援 `YYYY-MM`、`下個月`、`再下個月`。解析失敗會保留原文方便修正。</span>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <InteractiveButton onClick={previewBulkInstallments} disabled={readonlyShared}>
                    預覽解析
                  </InteractiveButton>
                  <InteractiveButton onClick={importBulkInstallments} disabled={readonlyShared || bulkInstallmentPreview.length === 0 || bulkInstallmentErrors.length > 0}>
                    確認匯入
                  </InteractiveButton>
                </div>
              </div>
              {bulkInstallmentPreview.length ? (
                <div style={{ ...styles.mutedBox, marginTop: "12px" }}>
                  <div style={{ ...styles.label, marginBottom: "8px" }}>預覽通過 {bulkInstallmentPreview.length} 筆</div>
                  <div style={{ display: "grid", gap: "8px", maxHeight: "180px", overflow: "auto" }}>
                    {bulkInstallmentPreview.map((item) => (
                      <div key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "12px", color: "#334155" }}>
                        <span>{item.name}</span>
                        <span>
                          {currency(item.principal)} / {item.apr}% / {item.terms} 期 / {item.startMonth}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {bulkInstallmentErrors.length ? (
                <div style={{ marginTop: "12px", display: "grid", gap: "8px", maxHeight: "220px", overflow: "auto" }}>
                  {bulkInstallmentErrors.map((error) => (
                    <div key={`${error.lineNumber}-${error.line}`} style={{ borderRadius: "12px", background: "#fff1f2", border: "1px solid #fecdd3", padding: "10px", color: "#be123c", fontSize: "12px" }}>
                      第 {error.lineNumber} 行：{error.message}
                      <div style={{ marginTop: "4px", color: "#881337" }}>{error.line}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </FloatingSurface>
          </div>
        ) : null}
      </div>
    </div>
  );
}
