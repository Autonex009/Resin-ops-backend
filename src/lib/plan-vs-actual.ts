import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Stream } from "@/lib/import-helpers";

export type DailyRow = { day: string; planned: string; actual: string };

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
      coalesce(b.planned, 0) as planned,
      coalesce(o.actual, 0) as actual
    from generate_series(${month}::date, (${month}::date + interval '1 month' - interval '1 day'), interval '1 day') as d
    left join (
      select planned_completion as day, sum(planned_qty) as planned
      from batches
      where plant_id = ${plantId} and stream = ${stream}
      group by planned_completion
    ) b on b.day = d::date
    left join (
      select output_date as day, actual_qty as actual
      from daily_outputs
      where plant_id = ${plantId} and stream = ${stream}
    ) o on o.day = d::date
    order by d;
  `);
  return result.rows as unknown as DailyRow[];
}
