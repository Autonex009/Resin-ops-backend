export type Stream = "cation" | "anion" | "mixed_bed";

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
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s;
}

export function toMonthDate(value: unknown): string {
  const s = toDateString(value);
  if (!s) return "";
  return `${s.slice(0, 7)}-01`;
}
