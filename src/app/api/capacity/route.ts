import { NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { getCapacityByStream } from "@/lib/capacity";

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month");
  if (!month) {
    return NextResponse.json({ error: "month is required" }, { status: 400 });
  }

  const rows = await getCapacityByStream(month);
  return NextResponse.json({ rows });
}
