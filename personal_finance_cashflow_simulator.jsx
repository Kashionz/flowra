import React, { useEffect, useMemo, useRef, useState } from "react";
import "./styles/flowra.css";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import QRCode from "qrcode";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CHART_COLORS, CHART_THEME_VARS, ChartSurface, ChartTooltip, ChartTooltipCard } from "./components/ui/chart.jsx";
import { TEMPLATE_DEFINITIONS } from "./lib/templates/index.js";
import {
  checkFlowraCloudSetup,
  createFlowraSupabaseClient,
  createShortShareLink,
  getCurrentSupabaseUser,
  getSupabaseConfigHint,
  isSupabaseConfigured,
  listCloudScenarios,
  resolveShortShareLink,
  sendSupabaseMagicLink,
  signOutSupabase,
  upsertCloudScenario,
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
const STORAGE_SESSION_META_KEY = "flowra.cashflow.session-meta";
const SESSION_META_DEFAULT = {
  lastOpenedAt: "",
  lastSyncedAt: "",
  lastSyncAttemptAt: "",
};
const CATEGORY_META = {
  medical: { label: "醫療", color: "#dc2626" },
  travel: { label: "旅遊", color: "#2563eb" },
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

function createTemplateScenario(templateKey = "roommate") {
  const baseMonth = currentBaseMonth();
  const template = TEMPLATE_DEFINITIONS[templateKey] || TEMPLATE_DEFINITIONS.roommate;
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
  return createTemplateScenario("roommate");
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
      meta: {
        ...template.meta,
        ...(raw.meta || {}),
        updatedAt: raw.meta?.updatedAt || new Date().toISOString(),
      },
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
    meta: {
      name: raw.name || "升級後情境",
      description: "由舊版 month index 自動轉換",
      baseMonth,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
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
    return { ok: false, message: "JSON 內容不是有效的情境物件。" };
  }

  if (raw.schemaVersion == null) {
    return { ok: true, mode: "legacy" };
  }

  if (typeof raw.schemaVersion !== "number") {
    return { ok: false, message: "schemaVersion 格式不正確。" };
  }

  if (raw.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, message: `這份 JSON 來自較新的資料版本（v${raw.schemaVersion}），目前只支援到 v${SCHEMA_VERSION}。` };
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

function encodeScenarioShare(scenario, readonly) {
  const payload = toPersistedScenario(scenario);
  const encoded = compressToEncodedURIComponent(JSON.stringify(payload));
  const url = new URL(window.location.href);
  url.searchParams.set("state", encoded);
  if (readonly) {
    url.searchParams.set("readonly", "1");
  } else {
    url.searchParams.delete("readonly");
  }
  return { url: url.toString(), length: encoded.length };
}

function decodeScenarioShare() {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get("state");
  if (!encoded) return null;
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    return {
      scenario: migrateLegacyScenario(JSON.parse(json)),
      readonly: params.get("readonly") === "1",
    };
  } catch (error) {
    return null;
  }
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
                fill={active ? "#1d4ed8" : CHART_COLORS.balance}
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
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
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

function SortableItemShell({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
    touchAction: "none",
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
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
        >
          ⋮⋮
        </button>
        <div style={{ flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

function getButtonVariantStyles(variant) {
  if (variant === "button") {
    return {
      base: styles.button,
      hover: styles.buttonHover,
      focus: { ...styles.inputFocus, transform: "translateY(-1px)" },
      active: { transform: "translateY(0)", boxShadow: "0 7px 16px rgba(37,99,235,0.12)", border: "1px solid #93c5fd" },
    };
  }
  if (variant === "smallButton") {
    return {
      base: styles.smallButton,
      hover: styles.smallButtonHover,
      focus: styles.inputFocus,
      active: { transform: "translateY(0)", boxShadow: "0 4px 12px rgba(15,23,42,0.08)", border: "1px solid #cbd5e1" },
    };
  }
  if (variant === "tinyButton") {
    return {
      base: styles.tinyButton,
      hover: styles.tinyButtonHover,
      focus: styles.inputFocus,
      active: { transform: "translateY(0)", boxShadow: "0 3px 10px rgba(15,23,42,0.08)", border: "1px solid #cbd5e1" },
    };
  }
  if (variant === "pillButton") {
    return {
      base: styles.pillButton,
      hover: { transform: "translateY(-1px)", boxShadow: "0 8px 18px rgba(15,23,42,0.06)", border: "1px solid #cbd5e1", background: "#f8fbff" },
      focus: styles.inputFocus,
      active: { transform: "translateY(0)", boxShadow: "0 3px 10px rgba(15,23,42,0.06)" },
    };
  }
  if (variant === "activePill") {
    return {
      base: styles.activePill,
      hover: { transform: "translateY(-1px)", boxShadow: "0 10px 20px rgba(37,99,235,0.12)", background: "#bfdbfe", border: "1px solid #60a5fa" },
      focus: styles.inputFocus,
      active: { transform: "translateY(0)", boxShadow: "0 4px 12px rgba(37,99,235,0.1)" },
    };
  }
  if (variant === "dropdownItem") {
    return {
      base: styles.dropdownItem,
      hover: { transform: "translateY(-1px)", boxShadow: "0 10px 18px rgba(15,23,42,0.08)", background: "#eff6ff" },
      focus: styles.inputFocus,
      active: { transform: "translateY(0)", boxShadow: "0 4px 10px rgba(15,23,42,0.06)", background: "#dbeafe" },
    };
  }
  if (variant === "dangerButton") {
    return {
      base: styles.dangerButton,
      hover: { transform: "translateY(-1px)", boxShadow: "0 10px 18px rgba(190,24,93,0.08)", background: "#ffe4e6", border: "1px solid #fda4af" },
      focus: styles.inputFocus,
      active: { transform: "translateY(0)", boxShadow: "0 4px 10px rgba(190,24,93,0.06)" },
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
              color: isFocused ? "#1d4ed8" : styles.numberInput.color,
              background: isHovered || isFocused ? "rgba(239,246,255,0.34)" : "transparent",
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
      <InteractiveInput type={type} value={value} placeholder={placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} style={{ fontWeight: 700 }} />
    </div>
  );
}

function MonthPicker({ label, value, onChange, baseMonth, horizon, disabled, showRelative = false }) {
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
        <InteractiveSelect value={parsed.year} disabled={disabled} onChange={(event) => changeYear(Number(event.target.value))}>
          {years.map((year) => (
            <option key={year} value={year}>
              {year} 年
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
      {showRelative ? (
        <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
          <InteractiveButton variant="tinyButton" disabled={disabled} onClick={() => onChange(addMonths(baseMonth, 1))}>
            下個月
          </InteractiveButton>
          <InteractiveButton variant="tinyButton" disabled={disabled} onClick={() => onChange(addMonths(baseMonth, 2))}>
            再下個月
          </InteractiveButton>
        </div>
      ) : null}
    </div>
  );
}

function BaseMonthPicker({ value, onChange, disabled }) {
  const parsed = parseYearMonth(value);
  const years = Array.from({ length: 7 }, (_, index) => parsed.year - 2 + index);
  return (
    <div>
      <label style={styles.label}>試算起始月</label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
        <InteractiveSelect value={parsed.year} disabled={disabled} onChange={(event) => onChange(formatYearMonth(Number(event.target.value), parsed.month))}>
          {years.map((year) => (
            <option key={year} value={year}>
              {year} 年
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

function MonthDetailTable({ rows, selectedMonthKey, hidden, mobile, monthRefs, readonly }) {
  if (!rows.length) return <EmptyChartState />;

  if (mobile) {
    return (
      <div style={{ display: "grid", gap: "12px" }}>
        {rows.map((row, index) => {
          const active = row.monthKey === selectedMonthKey;
          return (
            <div
              key={row.monthKey}
              ref={(node) => {
                monthRefs.current[row.monthKey] = node;
              }}
              style={{
                border: active ? "2px solid #2563eb" : "1px solid #dbe4ee",
                borderRadius: "20px",
                padding: "15px",
                background: active ? "#eff6ff" : index % 2 === 0 ? "rgba(255,255,255,0.96)" : "#f8fbff",
                boxShadow: active ? "0 12px 26px rgba(37,99,235,0.08)" : "0 6px 16px rgba(15,23,42,0.04)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginBottom: "10px" }}>
                <strong>{row.fullLabel}</strong>
                <span style={{ color: row.net < 0 ? "#dc2626" : "#047857", fontWeight: 800 }}>{hidden ? "★★★" : `${row.net < 0 ? "-" : "+"}NT$ ${currency(Math.abs(row.net))}`}</span>
              </div>
              <div style={styles.mobileMetrics}>
                <div>月初：{maskCurrency(row.startBalance, hidden)}</div>
                <div>收入：{maskCurrency(row.income, hidden)}</div>
                <div>支出：{maskCurrency(row.expense, hidden)}</div>
                <div>月底：{maskCurrency(row.balance, hidden)}</div>
              </div>
              <div style={{ marginTop: "10px" }}>
                <div style={styles.label}>一次支出分類</div>
                <OneTimePreview row={row} hidden={hidden} />
              </div>
              {readonly ? <div style={styles.readonlyBadge}>唯讀分享</div> : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={{ ...styles.th, textAlign: "left" }}>月份</th>
            <th style={styles.th}>月初現金</th>
            <th style={styles.th}>薪資</th>
            <th style={styles.th}>補貼</th>
            <th style={styles.th}>一次收入</th>
            <th style={styles.th}>房租</th>
            <th style={styles.th}>生活費</th>
            <th style={styles.th}>學貸</th>
            <th style={styles.th}>一次支出分類</th>
            <th style={styles.th}>分期</th>
            <th style={styles.th}>月淨額</th>
            <th style={styles.th}>月底現金</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const active = row.monthKey === selectedMonthKey;
            return (
              <InteractiveSurface
                as="tr"
                key={row.monthKey}
                ref={(node) => {
                  monthRefs.current[row.monthKey] = node;
                }}
                style={{ ...styles.tableRow, background: active ? "#eff6ff" : index % 2 === 0 ? "white" : "#fbfdff" }}
                className={joinClassNames("flowra-table-row", active ? "is-active" : "")}
              >
                <td style={{ ...styles.td, textAlign: "left", fontWeight: 700 }}>{row.fullLabel}</td>
                <td style={styles.td}>{hidden ? "★★★" : currency(row.startBalance)}</td>
                <td style={styles.td}>{hidden ? "★★★" : currency(row.salary)}</td>
                <td style={styles.td}>{hidden ? "★★★" : currency(row.subsidy)}</td>
                <td style={styles.td}>{hidden ? "★★★" : currency(row.oneTimeIncome)}</td>
                <td style={styles.td}>{hidden ? "★★★" : currency(row.rent)}</td>
                <td style={styles.td}>{hidden ? "★★★" : currency(row.living)}</td>
                <td style={styles.td}>{hidden ? "★★★" : currency(row.studentLoan)}</td>
                <td style={styles.td}>
                  <OneTimePreview row={row} hidden={hidden} />
                </td>
                <td style={styles.td}>{hidden ? "★★★" : currency(row.installments)}</td>
                <td style={{ ...styles.td, fontWeight: 800, color: row.net < 0 ? "#dc2626" : "#047857" }}>{hidden ? "★★★" : currency(row.net)}</td>
                <td style={{ ...styles.td, fontWeight: 800, color: row.balance < 0 ? "#dc2626" : "#0f172a" }}>{hidden ? "★★★" : currency(row.balance)}</td>
              </InteractiveSurface>
            );
          })}
        </tbody>
      </table>
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
    background:
      "radial-gradient(circle at top, rgba(191,219,254,0.55), transparent 30%), linear-gradient(180deg, #f8fbff 0%, #eef4fb 48%, #f8fafc 100%)",
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
    border: "1px solid rgba(191,219,254,0.7)",
    background: "linear-gradient(145deg, rgba(255,255,255,0.9), rgba(239,246,255,0.76))",
    boxShadow: "0 20px 60px rgba(15,23,42,0.07)",
    backdropFilter: "blur(10px)",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    background: "rgba(255,255,255,0.94)",
    border: "1px solid rgba(191,219,254,0.9)",
    borderRadius: "999px",
    padding: "7px 13px",
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    color: "#2563eb",
    boxShadow: "0 10px 28px rgba(37,99,235,0.07)",
    textTransform: "uppercase",
  },
  title: { fontSize: "clamp(32px, 5vw, 46px)", lineHeight: 1.04, fontWeight: 900, letterSpacing: "-0.03em", margin: "16px 0 10px" },
  subtitle: { maxWidth: "780px", fontSize: "14px", color: "#475569", lineHeight: 1.8, margin: 0 },
  button: {
    border: "1px solid #c7d2fe",
    background: "linear-gradient(180deg, #ffffff 0%, #eff6ff 100%)",
    color: "#1e3a8a",
    borderRadius: "18px",
    padding: "10px 15px",
    cursor: "pointer",
    fontWeight: 800,
    boxShadow: "0 10px 20px rgba(37,99,235,0.08)",
    transition: INTERACTIVE_TRANSITION,
    willChange: INTERACTIVE_WILL_CHANGE,
  },
  buttonHover: { transform: "translateY(-1px)", boxShadow: "0 14px 26px rgba(37,99,235,0.14)", border: "1px solid #93c5fd" },
  smallButton: {
    border: "1px solid #dbe4ee",
    background: "rgba(255,255,255,0.94)",
    color: "#0f172a",
    borderRadius: "14px",
    padding: "8px 12px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "13px",
    boxShadow: "0 6px 18px rgba(15,23,42,0.04)",
    transition: INTERACTIVE_TRANSITION,
    willChange: INTERACTIVE_WILL_CHANGE,
  },
  smallButtonHover: { transform: "translateY(-1px)", boxShadow: "0 10px 22px rgba(15,23,42,0.08)", border: "1px solid #cbd5e1" },
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
  tinyButtonHover: { transform: "translateY(-1px)", boxShadow: "0 8px 18px rgba(15,23,42,0.08)", border: "1px solid #cbd5e1" },
  numberFieldWrap: {
    flex: 1,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 42px",
    alignItems: "stretch",
    minHeight: "42px",
    border: "1px solid #bfdbfe",
    borderRadius: "16px",
    background: "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(248,250,252,0.98) 100%)",
    boxShadow: "inset 0 1px 2px rgba(15,23,42,0.03), 0 8px 18px rgba(37,99,235,0.08)",
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
    fontWeight: 800,
    background: "transparent",
    color: "#0f172a",
  },
  stepperColumn: {
    display: "grid",
    gridTemplateRows: "1fr 1fr",
    borderLeft: "1px solid #bfdbfe",
    background: "linear-gradient(180deg, #eef6ff 0%, #dbeafe 100%)",
  },
  stepperButton: {
    border: "none",
    background: "transparent",
    color: "#1d4ed8",
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
  stepperButtonHover: { background: "rgba(255,255,255,0.52)", color: "#1e40af" },
  stepperButtonTop: {
    borderBottom: "1px solid #bfdbfe",
  },
  stepperButtonBottom: {},
  dragHandle: {
    border: "1px solid #dbe4ee",
    background: "#f8fafc",
    color: "#64748b",
    borderRadius: "12px",
    width: "36px",
    height: "36px",
    cursor: "grab",
    fontWeight: 800,
    fontSize: "16px",
    lineHeight: 1,
    transition: INTERACTIVE_TRANSITION,
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
    border: "1px solid #93c5fd",
    background: "#dbeafe",
    color: "#1d4ed8",
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
    background: "rgba(255,255,255,0.9)",
    borderRadius: "28px",
    border: "1px solid rgba(226,232,240,0.9)",
    boxShadow: "0 16px 38px rgba(15,23,42,0.05)",
    padding: "22px",
    marginBottom: "20px",
    backdropFilter: "blur(12px)",
    transition: INTERACTIVE_TRANSITION,
    willChange: INTERACTIVE_WILL_CHANGE,
  },
  statCard: {
    background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.95) 100%)",
    borderRadius: "24px",
    border: "1px solid rgba(226,232,240,0.92)",
    boxShadow: "0 14px 32px rgba(15,23,42,0.045)",
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
    background: "rgba(255,255,255,0.96)",
    boxShadow: "inset 0 1px 2px rgba(15,23,42,0.03)",
    transition: INTERACTIVE_TRANSITION,
  },
  inputHover: { border: "1px solid #93c5fd", boxShadow: "inset 0 1px 2px rgba(15,23,42,0.03), 0 0 0 3px rgba(191,219,254,0.26)" },
  inputFocus: { border: "1px solid #60a5fa", boxShadow: "inset 0 1px 2px rgba(15,23,42,0.03), 0 0 0 4px rgba(96,165,250,0.22)" },
  select: {
    width: "100%",
    height: "40px",
    border: "1px solid #cbd5e1",
    borderRadius: "14px",
    padding: "8px 12px",
    background: "rgba(255,255,255,0.96)",
    transition: INTERACTIVE_TRANSITION,
  },
  item: {
    border: "1px solid #e2e8f0",
    borderRadius: "20px",
    background: "linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)",
    padding: "14px",
    marginBottom: "12px",
    transition: INTERACTIVE_TRANSITION,
    willChange: INTERACTIVE_WILL_CHANGE,
  },
  mutedBox: { background: "linear-gradient(180deg, #f8fbff 0%, #f8fafc 100%)", borderRadius: "18px", padding: "14px", marginTop: "12px", border: "1px solid #e2e8f0" },
  miniGrid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px", fontSize: "12px" },
  alert: { display: "flex", gap: "12px", background: "linear-gradient(180deg, #fff8f8 0%, #fff1f2 100%)", border: "1px solid #fecdd3", color: "#be123c", padding: "16px 18px", borderRadius: "22px", marginBottom: "24px", boxShadow: "0 12px 28px rgba(190,24,93,0.06)" },
  tableWrap: { overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: "22px", background: "white", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7)" },
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
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.14)",
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
    boxShadow: "0 24px 60px rgba(15,23,42,0.18)",
    padding: "14px",
    zIndex: 30,
  },
  readonlyBadge: { marginTop: "10px", display: "inline-block", borderRadius: "999px", padding: "5px 9px", background: "#eff6ff", color: "#1d4ed8", fontSize: "11px", fontWeight: 800 },
  mobileMetrics: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px", fontSize: "13px", color: "#334155" },
  modalBackdrop: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.48)", display: "grid", placeItems: "center", padding: "20px", zIndex: 50 },
  modalCard: {
    width: "min(680px, 100%)",
    background: "white",
    borderRadius: "24px",
    border: "1px solid #dbe4ee",
    boxShadow: "0 24px 60px rgba(15,23,42,0.2)",
    padding: "20px",
  },
};

export default function PersonalFinanceCashflowSimulator() {
  const shared = useMemo(() => decodeScenarioShare(), []);
  const [scenario, setScenario] = useState(() => {
    if (shared?.scenario) return shared.scenario;
    return createDefaultScenario();
  });
  const [sessionMeta, setSessionMeta] = useState(() => readSessionMeta());
  const [cloudScenarioId, setCloudScenarioId] = useState("");
  const [selectedMonthKey, setSelectedMonthKey] = useState("");
  const [expenseMode, setExpenseMode] = useState("absolute");
  const [expenseView, setExpenseView] = useState("group");
  const [readonlyShared, setReadonlyShared] = useState(Boolean(shared?.readonly));
  const [isOneTimeOpen, setIsOneTimeOpen] = useState(false);
  const [isInstallmentsOpen, setIsInstallmentsOpen] = useState(false);
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
  const [openOneTimeItemIds, setOpenOneTimeItemIds] = useState({});
  const [openInstallmentItemIds, setOpenInstallmentItemIds] = useState({});
  const [shareNotice, setShareNotice] = useState("");
  const [shareReadonly, setShareReadonly] = useState(true);
  const [shareTab, setShareTab] = useState("url");
  const [shortShareUrl, setShortShareUrl] = useState("");
  const [shortShareSnapshotKey, setShortShareSnapshotKey] = useState("");
  const [shareQrUrl, setShareQrUrl] = useState("");
  const [cloudNotice, setCloudNotice] = useState("");
  const [cloudSyncStatus, setCloudSyncStatus] = useState("idle");
  const [cloudAuthState, setCloudAuthState] = useState(() => (isSupabaseConfigured() ? "checking" : "unconfigured"));
  const [cloudSetupState, setCloudSetupState] = useState(() => (isSupabaseConfigured() ? "checking" : "unconfigured"));
  const [cloudUserEmail, setCloudUserEmail] = useState("");
  const [authEmailInput, setAuthEmailInput] = useState("");
  const [isSendingMagicLink, setIsSendingMagicLink] = useState(false);
  const [cloudScenarios, setCloudScenarios] = useState([]);
  const [selectedCloudScenarioId, setSelectedCloudScenarioId] = useState("");
  const [isCloudListLoading, setIsCloudListLoading] = useState(false);
  const [isSharePopoverOpen, setIsSharePopoverOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isPreparingPdf, setIsPreparingPdf] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === "undefined" ? 1200 : window.innerWidth));
  const [bulkInstallmentText, setBulkInstallmentText] = useState("");
  const [bulkInstallmentErrors, setBulkInstallmentErrors] = useState([]);
  const [bulkInstallmentPreview, setBulkInstallmentPreview] = useState([]);
  const monthRefs = useRef({});
  const fileInputRef = useRef(null);
  const sharePopoverRef = useRef(null);
  const cloudHydratedRef = useRef(false);
  const scenarioInitializedRef = useRef(false);
  const skipNextScenarioDirtyRef = useRef(false);
  const reportRef = useRef(null);
  const trendChartRef = useRef(null);
  const incomeChartRef = useRef(null);
  const compositionChartRef = useRef(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const mobile = viewportWidth < 860;
  const hiddenAmounts = false;
  const supabaseReady = useMemo(() => isSupabaseConfigured(), []);
  const standardShare = useMemo(() => {
    if (typeof window === "undefined") return { url: "", length: 0 };
    return encodeScenarioShare(scenario, shareReadonly);
  }, [scenario, shareReadonly]);
  const shareUrl = standardShare.url;
  const currentShareSnapshotKey = `${scenario.meta.updatedAt || ""}|${shareReadonly ? "readonly" : "editable"}`;
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
    const source = shareTab === "url" ? shareUrl : shortShareUrl;
    if (!source) {
      setShareQrUrl("");
      return;
    }

    let cancelled = false;
    QRCode.toDataURL(source, {
      width: 180,
      margin: 1,
      color: {
        dark: "#0f172a",
        light: "#ffffff",
      },
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setShareQrUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setShareQrUrl("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [shareTab, shareUrl, shortShareUrl]);

  useEffect(() => {
    if (!shareUrl) {
      setShareNotice("");
      return;
    }
    setShareNotice(
      standardShare.length > 1800
        ? (supabaseReady ? "URL 已超過 1800 字，複製時會改走短網址。" : "URL 已偏長；若設定 Supabase，建議改用短網址。")
        : "URL 編碼版已即時更新，可直接複製。"
    );
  }, [shareUrl, standardShare.length, supabaseReady]);

  useEffect(() => {
    if (!shortShareUrl || !shortShareSnapshotKey || shortShareSnapshotKey === currentShareSnapshotKey) return;
    setShortShareUrl("");
    setShortShareSnapshotKey("");
    setCloudNotice("目前內容已變更，請重新建立短網址。");
  }, [shortShareSnapshotKey, currentShareSnapshotKey, shortShareUrl]);

  useEffect(() => {
    if (typeof window === "undefined" || shared?.scenario) return undefined;
    const params = new URLSearchParams(window.location.search);
    const slug = params.get("share");
    if (!slug || !supabaseReady) return undefined;

    let cancelled = false;
    resolveShortShareLink(slug).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data?.payload) {
        setCloudNotice(error?.message || "短網址讀取失敗。");
        return;
      }
      transitionApply(data.payload, { markDirty: false });
      setReadonlyShared(Boolean(data.readonly));
      setCloudSyncStatus("idle");
      setCloudNotice(`已載入短網址 ${slug}`);
    });

    return () => {
      cancelled = true;
    };
  }, [shared, supabaseReady]);

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
        setIsSharePopoverOpen(false);
        setIsExportMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onPointerDown = (event) => {
      if (sharePopoverRef.current && !sharePopoverRef.current.contains(event.target)) {
        setIsSharePopoverOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
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

      const { data: cloudItems, error: cloudError } = await listCloudScenarios();
      if (cancelled || cloudError || !Array.isArray(cloudItems) || cloudItems.length === 0) return;

      const latestCloud = cloudItems[0];
      const localUpdatedAt = new Date(scenario.meta.updatedAt || 0).getTime();
      const cloudUpdatedAt = new Date(latestCloud.updated_at || 0).getTime();
      if (!latestCloud.payload || !cloudUpdatedAt) return;

      const shouldOfferLatestCloud = cloudSyncStatus === "idle" || cloudUpdatedAt > localUpdatedAt;
      if (!shouldOfferLatestCloud) return;

      const promptMessage =
        cloudSyncStatus === "idle"
          ? `已找到雲端版本「${latestCloud.name}」，是否直接載入？`
          : `雲端有較新的版本「${latestCloud.name}」，是否載入這個版本？`;
      const confirmed = window.confirm(promptMessage);
      if (!confirmed) return;
      transitionApply(latestCloud.payload, { markDirty: false });
      setCloudScenarioId(latestCloud.id || "");
      setCloudSyncStatus("synced");
      setCloudNotice(`已載入雲端最新版「${latestCloud.name}」。`);
    });

    return () => {
      cancelled = true;
    };
  }, [supabaseReady, scenario.meta.updatedAt, cloudSyncStatus]);

  useEffect(() => {
    if (cloudAuthState === "authenticated" && cloudScenarios.length === 0) {
      refreshCloudScenarios({ silent: true });
    }
  }, [cloudAuthState]);

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
    anchor.download = `cashflow-${scenario.meta.name}-${scenario.meta.baseMonth}.json`;
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
    XLSX.writeFile(workbook, `cashflow-${scenario.meta.name}-${scenario.meta.baseMonth}.xlsx`);
  };

  const exportPng = async () => {
    if (!reportRef.current) return;
    try {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
      const dataUrl = await toPng(reportRef.current, { pixelRatio: 2, cacheBust: true, backgroundColor: "#ffffff" });
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = `cashflow-${scenario.meta.name}-${scenario.meta.baseMonth}.png`;
      anchor.click();
    } catch (error) {
      window.alert("PNG 匯出失敗，請稍後再試。");
    }
  };

  const exportChartPng = async (targetRef, fileSuffix) => {
    if (!targetRef?.current) return;
    try {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
      const dataUrl = await toPng(targetRef.current, { pixelRatio: 2, cacheBust: true, backgroundColor: "#ffffff" });
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = `cashflow-${scenario.meta.name}-${scenario.meta.baseMonth}-${fileSuffix}.png`;
      anchor.click();
    } catch (error) {
      window.alert("單張圖匯出失敗，請稍後再試。");
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
      pdf.save(`cashflow-${scenario.meta.name}-${scenario.meta.baseMonth}.pdf`);
    } catch (error) {
      window.alert("PDF 匯出失敗，請稍後再試。");
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
      window.alert("JSON 匯入失敗，請確認檔案格式正確。");
    }
    event.target.value = "";
  };

  const buildShare = async () => {
    const next = standardShare;
    if (next.length > 1800 && supabaseReady) {
      setShareNotice("URL 已超過 1800 字，改用短網址模式建立。");
      setShareTab("short");
      await createShortShare();
      return;
    }
    setShareNotice(next.length > 1800 ? "URL 已偏長；若設定 Supabase，建議改用短網址。" : "分享連結已更新，可直接複製。");
    try {
      await navigator.clipboard.writeText(next.url);
    } catch (error) {
      return;
    }
  };

  const createShortShare = async () => {
    if (!supabaseReady) {
      setCloudNotice(getSupabaseConfigHint());
      return;
    }
    if (cloudSetupState !== "ready") {
      setCloudNotice(cloudSetupMessage);
      return;
    }

    try {
      const payload = toPersistedScenario(scenario);
      const { data, error } = await createShortShareLink({ payload, readonly: shareReadonly });
      if (error || !data?.slug) {
        setCloudNotice(error?.message || "短網址建立失敗。");
        return;
      }

      const url = new URL(window.location.href);
      url.searchParams.delete("state");
      url.searchParams.set("share", data.slug);
      if (shareReadonly) {
        url.searchParams.set("readonly", "1");
      } else {
        url.searchParams.delete("readonly");
      }
      const nextUrl = url.toString();
      setShortShareUrl(nextUrl);
      setShortShareSnapshotKey(currentShareSnapshotKey);
      setCloudNotice(`短網址已建立，將於 ${new Date(data.expires_at).toLocaleDateString("zh-TW")} 到期。`);
      try {
        await navigator.clipboard.writeText(nextUrl);
      } catch (error) {
        return;
      }
    } catch (error) {
      setCloudNotice(getErrorMessage(error, "短網址建立失敗。"));
    }
  };

  const sendMagicLink = async () => {
    const email = authEmailInput.trim();
    if (!email) {
      setCloudNotice("請先輸入登入 email。");
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

      setCloudNotice(`登入連結已寄到 ${email}，請在同一台裝置開啟信件完成登入。`);
    } catch (error) {
      setCloudNotice(getErrorMessage(error, "登入連結寄送失敗。"));
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
    setCloudNotice("已登出 Supabase。");
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
        upsertCloudScenario({
          id: cloudScenarioId || undefined,
          name: safePayload.meta?.name || scenario.meta.name,
          description: safePayload.meta?.description || scenario.meta.description,
          baseMonth: safePayload.meta?.baseMonth || scenario.meta.baseMonth,
          payload: safePayload,
        }),
        12000,
        "同步雲端逾時，請確認網路或重新登入 Supabase 後再試。"
      );
      if (error) {
        setCloudSyncStatus("pending");
        setCloudNotice(error.message);
        return { error };
      }
      if (data?.id) {
        setCloudScenarioId(data.id);
      }
      setCloudSyncStatus("synced");
      setSessionMeta(writeSessionMeta({ lastSyncedAt: new Date().toISOString(), lastSyncAttemptAt: attemptAt }));
      setCloudNotice("目前內容已同步到 Supabase 雲端。");
      refreshCloudScenarios({ silent: true });
      return { error: null };
    } catch (error) {
      setCloudSyncStatus("pending");
      const normalizedError = error instanceof Error ? error : new Error("同步雲端失敗。");
      setCloudNotice(normalizedError.message);
      return { error: normalizedError };
    }
  };

  const refreshCloudScenarios = async (options = {}) => {
    const { silent = false } = options;
    if (cloudSetupState !== "ready") {
      if (!silent) {
        setCloudNotice(cloudSetupMessage);
      }
      return;
    }
    if (cloudAuthState !== "authenticated") {
      if (!silent) {
        setCloudNotice("需先登入 Supabase，才能讀取雲端版本。");
      }
      return;
    }
    setIsCloudListLoading(true);
    try {
      const { data, error } = await listCloudScenarios();
      if (error) {
        if (!silent) {
          setCloudNotice(error.message);
        }
        return;
      }
      const items = Array.isArray(data) ? data : [];
      setCloudScenarios(items);
      setSelectedCloudScenarioId((current) => current || items[0]?.id || "");
      if (!silent) {
        setCloudNotice(items.length ? `已讀取 ${items.length} 筆雲端版本。` : "雲端目前沒有版本。");
      }
    } catch (error) {
      if (!silent) {
        setCloudNotice(getErrorMessage(error, "讀取雲端版本失敗。"));
      }
    } finally {
      setIsCloudListLoading(false);
    }
  };

  const loadCloudScenario = () => {
    const target = cloudScenarios.find((item) => item.id === selectedCloudScenarioId);
    if (!target?.payload) return;
    transitionApply(target.payload, { markDirty: false });
    setCloudScenarioId(target.id || "");
    setCloudSyncStatus("synced");
    setCloudNotice(`已載入雲端版本「${target.name}」。`);
  };

  const restoreEditable = () => {
    setReadonlyShared(false);
    patchMeta({ name: `${scenario.meta.name}（我的版本）` });
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
      ? `已登入 Supabase${cloudUserEmail ? `（${cloudUserEmail}）` : ""}，可建立短網址與同步。`
      : cloudAuthState === "checking"
        ? "正在檢查 Supabase 登入狀態。"
        : cloudAuthState === "anonymous"
          ? "尚未登入 Supabase，請先寄送 magic link 完成登入。"
          : getSupabaseConfigHint();
  const cloudSetupMessage =
    cloudSetupState === "ready"
      ? "Supabase Flowra 雲端資料表已就緒。"
      : cloudSetupState === "checking"
        ? "正在檢查 Supabase Flowra 資料表。"
        : cloudSetupState === "missing"
          ? "Supabase 尚未建立 Flowra 雲端資料表，請先套用 supabase/migrations/20260505_flowra_cloud.sql。"
          : cloudSetupState === "error"
            ? "Supabase Flowra 雲端狀態檢查失敗。"
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
        .flowra-pdf-export .flowra-no-print {
          display: none !important;
        }
        .flowra-pdf-export .flowra-main-grid {
          grid-template-columns: 1fr !important;
        }
        .flowra-hover-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 18px 36px rgba(37,99,235,0.09);
          border-color: rgba(191,219,254,0.95) !important;
        }
        .flowra-table-row:hover {
          background: #f8fbff !important;
        }
        .flowra-table-row.is-active:hover {
          background: #dbeafe !important;
        }
        .flowra-surface-row:hover {
          border-color: #dbeafe !important;
          background: #f8fbff !important;
        }
        .flowra-drag-handle:hover:not(.is-dragging) {
          border-color: #93c5fd;
          background: #eff6ff;
          color: #1d4ed8;
        }
        .flowra-surface-enter {
          animation: flowra-surface-enter 200ms ease both;
          will-change: transform, opacity;
        }
        @keyframes flowra-surface-enter {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
      <div style={{ ...styles.container, ...styles.chartTheme }} className={`flowra-print-root${isPreparingPdf ? " flowra-pdf-export" : ""}`} ref={reportRef}>
        <div style={styles.header}>
          <div>
            <div style={styles.badge}>
              個人現金流試算
            </div>
            <h1 style={styles.title}>未來財務趨勢模擬器</h1>
            <p style={styles.subtitle}>
              用來試算未來幾個月的現金流與支出變化。
            </p>
            <div style={{ ...styles.metaText, marginTop: "10px", fontWeight: 700, color: "#0f172a" }}>名稱：{scenario.meta.name}</div>
            <div style={{ ...styles.metaText, marginTop: "10px" }}>
              試算期間：{reportPeriodLabel}　|　產生時間：{generatedAtLabel}
            </div>
          </div>
        </div>

        {readonlyShared ? (
          <div style={{ ...styles.alert, background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8" }}>
            <div>
              <strong>目前是唯讀分享模式</strong>
              <div>你可以先檢視邏輯，再按「複製成自己的版本」開始編輯。</div>
              <InteractiveButton onClick={restoreEditable} style={{ marginTop: "10px" }}>
                複製成自己的版本
              </InteractiveButton>
            </div>
          </div>
        ) : null}

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
              <div className={inputGridClassName}>
                <BaseMonthPicker value={scenario.meta.baseMonth} onChange={(value) => patchMeta({ baseMonth: value })} disabled={readonlyShared} />
                <Field label="目前台幣餘額" value={scenario.basics.startingTwd} onChange={(value) => patchBasics({ startingTwd: value })} suffix="元" disabled={readonlyShared} />
                <Field label="日幣現金折台幣" value={scenario.basics.jpyCashTwd} onChange={(value) => patchBasics({ jpyCashTwd: value })} suffix="元" disabled={readonlyShared} />
                <Field label="每月薪資" value={scenario.basics.monthlySalary} onChange={(value) => patchBasics({ monthlySalary: value })} suffix="元" disabled={readonlyShared} />
                <MonthPicker label="薪資開始月份" value={scenario.basics.salaryStartsMonth} onChange={(value) => patchBasics({ salaryStartsMonth: value })} baseMonth={scenario.meta.baseMonth} horizon={scenario.basics.monthsToProject} disabled={readonlyShared} />
                <Field label="每月租屋補貼" value={scenario.basics.monthlySubsidy} onChange={(value) => patchBasics({ monthlySubsidy: value })} suffix="元" disabled={readonlyShared} />
                <MonthPicker label="補貼開始月份" value={scenario.basics.subsidyStartsMonth} onChange={(value) => patchBasics({ subsidyStartsMonth: value })} baseMonth={scenario.meta.baseMonth} horizon={scenario.basics.monthsToProject} disabled={readonlyShared} />
                <Field label="每月房租" value={scenario.basics.monthlyRent} onChange={(value) => patchBasics({ monthlyRent: value })} suffix="元" disabled={readonlyShared} />
                <Field label="每月生活費" value={scenario.basics.monthlyLivingCost} onChange={(value) => patchBasics({ monthlyLivingCost: value })} suffix="元" disabled={readonlyShared} />
                <Field label="每月學貸" value={scenario.basics.monthlyStudentLoan} onChange={(value) => patchBasics({ monthlyStudentLoan: value })} suffix="元" disabled={readonlyShared} />
                <Field label="試算月數" value={scenario.basics.monthsToProject} onChange={(value) => patchBasics({ monthsToProject: Math.max(0, Math.round(value)) })} suffix="月" min={0} step={1} disabled={readonlyShared} />
              </div>
              <div style={styles.mutedBox}>
                <label style={styles.label}>是否把日幣現金納入可動用資金</label>
                <InteractiveSelect
                  value={scenario.basics.includeJpyCash ? "yes" : "no"}
                  disabled={readonlyShared}
                  onChange={(event) => patchBasics({ includeJpyCash: event.target.value === "yes" })}
                >
                  <option value="yes">納入</option>
                  <option value="no">不納入</option>
                </InteractiveSelect>
              </div>
            </InteractiveSurface>

            <InteractiveSurface as="section" style={styles.card} hoverClassName="flowra-hover-card">
              <InteractiveSurface
                style={{ ...styles.surfaceRow, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: isOneTimeOpen ? "12px" : 0 }}
                hoverClassName="flowra-surface-row"
              >
                <InteractiveButton
                  variant="button"
                  onClick={() => setIsOneTimeOpen((value) => !value)}
                  style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left" }}
                  aria-expanded={isOneTimeOpen}
                >
                  <span>一次性收入 / 支出</span>
                  <span>{isOneTimeOpen ? "收起 ▲" : `展開 ▼（${scenario.oneTimeItems.length} 筆）`}</span>
                </InteractiveButton>
                <InteractiveButton onClick={addOneTimeItem} disabled={readonlyShared}>
                  新增
                </InteractiveButton>
              </InteractiveSurface>
              {isOneTimeOpen
                ? (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleOneTimeDragEnd}>
                    <SortableContext items={scenario.oneTimeItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                      {scenario.oneTimeItems.map((item) => {
                        const itemIsOpen = Boolean(openOneTimeItemIds[item.id]);
                        return (
                          <SortableItemShell key={item.id} id={item.id}>
                            <div style={styles.item}>
                              <InteractiveSurface
                                style={{ ...styles.surfaceRow, display: "flex", gap: "8px", alignItems: "center" }}
                                hoverClassName="flowra-surface-row"
                              >
                                <InteractiveButton
                                  variant="button"
                                  onClick={() => setOpenOneTimeItemIds((current) => ({ ...current, [item.id]: !current[item.id] }))}
                                  style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left", padding: "8px 10px" }}
                                  aria-expanded={itemIsOpen}
                                >
                                  <span>{item.name}</span>
                                  <span style={{ color: "#64748b", fontSize: "12px" }}>{itemIsOpen ? "▲" : "▼"}</span>
                                </InteractiveButton>
                                <InteractiveButton onClick={() => duplicateOneTimeItem(item.id)} disabled={readonlyShared}>
                                  複製
                                </InteractiveButton>
                                <InteractiveButton variant="dangerButton" onClick={() => removeOneTimeItem(item.id)} disabled={readonlyShared}>
                                  刪
                                </InteractiveButton>
                              </InteractiveSurface>
                              {itemIsOpen ? (
                                <div style={{ marginTop: "10px" }}>
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
                                      showRelative
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
                              ) : null}
                            </div>
                          </SortableItemShell>
                        );
                      })}
                    </SortableContext>
                  </DndContext>
                )
                : null}
            </InteractiveSurface>

            <InteractiveSurface as="section" style={styles.card} hoverClassName="flowra-hover-card">
              <InteractiveSurface
                style={{ ...styles.surfaceRow, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: isInstallmentsOpen ? "12px" : 0 }}
                hoverClassName="flowra-surface-row"
              >
                <InteractiveButton
                  variant="button"
                  onClick={() => setIsInstallmentsOpen((value) => !value)}
                  style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left" }}
                  aria-expanded={isInstallmentsOpen}
                >
                  <span>分期帳單</span>
                  <span>{isInstallmentsOpen ? "收起 ▲" : `展開 ▼（${installmentRows.length} 筆）`}</span>
                </InteractiveButton>
                <InteractiveButton onClick={() => setIsBulkImportOpen((value) => !value)} disabled={readonlyShared}>
                  批次匯入
                </InteractiveButton>
                <InteractiveButton onClick={addInstallment} disabled={readonlyShared}>
                  新增
                </InteractiveButton>
              </InteractiveSurface>
              {isInstallmentsOpen
                ? (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleInstallmentDragEnd}>
                    <SortableContext items={installmentRows.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                      {installmentRows.map((item) => {
                        const itemIsOpen = Boolean(openInstallmentItemIds[item.id]);
                        return (
                          <SortableItemShell key={item.id} id={item.id}>
                            <div style={styles.item}>
                              <InteractiveSurface
                                style={{ ...styles.surfaceRow, display: "flex", gap: "8px", alignItems: "center" }}
                                hoverClassName="flowra-surface-row"
                              >
                                <InteractiveButton
                                  variant="button"
                                  onClick={() => setOpenInstallmentItemIds((current) => ({ ...current, [item.id]: !current[item.id] }))}
                                  style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left", padding: "8px 10px" }}
                                  aria-expanded={itemIsOpen}
                                >
                                  <span>{item.name}</span>
                                  <span style={{ color: "#64748b", fontSize: "12px" }}>{itemIsOpen ? "▲" : "▼"}</span>
                                </InteractiveButton>
                                <InteractiveButton variant="dangerButton" onClick={() => removeInstallment(item.id)} disabled={readonlyShared}>
                                  刪
                                </InteractiveButton>
                              </InteractiveSurface>
                              {itemIsOpen ? (
                                <div style={{ marginTop: "10px" }}>
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
                                      showRelative
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
                              ) : null}
                            </div>
                          </SortableItemShell>
                        );
                      })}
                    </SortableContext>
                  </DndContext>
                )
                : null}
            </InteractiveSurface>

            <InteractiveSurface as="section" style={styles.card} hoverClassName="flowra-hover-card">
              <h2 style={styles.cardTitle}>匯入 / 分享 / 匯出</h2>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "flex-start" }}>
                <div style={{ position: "relative" }} ref={sharePopoverRef}>
                  <InteractiveButton onClick={() => setIsSharePopoverOpen((value) => !value)} aria-expanded={isSharePopoverOpen}>
                    分享
                  </InteractiveButton>
                  {isSharePopoverOpen ? (
                    <FloatingSurface style={styles.sharePopover} motionClassName="flowra-surface-enter">
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
                        <InteractiveButton variant={shareTab === "url" ? "activePill" : "pillButton"} onClick={() => setShareTab("url")}>
                          複製連結
                        </InteractiveButton>
                        <InteractiveButton variant={shareTab === "short" ? "activePill" : "pillButton"} onClick={() => setShareTab("short")}>
                          短網址
                        </InteractiveButton>
                      </div>
                      <div style={styles.exportGrid}>
                        {shareTab === "url" ? (
                          <>
                            <InteractiveButton onClick={buildShare}>
                              複製分享連結
                            </InteractiveButton>
                          </>
                        ) : (
                          <>
                            <InteractiveButton onClick={createShortShare} disabled={!cloudFeaturesEnabled}>
                              建立短網址
                            </InteractiveButton>
                            <div style={{ ...styles.mutedBox, gridColumn: "1 / -1", marginTop: 0 }}>
                              <div style={styles.metaText}>
                                {supabaseReady ? `${cloudAuthMessage} ${cloudSetupMessage} 短網址預設 30 天過期並記錄 view_count。` : getSupabaseConfigHint()}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                      <div style={{ ...styles.mutedBox, marginTop: "12px" }}>
                        <label style={{ ...styles.label, marginBottom: "8px" }}>分享為唯讀</label>
                        <InteractiveSelect value={shareReadonly ? "yes" : "no"} onChange={(event) => setShareReadonly(event.target.value === "yes")}>
                          <option value="yes">唯讀分享</option>
                          <option value="no">可編輯分享</option>
                        </InteractiveSelect>
                      </div>
                      <div style={{ ...styles.mutedBox, marginTop: "12px" }}>
                        <div style={styles.label}>分享連結</div>
                        <div style={{ wordBreak: "break-all", fontSize: "13px", color: "#334155" }}>
                          {shareTab === "url" ? shareUrl || "尚未產生" : shortShareUrl || "尚未產生短網址"}
                        </div>
                        <div style={{ marginTop: "6px", fontSize: "12px", color: "#64748b" }}>
                          {shareTab === "url"
                            ? shareNotice || "警語：連結內含你的金額資訊，僅分享給信任對象。"
                            : cloudNotice || "需登入、產生 slug、設定 30 天過期與 view_count。"}
                        </div>
                        <div style={{ marginTop: "6px", fontSize: "12px", color: "#64748b" }}>
                          {cloudNotice && shareTab === "url" ? cloudNotice : null}
                        </div>
                      </div>
                      <div style={{ ...styles.mutedBox, marginTop: "12px" }}>
                        <div style={styles.label}>QR code</div>
                        {shareQrUrl ? (
                          <div style={{ display: "flex", gap: "14px", alignItems: "center", flexWrap: "wrap" }}>
                            <img src={shareQrUrl} alt="分享連結 QR code" style={{ width: "148px", height: "148px", borderRadius: "16px", border: "1px solid #dbe4ee", background: "white", padding: "8px" }} />
                            <div style={{ ...styles.metaText, maxWidth: "220px" }}>
                              {shareTab === "url" ? "即時分享用 QR code，可搭配唯讀分享。" : "短網址建立成功後，這裡會顯示可掃描的 QR code。"}
                            </div>
                          </div>
                        ) : (
                          <div style={styles.metaText}>先產生分享連結後，這裡才會顯示 QR code。</div>
                        )}
                      </div>
                    </FloatingSurface>
                  ) : null}
                </div>
                <InteractiveButton onClick={() => syncScenarioToCloud()} disabled={!cloudFeaturesEnabled}>
                  同步雲端
                </InteractiveButton>
                <InteractiveButton onClick={() => fileInputRef.current?.click()}>
                  匯入 JSON
                </InteractiveButton>
                <div style={{ position: "relative" }}>
                  <InteractiveButton onClick={() => setIsExportMenuOpen((value) => !value)} aria-expanded={isExportMenuOpen}>
                    匯出
                  </InteractiveButton>
                  {isExportMenuOpen ? (
                    <FloatingSurface style={styles.dropdownMenu} motionClassName="flowra-surface-enter">
                      <InteractiveButton variant="dropdownItem" onClick={() => { setIsExportMenuOpen(false); exportPng(); }}>
                        截圖（PNG，整頁）
                      </InteractiveButton>
                      <InteractiveButton variant="dropdownItem" onClick={() => { setIsExportMenuOpen(false); exportPdf(); }}>
                        PDF 報表
                      </InteractiveButton>
                      <InteractiveButton variant="dropdownItem" onClick={() => { setIsExportMenuOpen(false); exportExcel(); }}>
                        Excel 明細
                      </InteractiveButton>
                      <InteractiveButton variant="dropdownItem" onClick={() => { setIsExportMenuOpen(false); exportJson(); }}>
                        JSON 完整狀態
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
                  雲端同步狀態：
                  {cloudSyncStatus === "syncing" ? "同步中" : null}
                  {cloudSyncStatus === "pending" ? "內容已變更，尚未重新同步" : null}
                  {cloudSyncStatus === "synced" ? "已同步" : null}
                  {cloudSyncStatus === "idle" ? "尚未同步" : null}
                </div>
                <div style={{ ...styles.metaText, marginTop: "6px" }}>最近開啟：{lastOpenedAtLabel}</div>
                <div style={{ ...styles.metaText, marginTop: "6px" }}>最近嘗試同步：{lastSyncAttemptAtLabel}</div>
                <div style={{ ...styles.metaText, marginTop: "6px" }}>最近同步：{lastSyncedAtLabel}</div>
                <div style={{ ...styles.metaText, marginTop: "6px" }}>{cloudAuthMessage}</div>
                <div style={{ ...styles.metaText, marginTop: "6px" }}>{cloudSetupMessage}</div>
                <div style={{ ...styles.mutedBox, marginTop: "10px", background: "#ffffff" }}>
                  <div style={styles.label}>Supabase 登入</div>
                  {cloudAuthState === "authenticated" ? (
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                      <div style={styles.metaText}>目前 session 已就緒，可直接做短網址與雲端同步。</div>
                      <InteractiveButton onClick={signOutFromSupabase}>
                        登出
                      </InteractiveButton>
                    </div>
                  ) : (
                    <>
                      <div style={{ ...styles.metaText, marginBottom: "8px" }}>輸入 email 後寄送 magic link；完成登入後此頁會自動接收 session。</div>
                      <div className={inputGridClassName}>
                        <TextField label="登入 email" value={authEmailInput} onChange={setAuthEmailInput} disabled={!supabaseReady || isSendingMagicLink} type="email" />
                        <div style={{ display: "flex", alignItems: "end" }}>
                          <InteractiveButton onClick={sendMagicLink} style={{ width: "100%", justifyContent: "center" }} disabled={!supabaseReady || isSendingMagicLink}>
                            {isSendingMagicLink ? "寄送中..." : "寄送登入連結"}
                          </InteractiveButton>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" }}>
                  <InteractiveButton onClick={() => refreshCloudScenarios()} disabled={!cloudFeaturesEnabled || isCloudListLoading}>
                    {isCloudListLoading ? "讀取中..." : "讀取雲端版本"}
                  </InteractiveButton>
                  {cloudScenarios.length ? (
                    <>
                      <InteractiveSelect value={selectedCloudScenarioId} onChange={(event) => setSelectedCloudScenarioId(event.target.value)} style={{ minWidth: "220px", maxWidth: "100%" }}>
                        {cloudScenarios.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}｜{formatTimestamp(item.updated_at)}
                          </option>
                        ))}
                      </InteractiveSelect>
                      <InteractiveButton onClick={loadCloudScenario}>
                        載入選中版本
                      </InteractiveButton>
                    </>
                  ) : null}
                </div>
              </div>
            </InteractiveSurface>

          </div>

          <div>
            <InteractiveSurface as="section" style={{ ...styles.card, position: "relative" }} hoverClassName="flowra-hover-card" className="flowra-print-card" ref={trendChartRef}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", marginBottom: "8px" }}>
                <h2 style={styles.cardTitle}>月底現金趨勢</h2>
                <InteractiveButton onClick={() => exportChartPng(trendChartRef, "cash-trend")} className="flowra-no-print">
                  PNG
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
                <InteractiveButton onClick={() => exportChartPng(incomeChartRef, "income-expense")} className="flowra-no-print">
                  PNG
                </InteractiveButton>
              </div>
              <IncomeExpenseChart rows={rows} onSelectMonth={focusCompositionMonth} selectedMonthKey={selectedMonthKey} />
            </InteractiveSurface>

            <InteractiveSurface as="section" style={{ ...styles.card, position: "relative" }} hoverClassName="flowra-hover-card" className="flowra-print-card" ref={compositionChartRef}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", marginBottom: "8px" }}>
                <h2 style={styles.cardTitle}>支出組成堆疊面積圖</h2>
                <InteractiveButton onClick={() => exportChartPng(compositionChartRef, "expense-composition")} className="flowra-no-print">
                  PNG
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

            <InteractiveSurface as="section" style={styles.card} hoverClassName="flowra-hover-card" className="flowra-print-card">
              <h2 style={styles.cardTitle}>月度明細</h2>
              <MonthDetailTable rows={rows} selectedMonthKey={selectedMonthKey} hidden={hiddenAmounts} mobile={mobile} monthRefs={monthRefs} readonly={readonlyShared} />
            </InteractiveSurface>
          </div>
        </div>
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
