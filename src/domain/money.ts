const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);
const THREE_DECIMAL = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);

function decimals(currency: string): number {
  const c = currency.toLowerCase();
  return ZERO_DECIMAL.has(c) ? 0 : THREE_DECIMAL.has(c) ? 3 : 2;
}

/** `123456` + `usd` -> `1,234.56 USD`. Handles zero- and three-decimal currencies. */
export function formatMoney(minorUnits: number, currency: string): string {
  const d = decimals(currency);
  const negative = minorUnits < 0;
  const abs = Math.abs(Math.round(minorUnits));
  const whole = Math.floor(abs / 10 ** d);
  const fraction = abs % 10 ** d;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const text = d === 0 ? grouped : `${grouped}.${String(fraction).padStart(d, "0")}`;
  return `${negative ? "-" : ""}${text} ${currency.toUpperCase()}`;
}

/** Totals per currency, sorted by currency code. */
export function totalsByCurrency(items: ReadonlyArray<{ readonly amount: number; readonly currency: string | null }>): string {
  const totals = new Map<string, number>();
  for (const { amount, currency } of items) {
    const key = (currency ?? "unknown").toLowerCase();
    totals.set(key, (totals.get(key) ?? 0) + amount);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, total]) => formatMoney(total, currency))
    .join(", ");
}
