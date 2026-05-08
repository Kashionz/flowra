// components/AIScenarioChat.jsx
// Chat drawer for AI scenario simulation. Pure presentational — parent owns
// all state (open, history, loading, currentProposal, error) and callbacks.

import React, { useEffect, useRef } from "react";

const SAMPLE_PROMPTS = [
  {
    title: "明年 6 月買車",
    detail: "60 萬車貸 60 期 3% 年息，每月保險約 1500",
    text: "明年 6 月買車：60 萬車貸 60 期 3% 年息，每月保險約 1500",
  },
  {
    title: "下半年換工作",
    detail: "月薪 +1 萬，但通勤成本 +2000",
    text: "下半年換工作，月薪 +1 萬，但通勤成本 +2000",
  },
  {
    title: "2027 年 3 月退休",
    detail: "停掉所有薪水與補助",
    text: "2027 年 3 月退休，停掉所有薪水與補助",
  },
];

const ADD_STYLE = "bg-emerald-50 text-emerald-700 border-emerald-200";
const UPDATE_STYLE = "bg-sky-50 text-sky-700 border-sky-200";
const REMOVE_STYLE = "bg-rose-50 text-rose-700 border-rose-200";
const SET_STYLE = "bg-violet-50 text-violet-700 border-violet-200";

const OP_LABEL = {
  add_one_time: { text: "新增 單次", className: ADD_STYLE },
  update_one_time: { text: "更新 單次", className: UPDATE_STYLE },
  remove_one_time: { text: "移除 單次", className: REMOVE_STYLE },
  add_installment: { text: "新增 分期", className: ADD_STYLE },
  update_installment: { text: "更新 分期", className: UPDATE_STYLE },
  remove_installment: { text: "移除 分期", className: REMOVE_STYLE },
  set_basic: { text: "基本設定", className: SET_STYLE },
};

const BASIC_FIELD_LABEL = {
  monthlySalary: "月薪",
  monthlySubsidy: "月補助",
  monthlyRent: "月房租",
  monthlyLivingCost: "月生活費",
  monthlyStudentLoan: "月學貸",
  salaryStartsMonth: "薪水起始月",
  subsidyStartsMonth: "補助起始月",
  monthsToProject: "預測月數",
};

function fmtMaybeMoney(field, value) {
  if (value == null) return "";
  if (typeof value === "number" && /Salary|Subsidy|Rent|Cost|Loan/i.test(field || "")) {
    return `NT$ ${Number(value).toLocaleString("zh-TW")}`;
  }
  return String(value);
}

function describeChange(c) {
  if (c.op === "set_basic") {
    return {
      primary: BASIC_FIELD_LABEL[c.field] || c.field || "（未指定欄位）",
      secondary: fmtMaybeMoney(c.field, c.value),
    };
  }
  if (c.op === "add_installment" || c.op === "update_installment") {
    const v = c.value || {};
    const name = v.name || c.targetId || "分期項目";
    const pieces = [];
    if (v.principal != null) pieces.push(`本金 NT$ ${Number(v.principal).toLocaleString("zh-TW")}`);
    if (v.terms != null) pieces.push(`${v.terms} 期`);
    if (v.apr != null) pieces.push(`年息 ${v.apr}%`);
    if (v.startMonth) pieces.push(`從 ${v.startMonth}`);
    return { primary: name, secondary: pieces.join("・") };
  }
  if (c.op === "add_one_time" || c.op === "update_one_time") {
    const v = c.value || {};
    const name = v.name || c.targetId || "單次項目";
    const pieces = [];
    if (v.amount != null) pieces.push(`NT$ ${Number(v.amount).toLocaleString("zh-TW")}`);
    if (v.month) pieces.push(`於 ${v.month}`);
    if (v.kind) pieces.push(v.kind === "income" ? "收入" : "支出");
    return { primary: name, secondary: pieces.join("・") };
  }
  if (c.op === "remove_installment" || c.op === "remove_one_time") {
    return { primary: c.targetId || c.value?.name || "（已移除）", secondary: "" };
  }
  return { primary: c.op, secondary: "" };
}

function ProposalCard({ proposal, onApply, onDiscard }) {
  if (!proposal) return null;
  return (
    <div
      data-testid="ai-proposal-card"
      className="border border-sky-200 rounded-lg bg-white shadow-sm overflow-hidden"
    >
      <div className="px-3 py-2 bg-sky-50 border-b border-sky-100 flex items-center gap-2">
        <span className="text-sky-600">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        </span>
        <p className="text-sm font-medium text-slate-800 flex-1">{proposal.summary}</p>
      </div>
      <ul className="divide-y divide-slate-100">
        {proposal.changes.map((c, i) => {
          const op = OP_LABEL[c.op] || {
            text: c.op,
            className: "bg-slate-100 text-slate-700 border-slate-200",
          };
          const { primary, secondary } = describeChange(c);
          return (
            <li key={i} className="px-3 py-2 flex items-start gap-2">
              <span
                className={`text-[11px] px-1.5 py-0.5 rounded border whitespace-nowrap ${op.className}`}
              >
                {op.text}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-800 truncate">{primary}</p>
                {secondary && <p className="text-xs text-slate-500 truncate">{secondary}</p>}
                {c.reason && <p className="text-xs text-slate-400 mt-0.5">{c.reason}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      {proposal.warnings?.length > 0 && (
        <div className="px-3 py-2 bg-amber-50 border-t border-amber-100">
          <ul className="text-xs text-amber-800 space-y-0.5">
            {proposal.warnings.map((w, i) => (
              <li key={i} className="flex gap-1.5">
                <span aria-hidden="true">⚠</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {proposal.explanation && (
        <p className="px-3 py-2 text-xs text-slate-500 bg-slate-50 border-t border-slate-100 whitespace-pre-line">
          {proposal.explanation}
        </p>
      )}
      <div className="px-3 py-2 flex gap-2 border-t border-slate-100 bg-white">
        <button
          type="button"
          onClick={onApply}
          className="flex-1 px-3 py-1.5 text-sm font-medium bg-sky-600 text-white rounded hover:bg-sky-700 transition-colors"
          data-testid="ai-apply-proposal"
        >
          套用為 B 情境
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="px-3 py-1.5 text-sm text-slate-600 rounded hover:bg-slate-100 transition-colors"
        >
          捨棄
        </button>
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="思考中">
      <span
        className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce"
        style={{ animationDelay: "0ms" }}
      />
      <span
        className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce"
        style={{ animationDelay: "150ms" }}
      />
      <span
        className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce"
        style={{ animationDelay: "300ms" }}
      />
    </span>
  );
}

export default function AIScenarioChat({
  open,
  onClose,
  history,
  loading,
  proposal,
  error,
  quota,
  onSend,
  onApply,
  onDiscardProposal,
  onNewChat,
  disabled,
  disabledReason,
}) {
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (open && !loading) inputRef.current?.focus();
  }, [open, loading]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, loading, proposal, error]);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const quotaPercent = quota?.quota
    ? Math.min(100, Math.round((quota.used / quota.quota) * 100))
    : 0;
  const quotaWarn = quotaPercent >= 80;
  const hasContent = history.length > 0 || proposal || error;

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 bg-slate-900/30 z-30 backdrop-blur-[1px]"
        style={{ animation: "flowra-fade-in 200ms ease-out" }}
        aria-hidden="true"
      />
      <aside
        data-testid="ai-scenario-drawer"
        className="fixed top-0 right-0 h-full w-full sm:w-[420px] bg-slate-50 border-l border-slate-200 shadow-xl z-40 flex flex-col"
        style={{ animation: "flowra-slide-in-right 280ms cubic-bezier(0.32, 0.72, 0, 1)" }}
        role="dialog"
        aria-label="AI 輔助分析"
      >
        <style>{`
          @keyframes flowra-slide-in-right {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }
          @keyframes flowra-fade-in {
            from { opacity: 0; }
            to { opacity: 1; }
          }
        `}</style>

        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-2">
            <span className="text-sky-600" aria-hidden="true">
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
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            <h2 className="text-base font-medium text-slate-800">AI 輔助分析</h2>
          </div>
          <div className="flex items-center gap-1">
            {hasContent && onNewChat && (
              <button
                type="button"
                onClick={onNewChat}
                className="px-2 py-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded"
                title="清空對話"
              >
                新對話
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded"
              aria-label="關閉"
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
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {disabled && (
            <p className="text-sm text-slate-500 bg-slate-100 border border-slate-200 p-3 rounded">
              {disabledReason}
            </p>
          )}
          {!disabled && history.length === 0 && !proposal && (
            <div className="space-y-3">
              <div className="text-center py-2">
                <p className="text-sm text-slate-700 font-medium">描述你的假設情境</p>
                <p className="text-xs text-slate-500 mt-1">AI 會回到一份可預覽的 B 情境提議</p>
              </div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400 px-1">範例</p>
              <div className="space-y-2">
                {SAMPLE_PROMPTS.map((p, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onSend(p.text)}
                    className="block w-full text-left p-3 bg-white border border-slate-200 rounded-lg hover:border-sky-300 hover:shadow-sm transition-all"
                  >
                    <p className="text-sm font-medium text-slate-800">{p.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{p.detail}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
          {history.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] text-sm bg-sky-600 text-white rounded-2xl rounded-br-sm px-3 py-2 shadow-sm"
                    : "max-w-[85%] text-sm bg-white border border-slate-200 text-slate-700 rounded-2xl rounded-bl-sm px-3 py-2"
                }
              >
                {m.role === "assistant" && m.questions ? (
                  <>
                    <p className="text-xs text-slate-400 mb-1">我需要先確認：</p>
                    <ul className="list-disc pl-4 space-y-1">
                      {m.questions.map((q, j) => (
                        <li key={j}>{q}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="whitespace-pre-line">{m.content}</p>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="text-sm bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-3 py-2 text-slate-500 flex items-center gap-2">
                <ThinkingDots />
                <span className="text-xs">AI 正在分析…</span>
              </div>
            </div>
          )}
          {proposal && (
            <ProposalCard proposal={proposal} onApply={onApply} onDiscard={onDiscardProposal} />
          )}
          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              {error}
            </p>
          )}
        </div>

        <form
          className="border-t border-slate-200 px-3 py-3 bg-white space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = inputRef.current?.value?.trim();
            if (!v || disabled || loading) return;
            inputRef.current.value = "";
            onSend(v);
          }}
        >
          <textarea
            ref={inputRef}
            rows={2}
            placeholder={
              disabled ? disabledReason : "描述假設情境…（Enter 送出，Shift+Enter 換行）"
            }
            disabled={disabled || loading}
            data-testid="ai-input"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const v = e.currentTarget.value.trim();
                if (!v || disabled || loading) return;
                e.currentTarget.value = "";
                onSend(v);
              }
            }}
            className="w-full text-sm p-2.5 border border-slate-200 rounded-lg resize-none focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 disabled:bg-slate-50 disabled:text-slate-400"
          />
          <div className="flex justify-between items-center gap-3">
            <div className="flex-1 min-w-0">
              {quota && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${quotaWarn ? "bg-amber-400" : "bg-sky-400"}`}
                      style={{ width: `${quotaPercent}%` }}
                    />
                  </div>
                  <span
                    className={`text-[11px] whitespace-nowrap ${quotaWarn ? "text-amber-600" : "text-slate-400"}`}
                  >
                    {quota.used}/{quota.quota}
                  </span>
                </div>
              )}
            </div>
            <button
              type="submit"
              disabled={disabled || loading}
              className="px-4 py-1.5 text-sm font-medium bg-sky-600 text-white rounded-lg disabled:bg-slate-300 disabled:cursor-not-allowed hover:bg-sky-700 transition-colors"
            >
              {loading ? "送出中…" : "送出"}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
