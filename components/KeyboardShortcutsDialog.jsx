import React, { useEffect } from "react";

const backdropStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.45)",
  display: "grid",
  placeItems: "center",
  padding: "16px",
  zIndex: 70,
};

const cardStyle = {
  background: "#ffffff",
  borderRadius: "16px",
  padding: "20px 22px",
  maxWidth: "440px",
  width: "100%",
  boxShadow: "0 12px 32px rgba(15, 23, 42, 0.22)",
};

const rowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  padding: "8px 0",
  borderBottom: "1px dashed #e2e8f0",
};

const kbdGroupStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
};

const kbdStyle = {
  display: "inline-block",
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  fontSize: "11px",
  color: "#0f172a",
  background: "#f1f5f9",
  border: "1px solid #cbd5e1",
  borderRadius: "6px",
  padding: "2px 6px",
  minWidth: "20px",
  textAlign: "center",
};

const SHORTCUTS = [
  { keys: ["?"], label: "顯示這個快捷鍵列表" },
  { keys: ["Esc"], label: "關閉對話框 / 抽屜 / 選單" },
  { keys: ["⌘ / Ctrl", "Z"], label: "復原上一個變更" },
  { keys: ["⌘ / Ctrl", "Shift", "Z"], label: "重做被復原的變更" },
  { keys: ["Enter"], label: "送出目前欄位 / 確認預覽" },
];

export default function KeyboardShortcutsDialog({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      style={backdropStyle}
      className="flowra-no-print flowra-no-report-export"
      onClick={onClose}
      data-testid="keyboard-shortcuts-backdrop"
    >
      <div
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            marginBottom: "8px",
          }}
        >
          <h2
            id="keyboard-shortcuts-title"
            style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a", margin: 0 }}
          >
            鍵盤快捷鍵
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            style={{
              background: "transparent",
              border: "none",
              fontSize: "20px",
              lineHeight: 1,
              color: "#64748b",
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>
        <p style={{ margin: "0 0 12px 0", color: "#64748b", fontSize: "12px" }}>
          隨時按 <kbd style={kbdStyle}>?</kbd> 重新呼出此面板。
        </p>
        <div>
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.label} style={rowStyle}>
              <span style={{ color: "#0f172a", fontSize: "13px" }}>{shortcut.label}</span>
              <span style={kbdGroupStyle}>
                {shortcut.keys.map((key, index) => (
                  <React.Fragment key={`${shortcut.label}-${key}-${index}`}>
                    {index > 0 ? (
                      <span style={{ color: "#94a3b8", fontSize: "11px" }}>+</span>
                    ) : null}
                    <kbd style={kbdStyle}>{key}</kbd>
                  </React.Fragment>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
