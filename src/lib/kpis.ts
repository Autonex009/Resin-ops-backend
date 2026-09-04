import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  batches,
  dailyOutputs,
  plantCapacities,
  plants,
  productionPlans,
  salesCommitments,
} from "@/db/schema";

export function currentMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export async function getMonthlyOutputSummary(month?: string) {
  const db = getDb();
  const { start, end } = month
    ? { start: month, end: nextMonth(month) }
    : currentMonthRange();

  const [{ actual }] = await db
    .select({ actual: sql<string>`coalesce(sum(${dailyOutputs.actualQty}), 0)` })
    .from(dailyOutputs)
    .where(and(gte(dailyOutputs.outputDate, start), lt(dailyOutputs.outputDate, end)));

  const [{ planned }] = await db
    .select({ planned: sql<string>`coalesce(sum(${productionPlans.plannedQty}), 0)` })
    .from(productionPlans)
    .where(eq(productionPlans.planMonth, start));

  return { actual: Number(actual), planned: Number(planned), month: start };
}

export async function getCapacityUtilization(month?: string) {
  const db = getDb();
  const { start, end } = month
    ? { start: month, end: nextMonth(month) }
    : currentMonthRange();

  const [{ actual }] = await db
    .select({ actual: sql<string>`coalesce(sum(${dailyOutputs.actualQty}), 0)` })
    .from(dailyOutputs)
    .where(and(gte(dailyOutputs.outputDate, start), lt(dailyOutputs.outputDate, end)));

  const [{ capacity }] = await db
    .select({ capacity: sql<string>`coalesce(sum(${plantCapacities.monthlyCapacityQty}), 0)` })
    .from(plantCapacities)
    .where(eq(plantCapacities.effectiveMonth, start));

  return { actual: Number(actual), capacity: Number(capacity), month: start };
}

export async function getBatchesBehindCount() {
  const db = getDb();
  const [{ count }] = await db
    .select({ count: sql<string>`count(*)` })
    .from(batches)
    .where(
      sql`(${batches.actualCompletion} is not null and ${batches.actualCompletion} > ${batches.plannedCompletion})
          or (${batches.actualCompletion} is null and ${batches.plannedCompletion} < current_date)`,
    );
  return Number(count);
}

export type DailyTrendPoint = { day: string; actual: number; target: number };

// Cumulative actual output vs a straight-line pace toward the monthly plan,
// aggregated across all plants/streams — the trend behind the Overview KPIs.
export async function getDailyTrend(month?: string): Promise<DailyTrendPoint[]> {
  const db = getDb();
  const { start, end } = month ? { start: month, end: nextMonth(month) } : currentMonthRange();

  const [{ planned }] = await db
    .select({ planned: sql<string>`coalesce(sum(${productionPlans.plannedQty}), 0)` })
    .from(productionPlans)
    .where(eq(productionPlans.planMonth, start));
  const totalPlanned = Number(planned);

  const rows = await db
    .select({
      day: dailyOutputs.outputDate,
      actual: sql<string>`sum(${dailyOutputs.actualQty})`,
    })
    .from(dailyOutputs)
    .where(and(gte(dailyOutputs.outputDate, start), lt(dailyOutputs.outputDate, end)))
    .groupBy(dailyOutputs.outputDate);

  const actualByDay = new Map(rows.map((r) => [r.day, Number(r.actual)]));
  const daysInMonth = new Date(
    Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 0),
  ).getUTCDate();

  let running = 0;
  const points: DailyTrendPoint[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${start.slice(0, 7)}-${String(day).padStart(2, "0")}`;
    running += actualByDay.get(dateStr) ?? 0;
    const target = totalPlanned > 0 ? Math.round((totalPlanned / daysInMonth) * day) : 0;
    points.push({ day: dateStr, actual: running, target });
  }

  return points;
}

export type StreamCapacityPoint = {
  stream: string;
  capacity: number;
  actual: number;
  utilizationPct: number;
};

// Capacity utilization per stream, summed across all plants — the breakdown
// behind the single aggregate Capacity Utilization KPI.
export async function getCapacityByStream(month?: string): Promise<StreamCapacityPoint[]> {
  const db = getDb();
  const { start, end } = month ? { start: month, end: nextMonth(month) } : currentMonthRange();

  const capacityRows = await db
    .select({
      stream: plantCapacities.stream,
      capacity: sql<string>`sum(${plantCapacities.monthlyCapacityQty})`,
    })
    .from(plantCapacities)
    .where(eq(plantCapacities.effectiveMonth, start))
    .groupBy(plantCapacities.stream);

  const actualRows = await db
    .select({
      stream: dailyOutputs.stream,
      actual: sql<string>`sum(${dailyOutputs.actualQty})`,
    })
    .from(dailyOutputs)
    .where(and(gte(dailyOutputs.outputDate, start), lt(dailyOutputs.outputDate, end)))
    .groupBy(dailyOutputs.stream);

  const capacityByStream = new Map(capacityRows.map((r) => [r.stream, Number(r.capacity)]));
  const actualByStream = new Map(actualRows.map((r) => [r.stream, Number(r.actual)]));

  return (["cation", "anion", "mixed_bed"] as const).map((stream) => {
    const capacity = capacityByStream.get(stream) ?? 0;
    const actual = actualByStream.get(stream) ?? 0;
    return {
      stream,
      capacity,
      actual,
      utilizationPct: capacity > 0 ? Math.round((actual / capacity) * 100) : 0,
    };
  });
}

export async function getCommitmentsShortCount() {
  const db = getDb();
  const [{ count }] = await db
    .select({ count: sql<string>`count(*)` })
    .from(salesCommitments)
    .where(
      sql`${salesCommitments.requiredDate} < current_date and ${salesCommitments.balanceQty} > 0`,
    );
  return Number(count);
}

export type PlantOutputPoint = { plantCode: string; plantName: string; actual: number; planned: number };

// Actual vs planned output per plant this month — the plant-level breakdown
// behind the aggregate Plan Attainment KPI.
export async function getOutputByPlant(month?: string): Promise<PlantOutputPoint[]> {
  const db = getDb();
  const { start, end } = month ? { start: month, end: nextMonth(month) } : currentMonthRange();

  const actualRows = await db
    .select({ plantId: dailyOutputs.plantId, actual: sql<string>`sum(${dailyOutputs.actualQty})` })
    .from(dailyOutputs)
    .where(and(gte(dailyOutputs.outputDate, start), lt(dailyOutputs.outputDate, end)))
    .groupBy(dailyOutputs.plantId);

  const plannedRows = await db
    .select({
      plantId: productionPlans.plantId,
      planned: sql<string>`sum(${productionPlans.plannedQty})`,
    })
    .from(productionPlans)
    .where(eq(productionPlans.planMonth, start))
    .groupBy(productionPlans.plantId);

  const allPlants = await db.select().from(plants).orderBy(plants.code);
  const actualByPlant = new Map(actualRows.map((r) => [r.plantId, Number(r.actual)]));
  const plannedByPlant = new Map(plannedRows.map((r) => [r.plantId, Number(r.planned)]));

  return allPlants
    .map((p) => ({
      plantCode: p.code,
      plantName: p.name,
      actual: actualByPlant.get(p.id) ?? 0,
      planned: plannedByPlant.get(p.id) ?? 0,
    }))
    .filter((p) => p.actual > 0 || p.planned > 0);
}

export type BatchScheduleSummary = { onTrack: number; behind: number };

// The count breakdown behind the single Batches Behind KPI.
export async function getBatchesScheduleSummary(): Promise<BatchScheduleSummary> {
  const db = getDb();
  const [{ total }] = await db.select({ total: sql<string>`count(*)` }).from(batches);
  const behind = await getBatchesBehindCount();
  return { onTrack: Number(total) - behind, behind };
}

export type AgingBucket = { bucket: string; count: number };

const AGING_BUCKETS = ["Overdue", "0-7 days", "8-14 days", "15-21 days", "22+ days"] as const;

// Open commitments (balance > 0) bucketed by days until required — a
// forward-looking risk pipeline, not just the already-late count.
export async function getCommitmentsAging(): Promise<AgingBucket[]> {
  const db = getDb();
  const rows = await db
    .select({ requiredDate: salesCommitments.requiredDate })
    .from(salesCommitments)
    .where(sql`${salesCommitments.requiredDate} is not null and ${salesCommitments.balanceQty} > 0`);

  const counts = new Map<string, number>(AGING_BUCKETS.map((b) => [b, 0]));
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");

  for (const row of rows) {
    const required = new Date(`${row.requiredDate}T00:00:00Z`);
    const daysUntil = Math.round((required.getTime() - today.getTime()) / 86_400_000);
    let bucket: (typeof AGING_BUCKETS)[number];
    if (daysUntil < 0) bucket = "Overdue";
    else if (daysUntil <= 7) bucket = "0-7 days";
    else if (daysUntil <= 14) bucket = "8-14 days";
    else if (daysUntil <= 21) bucket = "15-21 days";
    else bucket = "22+ days";
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  return AGING_BUCKETS.map((bucket) => ({ bucket, count: counts.get(bucket) ?? 0 }));
}

export type DueDateCount = { day: string; count: number };

// Batches due (any status) per day this month — surfaces workload clustering
// that a flat behind/on-track count can't show.
export async function getBatchDueDateCounts(month?: string): Promise<DueDateCount[]> {
  const db = getDb();
  const { start, end } = month ? { start: month, end: nextMonth(month) } : currentMonthRange();

  const rows = await db
    .select({
      day: batches.plannedCompletion,
      count: sql<string>`count(*)`,
    })
    .from(batches)
    .where(and(gte(batches.plannedCompletion, start), lt(batches.plannedCompletion, end)))
    .groupBy(batches.plannedCompletion);

  const countByDay = new Map(rows.map((r) => [r.day, Number(r.count)]));
  const daysInMonth = new Date(
    Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 0),
  ).getUTCDate();

  const points: DueDateCount[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${start.slice(0, 7)}-${String(day).padStart(2, "0")}`;
    points.push({ day: dateStr, count: countByDay.get(dateStr) ?? 0 });
  }
  return points;
}

function nextMonth(monthDate: string) {
  const d = new Date(`${monthDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}
