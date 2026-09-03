import { sql } from "drizzle-orm";
import { getDb } from "@/db";

export type CapacityRow = {
  plant_id: string;
  plant_code: string;
  plant_name: string;
  stream: string;
  capacity: string;
  actual: string;
};

export async function getCapacityByStream(month: string): Promise<CapacityRow[]> {
  const db = getDb();
  const result = await db.execute(sql`
    select
      p.id as plant_id,
      p.code as plant_code,
      p.name as plant_name,
      c.stream as stream,
      coalesce(sum(c.monthly_capacity_qty), 0) as capacity,
      coalesce(max(o.actual), 0) as actual
    from plant_capacities c
    join plants p on p.id = c.plant_id
    left join (
      select plant_id, stream, sum(actual_qty) as actual
      from daily_outputs
      where output_date >= ${month}::date and output_date < (${month}::date + interval '1 month')
      group by plant_id, stream
    ) o on o.plant_id = c.plant_id and o.stream = c.stream
    where c.effective_month = ${month}::date
    group by p.id, p.code, p.name, c.stream
    order by p.code, c.stream;
  `);
  return result.rows as unknown as CapacityRow[];
}
