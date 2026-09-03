import { NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { listPlants } from "@/lib/plants";
import { getDailyPlanVsActual } from "@/lib/plan-vs-actual";
import type { Stream } from "@/lib/import-helpers";

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  const { searchParams } = new URL(request.url);
  const plantCode = searchParams.get("plant");
  const stream = (searchParams.get("stream") as Stream) ?? "cation";
  const month = searchParams.get("month");

  if (!plantCode || !month) {
    return NextResponse.json({ error: "plant and month are required" }, { status: 400 });
  }

  const plants = await listPlants();
  const plant = plants.find((p) => p.code === plantCode);
  if (!plant) {
    return NextResponse.json({ rows: [] });
  }

  const rows = await getDailyPlanVsActual({ plantId: plant.id, stream, month });
  return NextResponse.json({ rows });
}
