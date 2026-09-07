import { NextResponse } from "next/server";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { plants, salesCommitments } from "@/db/schema";
import { isAuthorized, unauthorized } from "@/lib/auth";

const SHORT_SQL = sql`${salesCommitments.requiredDate} < current_date and ${salesCommitments.balanceQty} > 0`;

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  const { searchParams } = new URL(request.url);
  const plantCode = searchParams.get("plant");
  const businessGroup = searchParams.get("businessGroup");
  const status = searchParams.get("status");
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "25")));

  const db = getDb();
  const conditions = [];

  if (plantCode) {
    const plant = await db.query.plants.findFirst({ where: eq(plants.code, plantCode) });
    conditions.push(plant ? eq(salesCommitments.mfgPlantId, plant.id) : sql`false`);
  }
  if (businessGroup) conditions.push(eq(salesCommitments.businessGroup, businessGroup));
  if (status === "short") conditions.push(SHORT_SQL);
  else if (status === "on_track") conditions.push(sql`not (${SHORT_SQL})`);

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: sql<string>`count(*)` })
    .from(salesCommitments)
    .where(where);

  const rows = await db.query.salesCommitments.findMany({
    where,
    with: { plant: true },
    orderBy: (c) => [desc(c.salesOrderDate)],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  const businessGroupRows = await db
    .selectDistinct({ businessGroup: salesCommitments.businessGroup })
    .from(salesCommitments)
    .where(isNotNull(salesCommitments.businessGroup))
    .orderBy(salesCommitments.businessGroup);

  return NextResponse.json({
    commitments: rows,
    total: Number(total),
    page,
    pageSize,
    businessGroups: businessGroupRows.map((r) => r.businessGroup as string),
  });
}
