import { NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { listPlants } from "@/lib/plants";
import { getDailyPlanVsActual } from "@/lib/plan-vs-actual";
import type { Stream } from "@/lib/import-helpers";

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  const { searchParams } = new URL(request.url);
  const plantCode = searchParams.get("plant");
  const streamParam = searchParams.get("stream");
  const stream = streamParam ? (streamParam as Stream) : undefined;
  const month = searchParams.get("month");

  if (!month) {
    return NextResponse.json({ error: "month is required" }, { status: 400 });
  }

  let plantId: string | undefined;
  if (plantCode) {
    const plants = await listPlants();
    const plant = plants.find((p) => p.code === plantCode);
    if (!plant) return NextResponse.json({ rows: [] });
    plantId = plant.id;
  }

  const rows = await getDailyPlanVsActual({ plantId, stream, month });
  return NextResponse.json({ rows });
}
