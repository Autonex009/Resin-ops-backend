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
  getCommitmentsAging,
  getBatchDueDateCounts,
} from "@/lib/kpis";
import { getCapacityByStream as getCapacityByPlantAndStream } from "@/lib/capacity";

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
    commitmentsAging,
    batchDueDates,
    capacityByPlantAndStream,
  ] = await Promise.all([
    getMonthlyOutputSummary(),
    getCapacityUtilization(),
    getBatchesBehindCount(),
    getCommitmentsShortCount(),
    getDailyTrend(),
    getCapacityByStream(),
    getOutputByPlant(),
    getBatchesScheduleSummary(),
    getCommitmentsAging(),
    getBatchDueDateCounts(),
    getCapacityByPlantAndStream(currentMonth()),
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
    commitmentsAging,
    batchDueDates,
    capacityByPlantAndStream,
  });
}

function currentMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
