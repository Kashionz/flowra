import React from "react";

const containerStyle = {
  position: "fixed",
  right: "16px",
  bottom: "16px",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  zIndex: 60,
  pointerEvents: "none",
};

const cardStyle = {
  pointerEvents: "auto",
  minWidth: "240px",
  maxWidth: "360px",
  background: "#0f172a",
  color: "#f8fafc",
  borderRadius: "12px",
  padding: "10px 12px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  fontSize: "13px",
  boxShadow: "0 6px 18px rgba(15, 23, 42, 0.22)",
};

const actionButtonStyle = {
  background: "transparent",
  border: "1px solid rgba(248, 250, 252, 0.35)",
  color: "#f8fafc",
  borderRadius: "8px",
  padding: "4px 10px",
  fontSize: "12px",
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const dismissButtonStyle = {
  background: "transparent",
  border: "none",
  color: "rgba(248, 250, 252, 0.6)",
  padding: "0 4px",
  fontSize: "16px",
  lineHeight: 1,
  cursor: "pointer",
};

export default function UndoSnackbar({ items, onTrigger, onDismiss }) {
  if (!items || items.length === 0) return null;
  return (
    <div
      className="flowra-no-print flowra-no-report-export"
      style={containerStyle}
      aria-live="polite"
    >
      {items.map((item) => (
        <div key={item.id} role="status" style={cardStyle} data-testid="undo-snackbar">
          <span style={{ flex: 1, minWidth: 0 }}>{item.message}</span>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
            {item.onAction ? (
              <button
                type="button"
                style={actionButtonStyle}
                onClick={() => onTrigger(item.id)}
                data-testid="undo-snackbar-action"
              >
                {item.actionLabel || "復原"}
              </button>
            ) : null}
            <button
              type="button"
              style={dismissButtonStyle}
              aria-label="關閉提示"
              onClick={() => onDismiss(item.id)}
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
