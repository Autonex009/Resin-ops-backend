export type Stream = "cation" | "anion" | "mixed_bed";

// Real-world export headers vary in case, spacing, and punctuation from
// whatever exact string we first wrote the importer against (e.g. Thermax's
// actual file says "Mfg.Plant " and "Sales order Number", not "Mfg. Plant"
// and "Sales Order Number"). Comparing on letters+digits only absorbs that
// drift without needing a alias per header.
function normalizeHeaderKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type NormalizedRow = Map<string, unknown>;

export function normalizeRow(row: Record<string, unknown>): NormalizedRow {
  const map = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    map.set(normalizeHeaderKey(key), value);
  }
  return map;
}

// Looks up a field by trying each candidate header spelling in order —
// use multiple candidates only when the real header uses different words,
// not just different case/spacing/punctuation (that's handled automatically).
export function pick(row: NormalizedRow, ...candidates: string[]): unknown {
  for (const candidate of candidates) {
    const value = row.get(normalizeHeaderKey(candidate));
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

export function normalizeStream(value: unknown): Stream {
  const v = String(value ?? "").trim().toLowerCase();
  if (v.startsWith("cat")) return "cation";
  if (v.startsWith("an")) return "anion";
  if (v.includes("mixed") || v === "mb") return "mixed_bed";
  throw new Error(`Unrecognized stream: "${value}"`);
}

export function parseNumber(value: unknown): string {
  if (value === undefined || value === null || value === "") return "0";
  if (typeof value === "number") return String(value);
  const cleaned = String(value).replace(/,/g, "").trim();
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? "0" : String(n);
}

export function toDateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value ?? "").trim();
  if (!s) return "";

  // Already ISO-ish (yyyy-mm-dd...) — take it verbatim, no Date() round trip.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // m/d/yyyy, mm/dd/yyyy, or m/d/yy — the shapes spreadsheet exports use for
  // date cells (Excel's default US short-date format is 2-digit-year).
  // Parse the components directly: new Date(s) would interpret this as
  // local midnight, and .toISOString() then shifts the date backward by a
  // day on any machine ahead of UTC (e.g. IST).
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (us) {
    const [, m, d, yRaw] = us;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  return s;
}

export function toMonthDate(value: unknown): string {
  const s = toDateString(value);
  if (!s) return "";
  return `${s.slice(0, 7)}-01`;
}

export const PROVISIONAL_LEAD_TIME_DAYS = 21;

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
