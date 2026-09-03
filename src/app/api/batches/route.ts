import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { isAuthorized, unauthorized } from "@/lib/auth";

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  const db = getDb();
  const batches = await db.query.batches.findMany({
    with: { plant: true },
    orderBy: (b) => [desc(b.plannedCompletion)],
    limit: 200,
  });

  return NextResponse.json({ batches });
}
