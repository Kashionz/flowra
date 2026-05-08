// components/ScenarioCompareView.jsx
// Side-by-side comparison of A (current) and B (AI-proposed) projection rows.
// Renders as a fixed full-screen overlay with summary cards, overlaid line
// chart, and a unified diff table.

import React, { useEffect, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { computeDiffSummary } from "../lib/scenarioCompare.js";

const fmt = (n) => `NT$ ${Math.round(Number(n) || 0).toLocaleString("zh-TW")}`;
const fmtSigned = (n) => {
  const v = Math.round(Number(n) || 0);
  if (v === 0) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toLocaleString("zh-TW")}`;
};

function SummaryCard({ label, valueA, valueB, delta, hint, betterWhenHigher = true }) {
  const isBetter = delta === 0 ? null : betterWhenHigher ? delta > 0 : delta < 0;
  const deltaColor =
    isBetter === null ? "text-slate-500" : isBetter ? "text-emerald-600" : "text-red-600";
  const deltaIcon = isBetter === null ? "→" : isBetter ? "↑" : "↓";
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">{label}</p>
        <span className={`text-xs font-medium ${deltaColor}`} aria-hidden="true">
          {deltaIcon}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-sm">
        <span className="text-slate-400 text-xs">A</span>
        <span className="text-slate-700 text-right tabular-nums">{fmt(valueA)}</span>
        <span className="text-sky-600 text-xs">B</span>
        <span className="text-slate-800 text-right font-medium tabular-nums">{fmt(valueB)}</span>
      </div>
      <div
        className={`mt-2 pt-2 border-t border-slate-100 text-sm font-medium ${deltaColor} text-right tabular-nums`}
      >
        {fmtSigned(delta)}
      </div>
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function MonthCard({ label, valueA, valueB }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3">
      <p className="text-xs text-slate-500 mb-2">{label}</p>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-sm">
        <span className="text-slate-400 text-xs">A</span>
        <span className="text-slate-700 text-right">{valueA || "—"}</span>
        <span className="text-sky-600 text-xs">B</span>
        <span className="text-slate-800 text-right font-medium">{valueB || "—"}</span>
      </div>
    </div>
  );
}

export default function ScenarioCompareView({ rowsA, rowsB, onAdopt, onLeave, proposalSummary }) {
  const summary = computeDiffSummary(rowsA, rowsB);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onLeave?.();
    };
    window.addEventListener("keydown", handler);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = prev;
    };
  }, [onLeave]);

  const tableRows = useMemo(() => {
    const len = Math.max(rowsA.length, rowsB.length);
    return Array.from({ length: len }, (_, i) => {
      const a = rowsA[i];
      const b = rowsB[i];
      const balA = Number(a?.balance) || 0;
      const balB = Number(b?.balance) || 0;
      return {
        monthKey: a?.monthKey || b?.monthKey || "",
        balA,
        balB,
        diff: balB - balA,
      };
    });
  }, [rowsA, rowsB]);

  const topDiffKeys = useMemo(() => {
    const sorted = [...tableRows]
      .map((r, idx) => ({ idx, monthKey: r.monthKey, abs: Math.abs(r.diff) }))
      .filter((r) => r.abs > 0)
      .sort((a, b) => b.abs - a.abs)
      .slice(0, 3);
    return new Set(sorted.map((r) => r.monthKey));
  }, [tableRows]);

  const chartData = tableRows.map((r) => ({
    monthKey: r.monthKey,
    A: r.balA,
    B: r.balB,
  }));

  return (
    <div
      data-testid="scenario-compare-overlay"
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-slate-900/40 sm:p-4"
      style={{ animation: "flowra-fade-in 200ms ease-out" }}
    >
      <style>{`
        @keyframes flowra-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes flowra-pop-in {
          from { opacity: 0; transform: translateY(8px) scale(0.99); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <section
        data-testid="scenario-compare-view"
        role="dialog"
        aria-label="情境比較"
        className="bg-slate-50 w-full sm:max-w-5xl sm:rounded-xl shadow-2xl flex flex-col max-h-full sm:max-h-[92vh] overflow-hidden"
        style={{ animation: "flowra-pop-in 240ms cubic-bezier(0.32, 0.72, 0, 1)" }}
      >
        <header className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-slate-200 bg-white">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-medium text-slate-800">情境比較</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2 h-0.5 bg-slate-400" /> A 當前
              </span>
              <span className="mx-2 text-slate-300">vs</span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2 h-0.5 bg-sky-500" /> B AI 提議
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onLeave}
            className="w-8 h-8 flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded"
            aria-label="關閉比較"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-4">
          {proposalSummary && (
            <div className="bg-sky-50 border border-sky-100 rounded-lg px-3 py-2 text-sm text-slate-700">
              <span className="text-xs text-sky-700 font-medium mr-2">AI 提議</span>
              {proposalSummary}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SummaryCard
              label="期末結餘"
              valueA={summary.endingBalanceA}
              valueB={summary.endingBalanceB}
              delta={summary.endingBalanceDelta}
              hint="模擬期間最後一個月的結餘"
            />
            <SummaryCard
              label="最低結餘"
              valueA={summary.maxDebtA}
              valueB={summary.maxDebtB}
              delta={summary.maxDebtB - summary.maxDebtA}
              hint="期間中最低的月結餘（負值代表見底）"
            />
            <MonthCard
              label="首次見底月份"
              valueA={summary.firstNegativeA}
              valueB={summary.firstNegativeB}
            />
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-2" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="monthKey" tick={{ fontSize: 10 }} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => `${Math.round(v / 10000)}萬`}
                />
                <Tooltip
                  formatter={(v) => fmt(v)}
                  contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e2e8f0" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="A"
                  name="A 當前"
                  stroke="#94a3b8"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="B"
                  name="B AI 提議"
                  stroke="#0284c7"
                  strokeWidth={2.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <p className="text-xs font-medium text-slate-700">逐月對照</p>
              <p className="text-[11px] text-slate-400">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-300 mr-1 align-middle" />
                差異最大的月份
              </p>
            </div>
            <div className="max-h-[320px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-white sticky top-0 z-10 shadow-[0_1px_0_#e2e8f0]">
                  <tr>
                    <th className="p-2 text-left font-medium text-slate-500">月份</th>
                    <th className="p-2 text-right font-medium text-slate-500">A 結餘</th>
                    <th className="p-2 text-right font-medium text-sky-700">B 結餘</th>
                    <th className="p-2 text-right font-medium text-slate-500">差異</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r) => {
                    const diffColor =
                      r.diff > 0
                        ? "text-emerald-600"
                        : r.diff < 0
                          ? "text-red-600"
                          : "text-slate-400";
                    const isTop = topDiffKeys.has(r.monthKey);
                    return (
                      <tr
                        key={r.monthKey}
                        className={`border-t border-slate-100 ${isTop ? "bg-amber-50/60" : ""}`}
                      >
                        <td className="p-2 text-slate-600">
                          {isTop && (
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 mr-1.5 align-middle" />
                          )}
                          {r.monthKey}
                        </td>
                        <td className="p-2 text-right tabular-nums text-slate-600">
                          {fmt(r.balA)}
                        </td>
                        <td className="p-2 text-right tabular-nums text-slate-800 font-medium">
                          {fmt(r.balB)}
                        </td>
                        <td className={`p-2 text-right tabular-nums font-medium ${diffColor}`}>
                          {fmtSigned(r.diff)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <footer className="px-4 sm:px-5 py-3 border-t border-slate-200 bg-white flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            採用後，B 情境會成為主情境（A 將被覆寫）。可隨時用 ⌘Z / Ctrl+Z 還原。
          </p>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onLeave}
              className="px-3 py-1.5 text-sm text-slate-600 bg-slate-100 rounded hover:bg-slate-200 transition-colors"
            >
              離開比較
            </button>
            <button
              type="button"
              onClick={onAdopt}
              data-testid="ai-adopt-as-main"
              className="px-4 py-1.5 text-sm font-medium bg-sky-600 text-white rounded hover:bg-sky-700 transition-colors"
            >
              採用 B 為主情境
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
