import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Stream } from "@/lib/import-helpers";

export type DailyRow = { day: string; planned: string; actual: string };

// "Planned" is the monthly production plan spread evenly across the days of
// the month — the same basis the Overview page's daily trend chart uses
// (see getDailyTrend in kpis.ts). It previously summed batches.planned_qty by
// planned_completion date instead, which compares two unrelated scales: a
// handful of discrete batch records vs the plant's whole-day output total.
export async function getDailyPlanVsActual({
  plantId,
  stream,
  month,
}: {
  plantId: string;
  stream: Stream;
  month: string;
}): Promise<DailyRow[]> {
  const db = getDb();
  const result = await db.execute(sql`
    select
      d::date as day,
      round(coalesce(p.planned_qty, 0) / extract(day from (${month}::date + interval '1 month' - interval '1 day'))) as planned,
      coalesce(o.actual, 0) as actual
    from generate_series(${month}::date, (${month}::date + interval '1 month' - interval '1 day'), interval '1 day') as d
    left join production_plans p
      on p.plant_id = ${plantId} and p.stream = ${stream} and p.plan_month = ${month}::date
    left join (
      select output_date as day, actual_qty as actual
      from daily_outputs
      where plant_id = ${plantId} and stream = ${stream}
    ) o on o.day = d::date
    order by d;
  `);
  return result.rows as unknown as DailyRow[];
}
