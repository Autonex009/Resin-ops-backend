import { NextResponse } from "next/server";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { batches, batchStatusEnum, plants } from "@/db/schema";
import { isAuthorized, unauthorized } from "@/lib/auth";
import type { Stream } from "@/lib/import-helpers";

const BEHIND_SQL = sql`((${batches.actualCompletion} is not null and ${batches.actualCompletion} > ${batches.plannedCompletion})
  or (${batches.actualCompletion} is null and ${batches.plannedCompletion} < current_date))`;

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  const { searchParams } = new URL(request.url);
  const plantCode = searchParams.get("plant");
  const stream = searchParams.get("stream") as Stream | null;
  const status = searchParams.get("status");
  const schedule = searchParams.get("schedule");
  const search = searchParams.get("search")?.trim();
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "25")));

  const db = getDb();

  // "Scope" = every filter except schedule — this is what the on-track/behind
  // summary tiles reflect, so they stay meaningful even when the table itself
  // is narrowed to just one schedule state.
  const scopeConditions = [];
  if (plantCode) {
    const plant = await db.query.plants.findFirst({ where: eq(plants.code, plantCode) });
    scopeConditions.push(plant ? eq(batches.plantId, plant.id) : sql`false`);
  }
  if (stream) scopeConditions.push(eq(batches.stream, stream));
  if (status) scopeConditions.push(eq(batches.status, status as (typeof batchStatusEnum.enumValues)[number]));
  if (search) scopeConditions.push(ilike(batches.batchNumber, `%${search}%`));

  const scopeWhere = scopeConditions.length > 0 ? and(...scopeConditions) : undefined;

  const hasScheduleFilter = schedule === "behind" || schedule === "on_track";
  const tableConditions = [...scopeConditions];
  if (schedule === "behind") tableConditions.push(BEHIND_SQL);
  else if (schedule === "on_track") tableConditions.push(sql`not (${BEHIND_SQL})`);
  const tableWhere = tableConditions.length > 0 ? and(...tableConditions) : undefined;

  const [[{ total }], [{ behind, scopeTotal: rawScopeTotal }]] = await Promise.all([
    db.select({ total: sql<string>`count(*)` }).from(batches).where(tableWhere),
    db
      .select({
        behind: sql<string>`count(*) filter (where ${BEHIND_SQL})`,
        scopeTotal: sql<string>`count(*)`,
      })
      .from(batches)
      .where(scopeWhere),
  ]);

  const rows = await db.query.batches.findMany({
    where: tableWhere,
    with: { plant: true },
    orderBy: (b) => [desc(b.plannedCompletion)],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  const scopeTotal = hasScheduleFilter ? Number(rawScopeTotal) : Number(total);

  return NextResponse.json({
    batches: rows,
    total: Number(total),
    page,
    pageSize,
    summary: {
      total: scopeTotal,
      behind: Number(behind),
      onTrack: scopeTotal - Number(behind),
    },
  });
}
