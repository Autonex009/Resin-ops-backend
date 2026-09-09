import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { dailyOutputs, productionPlans } from "@/db/schema";
import type { Stream } from "@/lib/import-helpers";

export type DailyRow = { day: string; planned: string; actual: string };

function nextMonthDate(month: string): string {
  const [year, m] = month.slice(0, 7).split("-").map(Number);
  const next = new Date(Date.UTC(year, m, 1));
  return next.toISOString().slice(0, 10);
}

function daysInMonth(month: string): number {
  const [year, m] = month.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

// "Planned" is the monthly production plan spread evenly across the days of
// the month — the same basis the Overview page's daily trend chart uses (see
// getDailyTrend in kpis.ts). plantId/stream are optional: omitting either
// aggregates (sums) across every plant/stream, for an "all plants" view.
export async function getDailyPlanVsActual({
  plantId,
  stream,
  month,
}: {
  plantId?: string;
  stream?: Stream;
  month: string;
}): Promise<DailyRow[]> {
  const db = getDb();
  const monthStart = month.slice(0, 7) + "-01";
  const monthEnd = nextMonthDate(monthStart);

  const planConditions = [eq(productionPlans.planMonth, monthStart)];
  if (plantId) planConditions.push(eq(productionPlans.plantId, plantId));
  if (stream) planConditions.push(eq(productionPlans.stream, stream));

  const outputConditions = [
    gte(dailyOutputs.outputDate, monthStart),
    lt(dailyOutputs.outputDate, monthEnd),
  ];
  if (plantId) outputConditions.push(eq(dailyOutputs.plantId, plantId));
  if (stream) outputConditions.push(eq(dailyOutputs.stream, stream));

  const [[{ totalPlanned }], outputRows] = await Promise.all([
    db
      .select({ totalPlanned: sql<string>`coalesce(sum(${productionPlans.plannedQty}), 0)` })
      .from(productionPlans)
      .where(and(...planConditions)),
    db
      .select({
        day: dailyOutputs.outputDate,
        actual: sql<string>`sum(${dailyOutputs.actualQty})`,
      })
      .from(dailyOutputs)
      .where(and(...outputConditions))
      .groupBy(dailyOutputs.outputDate),
  ]);

  const actualByDay = new Map(outputRows.map((r) => [r.day, r.actual]));
  const numDays = daysInMonth(monthStart);
  const dailyPlanned = String(Math.round(Number(totalPlanned) / numDays));

  const rows: DailyRow[] = [];
  for (let day = 1; day <= numDays; day++) {
    const dateStr = `${monthStart.slice(0, 7)}-${String(day).padStart(2, "0")}`;
    rows.push({ day: dateStr, planned: dailyPlanned, actual: actualByDay.get(dateStr) ?? "0" });
  }
  return rows;
}
