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

// How to read *ambiguous* slash dates — ones where both the day and month
// components are <= 12 (e.g. "05/08/2026"), so the order can't be inferred from
// the values alone. "mdy" = month-first (US), "dmy" = day-first (most of the
// world, incl. India). Unambiguous dates (a component > 12) are auto-detected
// regardless of this setting. The Thermax exports tested so far are Excel's
// US short-date format, so this defaults to "mdy"; set IMPORT_DATE_ORDER=dmy
// if a day-first source ever appears.
const SLASH_DATE_ORDER: "mdy" | "dmy" =
  process.env.IMPORT_DATE_ORDER === "dmy" ? "dmy" : "mdy";

export function toDateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value ?? "").trim();
  if (!s) return "";

  // Year-first / ISO (yyyy-mm-dd or yyyy/mm/dd) — unambiguous, take verbatim.
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }

  // Slash dates (d/m/y or m/d/y, 2- or 4-digit year) — the shapes spreadsheet
  // exports use for date cells. Parse the components directly: new Date(s)
  // would read this as local midnight, and reading it back in UTC then shifts
  // the date backward a day on any machine ahead of UTC (e.g. IST).
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slash) {
    const [, aRaw, bRaw, yRaw] = slash;
    const a = Number(aRaw);
    const b = Number(bRaw);
    const year = yRaw.length === 2 ? `20${yRaw}` : yRaw;

    let month: number;
    let day: number;
    if (a > 12 && b <= 12) {
      // First value can't be a month → day-first (e.g. 30/08/2026).
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      // Second value can't be a month → month-first (e.g. 08/30/2026).
      month = a;
      day = b;
    } else if (a <= 12 && b <= 12) {
      // Genuinely ambiguous — use the configured order.
      if (SLASH_DATE_ORDER === "dmy") {
        day = a;
        month = b;
      } else {
        month = a;
        day = b;
      }
    } else {
      throw new Error(
        `Invalid date "${s}": both components exceed 12, so it is neither a valid day/month nor month/day.`,
      );
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      throw new Error(`Invalid date "${s}": day or month out of range.`);
    }
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // Anything else: fail loud rather than silently mis-parsing. Falling through
  // to new Date(s) here would guess at the format and store a wrong (or
  // timezone-shifted) date with no error — worse than rejecting the file. Add
  // an explicit branch above for any new format a real export actually uses.
  throw new Error(
    `Unrecognized date format: "${s}". Expected ISO (yyyy-mm-dd) or slash (d/m/yyyy) dates.`,
  );
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
