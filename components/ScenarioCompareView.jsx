// components/ScenarioCompareView.jsx
// Side-by-side comparison of A (current) and B (AI-proposed) projection rows.
// Diff summary cards on top, monthly table in middle, overlaid line chart at bottom.

import React from "react";
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

function SummaryCard({ label, valueA, valueB, delta, formatValue = fmt }) {
  const sign = delta > 0 ? "+" : "";
  const deltaColor = delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-600" : "text-slate-500";
  return (
    <div className="bg-white border border-slate-200 rounded p-3">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className="text-sm text-slate-700">A：{formatValue(valueA)}</p>
      <p className="text-sm text-slate-700">B：{formatValue(valueB)}</p>
      <p className={`text-sm font-medium pt-1 ${deltaColor}`}>
        差：{sign}
        {formatValue(delta)}
      </p>
    </div>
  );
}

export default function ScenarioCompareView({ rowsA, rowsB, onAdopt, onLeave }) {
  const summary = computeDiffSummary(rowsA, rowsB);
  const chartData = rowsA.map((r, i) => ({
    monthKey: r.monthKey,
    A: Number(r.balance) || 0,
    B: Number(rowsB[i]?.balance) || 0,
  }));

  return (
    <section data-testid="scenario-compare-view" className="space-y-4 p-3 sm:p-4 bg-slate-50">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-slate-800">情境比較（A 當前 vs B AI 提議）</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onLeave}
            className="px-3 py-1 text-sm bg-slate-100 text-slate-700 rounded hover:bg-slate-200"
          >
            離開比較
          </button>
          <button
            type="button"
            onClick={onAdopt}
            data-testid="ai-adopt-as-main"
            className="px-3 py-1 text-sm bg-sky-600 text-white rounded hover:bg-sky-700"
          >
            採用 B 為主情境
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <SummaryCard
          label="期末結餘"
          valueA={summary.endingBalanceA}
          valueB={summary.endingBalanceB}
          delta={summary.endingBalanceDelta}
        />
        <SummaryCard
          label="最低剩餘現金"
          valueA={summary.maxDebtA}
          valueB={summary.maxDebtB}
          delta={summary.maxDebtB - summary.maxDebtA}
        />
        <div className="bg-white border border-slate-200 rounded p-3">
          <p className="text-xs text-slate-500 mb-1">首次見底月份</p>
          <p className="text-sm text-slate-700">A：{summary.firstNegativeA || "—"}</p>
          <p className="text-sm text-slate-700">B：{summary.firstNegativeB || "—"}</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded p-2" style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="monthKey" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 10000)}萬`} />
            <Tooltip formatter={(v) => fmt(v)} />
            <Legend />
            <Line type="monotone" dataKey="A" stroke="#94a3b8" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="B" stroke="#0284c7" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-white border border-slate-200 rounded overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-2 text-left">月份</th>
                <th className="p-2 text-right">A 結餘</th>
              </tr>
            </thead>
            <tbody>
              {rowsA.map((r) => (
                <tr key={r.monthKey} className="border-t border-slate-100">
                  <td className="p-2">{r.monthKey}</td>
                  <td className="p-2 text-right">{fmt(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="bg-white border border-slate-200 rounded overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-2 text-left">月份</th>
                <th className="p-2 text-right">B 結餘</th>
              </tr>
            </thead>
            <tbody>
              {rowsB.map((r) => (
                <tr key={r.monthKey} className="border-t border-slate-100">
                  <td className="p-2">{r.monthKey}</td>
                  <td className="p-2 text-right">{fmt(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
