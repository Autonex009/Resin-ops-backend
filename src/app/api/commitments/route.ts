import { NextResponse } from "next/server";
import { and, desc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
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
  const search = searchParams.get("search")?.trim();
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "25")));

  const db = getDb();

  // "Scope" = every filter except status — the short/on-track/value summary
  // tiles reflect this, so they stay meaningful even when the table itself
  // is narrowed to just one status.
  const scopeConditions = [];
  if (plantCode) {
    const plant = await db.query.plants.findFirst({ where: eq(plants.code, plantCode) });
    scopeConditions.push(plant ? eq(salesCommitments.mfgPlantId, plant.id) : sql`false`);
  }
  if (businessGroup) scopeConditions.push(eq(salesCommitments.businessGroup, businessGroup));
  if (search) {
    scopeConditions.push(
      or(
        ilike(salesCommitments.salesOrderNumber, `%${search}%`),
        ilike(salesCommitments.customerName, `%${search}%`),
      ),
    );
  }

  const scopeWhere = scopeConditions.length > 0 ? and(...scopeConditions) : undefined;

  const hasStatusFilter = status === "short" || status === "on_track";
  const tableConditions = [...scopeConditions];
  if (status === "short") tableConditions.push(SHORT_SQL);
  else if (status === "on_track") tableConditions.push(sql`not (${SHORT_SQL})`);
  const tableWhere = tableConditions.length > 0 ? and(...tableConditions) : undefined;

  const [[{ total }], [{ short, scopeTotal: rawScopeTotal, totalBalanceValue }]] =
    await Promise.all([
      db.select({ total: sql<string>`count(*)` }).from(salesCommitments).where(tableWhere),
      db
        .select({
          short: sql<string>`count(*) filter (where ${SHORT_SQL})`,
          scopeTotal: sql<string>`count(*)`,
          totalBalanceValue: sql<string>`coalesce(sum(${salesCommitments.balanceValue}), 0)`,
        })
        .from(salesCommitments)
        .where(scopeWhere),
    ]);

  const rows = await db.query.salesCommitments.findMany({
    where: tableWhere,
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

  const scopeTotal = hasStatusFilter ? Number(rawScopeTotal) : Number(total);

  return NextResponse.json({
    commitments: rows,
    total: Number(total),
    page,
    pageSize,
    businessGroups: businessGroupRows.map((r) => r.businessGroup as string),
    summary: {
      total: scopeTotal,
      short: Number(short),
      onTrack: scopeTotal - Number(short),
      totalBalanceValue: Number(totalBalanceValue),
    },
  });
}
