import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { batches, dailyOutputs, plantCapacities, productionPlans, salesCommitments } from "@/db/schema";

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

function nextMonth(monthDate: string) {
  const d = new Date(`${monthDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}
