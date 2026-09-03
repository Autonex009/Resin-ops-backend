import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { batches, dailyOutputs, plantCapacities, productionPlans } from "@/db/schema";

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

function nextMonth(monthDate: string) {
  const d = new Date(`${monthDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}
