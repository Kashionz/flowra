const STORAGE_KEY = "flowra.jpyExchangeRate";
const ENDPOINT = "https://open.er-api.com/v6/latest/JPY";

export const FALLBACK_JPY_TO_TWD_RATE = 0.21;

export function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function getCachedJpyToTwdRate() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const rate = Number(parsed?.rate);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    return {
      rate,
      fetchedAt: typeof parsed.fetchedAt === "string" ? parsed.fetchedAt : "",
      date: typeof parsed.date === "string" ? parsed.date : "",
    };
  } catch (error) {
    return null;
  }
}

export function saveJpyToTwdRate(entry) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch (error) {
    // Storage failures are non-fatal; the in-memory rate still applies.
  }
}

export async function fetchJpyToTwdRate(signal) {
  const response = await fetch(ENDPOINT, { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(`匯率服務回應 ${response.status}`);
  }
  const data = await response.json();
  const rate = Number(data?.rates?.TWD);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("匯率資料無效");
  }
  return {
    rate,
    fetchedAt: new Date().toISOString(),
    date: todayKey(),
  };
}
