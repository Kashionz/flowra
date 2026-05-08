export function getAiComposerButtonTone({ loading, disabled }) {
  if (loading) {
    return {
      label: "停止",
      background: "#dc2626",
      borderColor: "#dc2626",
      textColor: "#ffffff",
    };
  }

  if (disabled) {
    return {
      label: "送出",
      background: "#cbd5e1",
      borderColor: "#cbd5e1",
      textColor: "#ffffff",
    };
  }

  return {
    label: "送出",
    background: "#0284c7",
    borderColor: "#0284c7",
    textColor: "#ffffff",
  };
}
