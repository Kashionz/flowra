export function normalizeSearchQuery(query) {
  return typeof query === "string" ? query.trim().toLowerCase() : "";
}

export function filterItemsByName(items, query) {
  if (!Array.isArray(items)) return [];
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return items;
  return items.filter((item) => {
    const name = item && typeof item.name === "string" ? item.name.toLowerCase() : "";
    return name.includes(normalized);
  });
}
