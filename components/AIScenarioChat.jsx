// components/AIScenarioChat.jsx
// Chat drawer for AI scenario simulation. Pure presentational — parent owns
// all state (open, history, loading, currentProposal, error) and callbacks.

import { useEffect, useRef } from "react";

const SAMPLE_PROMPTS = [
  "明年 6 月買車：60 萬車貸 60 期 3% 年息，每月保險約 1500",
  "下半年換工作，月薪 +1 萬，但通勤成本 +2000",
  "2027 年 3 月退休，停掉所有薪水與補助",
];

function ProposalCard({ proposal, onApply, onDiscard }) {
  if (!proposal) return null;
  return (
    <div className="border border-slate-200 rounded p-3 bg-white space-y-2">
      <p className="font-medium text-slate-800">{proposal.summary}</p>
      <ul className="text-sm text-slate-600 list-disc pl-4 space-y-1">
        {proposal.changes.map((c, i) => (
          <li key={i}>
            <code className="text-xs text-sky-700">{c.op}</code>
            {c.value?.name && <span className="ml-1">「{c.value.name}」</span>}
            {c.field && (
              <span className="ml-1">
                {c.field} → {String(c.value)}
              </span>
            )}
            {c.reason && <span className="ml-1 text-slate-400">（{c.reason}）</span>}
          </li>
        ))}
      </ul>
      {proposal.warnings?.length > 0 && (
        <ul className="text-xs text-amber-700 list-disc pl-4 space-y-0.5">
          {proposal.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {proposal.explanation && (
        <p className="text-xs text-slate-500 whitespace-pre-line">{proposal.explanation}</p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onApply}
          className="px-3 py-1 text-sm bg-sky-600 text-white rounded hover:bg-sky-700"
          data-testid="ai-apply-proposal"
        >
          套用為 B 情境
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="px-3 py-1 text-sm bg-slate-100 text-slate-700 rounded hover:bg-slate-200"
        >
          捨棄
        </button>
      </div>
    </div>
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
  disabled,
  disabledReason,
}) {
  const inputRef = useRef(null);
  useEffect(() => {
    if (open && !loading) inputRef.current?.focus();
  }, [open, loading]);

  if (!open) return null;

  return (
    <aside
      data-testid="ai-scenario-drawer"
      className="fixed top-0 right-0 h-full w-full sm:w-96 bg-slate-50 border-l border-slate-200 shadow-lg z-40 flex flex-col"
      style={{ transition: "transform 300ms cubic-bezier(0.32, 0.72, 0, 1)" }}
    >
      <header className="flex items-center justify-between p-3 border-b border-slate-200 bg-white">
        <h2 className="text-base font-medium text-slate-800">AI 情境模擬</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-500 hover:text-slate-700 text-xl leading-none"
          aria-label="關閉"
        >
          ×
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {disabled && (
          <p className="text-sm text-slate-500 bg-slate-100 p-2 rounded">{disabledReason}</p>
        )}
        {!disabled && history.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">試試以下幾個範例：</p>
            {SAMPLE_PROMPTS.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onSend(p)}
                className="block w-full text-left text-sm p-2 bg-white border border-slate-200 rounded hover:bg-slate-50"
              >
                {p}
              </button>
            ))}
          </div>
        )}
        {history.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-8 text-sm bg-sky-50 border border-sky-100 rounded p-2 text-slate-800"
                : "mr-8 text-sm bg-white border border-slate-200 rounded p-2 text-slate-700"
            }
          >
            {m.role === "assistant" && m.questions ? (
              <ul className="list-disc pl-4 space-y-1">
                {m.questions.map((q, j) => (
                  <li key={j}>{q}</li>
                ))}
              </ul>
            ) : (
              <p className="whitespace-pre-line">{m.content}</p>
            )}
          </div>
        ))}
        {loading && (
          <div className="mr-8 text-sm bg-white border border-slate-200 rounded p-2 text-slate-400 animate-pulse">
            思考中…
          </div>
        )}
        {proposal && (
          <ProposalCard proposal={proposal} onApply={onApply} onDiscard={onDiscardProposal} />
        )}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
            {error}
          </p>
        )}
      </div>

      <form
        className="border-t border-slate-200 p-3 bg-white"
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
          placeholder={disabled ? disabledReason : "描述假設情境…"}
          disabled={disabled || loading}
          data-testid="ai-input"
          className="w-full text-sm p-2 border border-slate-200 rounded resize-none focus:outline-none focus:border-sky-400"
        />
        <div className="flex justify-between items-center pt-2">
          <span className="text-xs text-slate-400">
            {quota ? `今日已用 ${quota.used}/${quota.quota}` : ""}
          </span>
          <button
            type="submit"
            disabled={disabled || loading}
            className="px-3 py-1 text-sm bg-sky-600 text-white rounded disabled:bg-slate-300 hover:bg-sky-700"
          >
            送出
          </button>
        </div>
      </form>
    </aside>
  );
}
