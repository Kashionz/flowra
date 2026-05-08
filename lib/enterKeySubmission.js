export function shouldSubmitTextareaOnEnter(event, { isComposing = false } = {}) {
  if (event?.key !== "Enter" || event?.shiftKey) return false;

  const nativeEvent = event?.nativeEvent;
  if (isComposing || nativeEvent?.isComposing || nativeEvent?.keyCode === 229) {
    return false;
  }

  return true;
}
