function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundToPrecision(value, precision = 0) {
  const factor = 10 ** Math.max(0, precision);
  return Math.round((n(value) + Number.EPSILON) * factor) / factor;
}

export function getNumericInputDisplayValue(value, isFocused) {
  return isFocused && n(value) === 0 ? "" : value;
}

export function normalizeNumericInput(rawValue, { precision = 0, min } = {}) {
  const normalized = roundToPrecision(rawValue, precision);
  return min == null ? normalized : Math.max(n(min), normalized);
}

export function stepNumericValue(
  currentValue,
  step = 1,
  direction = "up",
  { precision = 0, min } = {},
) {
  const delta = direction === "down" ? -n(step) : n(step);
  return normalizeNumericInput(n(currentValue) + delta, { precision, min });
}
