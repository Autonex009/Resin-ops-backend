import { NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import {
  getMonthlyOutputSummary,
  getCapacityUtilization,
  getBatchesBehindCount,
  getCommitmentsShortCount,
  getDailyTrend,
  getCapacityByStream,
} from "@/lib/kpis";

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  const [output, capacity, batchesBehind, commitmentsShort, dailyTrend, capacityByStream] =
    await Promise.all([
      getMonthlyOutputSummary(),
      getCapacityUtilization(),
      getBatchesBehindCount(),
      getCommitmentsShortCount(),
      getDailyTrend(),
      getCapacityByStream(),
    ]);

  return NextResponse.json({
    output,
    capacity,
    batchesBehind,
    commitmentsShort,
    dailyTrend,
    capacityByStream,
  });
}
