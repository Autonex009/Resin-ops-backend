import { NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import {
  getMonthlyOutputSummary,
  getCapacityUtilization,
  getBatchesBehindCount,
  getCommitmentsShortCount,
  getDailyTrend,
  getCapacityByStream,
  getOutputByPlant,
  getBatchesScheduleSummary,
} from "@/lib/kpis";

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  const [
    output,
    capacity,
    batchesBehind,
    commitmentsShort,
    dailyTrend,
    capacityByStream,
    outputByPlant,
    batchesSchedule,
  ] = await Promise.all([
    getMonthlyOutputSummary(),
    getCapacityUtilization(),
    getBatchesBehindCount(),
    getCommitmentsShortCount(),
    getDailyTrend(),
    getCapacityByStream(),
    getOutputByPlant(),
    getBatchesScheduleSummary(),
  ]);

  return NextResponse.json({
    output,
    capacity,
    batchesBehind,
    commitmentsShort,
    dailyTrend,
    capacityByStream,
    outputByPlant,
    batchesSchedule,
  });
}
