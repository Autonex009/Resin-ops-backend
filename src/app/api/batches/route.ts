import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { batches, batchStatusEnum, plants } from "@/db/schema";
import { isAuthorized, unauthorized } from "@/lib/auth";
import type { Stream } from "@/lib/import-helpers";

const BEHIND_SQL = sql`(${batches.actualCompletion} is not null and ${batches.actualCompletion} > ${batches.plannedCompletion})
  or (${batches.actualCompletion} is null and ${batches.plannedCompletion} < current_date)`;

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  const { searchParams } = new URL(request.url);
  const plantCode = searchParams.get("plant");
  const stream = searchParams.get("stream") as Stream | null;
  const status = searchParams.get("status");
  const schedule = searchParams.get("schedule");
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "25")));

  const db = getDb();
  const conditions = [];

  if (plantCode) {
    const plant = await db.query.plants.findFirst({ where: eq(plants.code, plantCode) });
    conditions.push(plant ? eq(batches.plantId, plant.id) : sql`false`);
  }
  if (stream) conditions.push(eq(batches.stream, stream));
  if (status) conditions.push(eq(batches.status, status as (typeof batchStatusEnum.enumValues)[number]));
  if (schedule === "behind") conditions.push(BEHIND_SQL);
  else if (schedule === "on_track") conditions.push(sql`not (${BEHIND_SQL})`);

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db.select({ total: sql<string>`count(*)` }).from(batches).where(where);

  const rows = await db.query.batches.findMany({
    where,
    with: { plant: true },
    orderBy: (b) => [desc(b.plannedCompletion)],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return NextResponse.json({ batches: rows, total: Number(total), page, pageSize });
}
