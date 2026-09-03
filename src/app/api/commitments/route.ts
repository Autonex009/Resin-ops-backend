import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { isAuthorized, unauthorized } from "@/lib/auth";

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  const db = getDb();
  const commitments = await db.query.salesCommitments.findMany({
    with: { plant: true },
    orderBy: (c) => [desc(c.salesOrderDate)],
    limit: 200,
  });

  return NextResponse.json({ commitments });
}
