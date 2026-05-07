let nextId = 1;

function readNumericSuffix(value) {
  const match = /-(\d+)$/.exec(String(value || ""));
  return match ? Number(match[1]) : 0;
}

export function makeItemId(prefix = "id") {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

export function syncItemIdSequenceFromScenario(scenario) {
  if (!scenario || typeof scenario !== "object") return;
  const oneTimeItems = Array.isArray(scenario.oneTimeItems) ? scenario.oneTimeItems : [];
  const installments = Array.isArray(scenario.installments) ? scenario.installments : [];
  const maxExistingId = [...oneTimeItems, ...installments].reduce(
    (maxValue, item) => Math.max(maxValue, readNumericSuffix(item?.id)),
    0,
  );
  nextId = Math.max(nextId, maxExistingId);
}

export function resetItemIdSequenceForTests() {
  nextId = 1;
}
