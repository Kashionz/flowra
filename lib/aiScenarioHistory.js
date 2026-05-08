export function normalizeAiConversationHistory(history = []) {
  if (!Array.isArray(history)) return [];

  return history.flatMap((message) => {
    if (!message || (message.role !== "user" && message.role !== "assistant")) {
      return [];
    }

    if (typeof message.content === "string" && message.content.trim()) {
      return [{ role: message.role, content: message.content.trim() }];
    }

    if (
      message.role === "assistant" &&
      Array.isArray(message.questions) &&
      message.questions.length > 0
    ) {
      const questions = message.questions
        .map((question) => String(question || "").trim())
        .filter(Boolean);

      if (!questions.length) return [];

      return [
        {
          role: "assistant",
          content: `請補充以下資訊：\n${questions.map((question) => `- ${question}`).join("\n")}`,
        },
      ];
    }

    return [];
  });
}
