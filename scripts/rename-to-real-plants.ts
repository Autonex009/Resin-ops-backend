import { eq, sql } from "drizzle-orm";
import { getDb } from "../src/db";
import {
  plants,
  plantCapacities,
  productionPlans,
  dailyOutputs,
  batches,
  salesCommitments,
} from "../src/db/schema";

// Thermax's real sample file names three plants: Dahej, Jhagadia, Paudh --
// not "Pune", which this demo invented. Renames the existing second plant
// (PNQ1/Pune -> JHA1/Jhagadia, already sized to roughly Jhagadia's real
// scale) and adds Paudh as a genuine third plant, smaller and calibrated to
// its own real Tracker/Summary figures (which run lower and more variable
// than the other two -- Paudh's actual output occasionally exceeds its
// plan in the real data, unlike Dahej/Jhagadia).
const db = getDb();

const STREAMS = ["cation", "anion", "mixed_bed"] as const;

const PAUDH_CAPACITY: Record<(typeof STREAMS)[number], number> = {
  cation: 215,
  anion: 180,
  mixed_bed: 105,
}; // 500 m3/month

const PAUDH_PLAN: Record<(typeof STREAMS)[number], number> = {
  cation: 181,
  anion: 151,
  mixed_bed: 88,
}; // 420 m3/month

const PRODUCT: Record<(typeof STREAMS)[number], { sub: string; code: string }> = {
  cation: { sub: "Standard Grade", code: "C-100" },
  anion: { sub: "Standard Grade", code: "A-200" },
  mixed_bed: { sub: "Standard Grade", code: "MB-300" },
};

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function dateStr(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

async function main() {
  // --- Rename Pune -> Jhagadia ---
  await db.update(plants).set({ code: "JHA1", name: "Jhagadia" }).where(eq(plants.code, "PNQ1"));

  // --- Create Paudh ---
  const existingPaudh = await db.query.plants.findFirst({ where: eq(plants.code, "PAU1") });
  const paudhId = existingPaudh
    ? existingPaudh.id
    : (await db.insert(plants).values({ code: "PAU1", name: "Paudh" }).returning())[0].id;

  // --- Capacity + production plan (August, September) ---
  await db.delete(plantCapacities).where(eq(plantCapacities.plantId, paudhId));
  for (const monthNum of [8, 9]) {
    const monthStart = dateStr(2026, monthNum, 1);
    for (const stream of STREAMS) {
      const { sub, code } = PRODUCT[stream];
      await db.insert(plantCapacities).values({
        plantId: paudhId,
        stream,
        subProduct: sub,
        product: code,
        monthlyCapacityQty: String(PAUDH_CAPACITY[stream]),
        effectiveMonth: monthStart,
      });
      await db
        .insert(productionPlans)
        .values({
          plantId: paudhId,
          stream,
          planMonth: monthStart,
          plannedQty: String(PAUDH_PLAN[stream]),
        })
        .onConflictDoUpdate({
          target: [productionPlans.plantId, productionPlans.stream, productionPlans.planMonth],
          set: { plannedQty: String(PAUDH_PLAN[stream]) },
        });
    }
  }

  // --- Daily output: Paudh's real data shows more variance and sometimes
  // exceeds plan (unlike Dahej/Jhagadia's steadier ~75-85% pace) ---
  await db.delete(dailyOutputs).where(eq(dailyOutputs.plantId, paudhId));
  for (const monthNum of [8, 9]) {
    const numDays = daysInMonth(2026, monthNum);
    for (const stream of STREAMS) {
      const dailyTarget = PAUDH_PLAN[stream] / numDays;
      for (let day = 1; day <= numDays; day++) {
        const actual = Math.round(dailyTarget * rand(0.85, 1.05) * 10) / 10;
        await db.insert(dailyOutputs).values({
          plantId: paudhId,
          stream,
          outputDate: dateStr(2026, monthNum, day),
          actualQty: String(actual),
        });
      }
    }
  }

  // --- Batches: same shape as the other two plants (2 Aug completed + 4
  // varied September) per stream ---
  const existingBatchCount = await db
    .select({ count: sql<string>`count(*)` })
    .from(batches)
    .where(eq(batches.plantId, paudhId));
  if (Number(existingBatchCount[0].count) === 0) {
    const batchQty = () => String(Math.round(rand(150, 400)));
    let seq = 1;
    for (const stream of STREAMS) {
      const streamTag = stream === "mixed_bed" ? "MB" : stream.slice(0, 3).toUpperCase();

      const augOnTime = Math.floor(rand(5, 15));
      await db.insert(batches).values({
        batchNumber: `PAU1-${streamTag}-${String(seq++).padStart(4, "0")}`,
        plantId: paudhId,
        stream,
        plannedQty: batchQty(),
        actualQty: batchQty(),
        plannedCompletion: dateStr(2026, 8, augOnTime),
        actualCompletion: dateStr(2026, 8, augOnTime),
        status: "completed",
      });

      const augLatePlanned = Math.floor(rand(18, 25));
      const augLateActual = Math.min(augLatePlanned + Math.floor(rand(1, 3)), 31);
      await db.insert(batches).values({
        batchNumber: `PAU1-${streamTag}-${String(seq++).padStart(4, "0")}`,
        plantId: paudhId,
        stream,
        plannedQty: batchQty(),
        actualQty: batchQty(),
        plannedCompletion: dateStr(2026, 8, augLatePlanned),
        actualCompletion: dateStr(2026, 8, augLateActual),
        status: "completed",
      });

      await db.insert(batches).values({
        batchNumber: `PAU1-${streamTag}-${String(seq++).padStart(4, "0")}`,
        plantId: paudhId,
        stream,
        plannedQty: batchQty(),
        actualQty: batchQty(),
        plannedCompletion: dateStr(2026, 9, 1),
        actualCompletion: dateStr(2026, 9, 1),
        status: "completed",
      });

      await db.insert(batches).values({
        batchNumber: `PAU1-${streamTag}-${String(seq++).padStart(4, "0")}`,
        plantId: paudhId,
        stream,
        plannedQty: batchQty(),
        actualQty: null,
        plannedCompletion: dateStr(2026, 9, 2),
        actualCompletion: null,
        status: "in_progress",
      });

      await db.insert(batches).values({
        batchNumber: `PAU1-${streamTag}-${String(seq++).padStart(4, "0")}`,
        plantId: paudhId,
        stream,
        plannedQty: batchQty(),
        actualQty: null,
        plannedCompletion: dateStr(2026, 9, 12),
        actualCompletion: null,
        status: "planned",
      });

      await db.insert(batches).values({
        batchNumber: `PAU1-${streamTag}-${String(seq++).padStart(4, "0")}`,
        plantId: paudhId,
        stream,
        plannedQty: batchQty(),
        actualQty: null,
        plannedCompletion: dateStr(2026, 9, 22),
        actualCompletion: null,
        status: "planned",
      });
    }
  }

  // --- Give Paudh a couple of commitments too, so it shows up on that page ---
  const allCommitments = await db.query.salesCommitments.findMany();
  const toReassign = allCommitments.slice(0, 2);
  for (const c of toReassign) {
    await db
      .update(salesCommitments)
      .set({ mfgPlantId: paudhId, dispatchLocation: "PAU1" })
      .where(eq(salesCommitments.id, c.id));
  }

  console.log("Done. Plants are now Dahej (DMP1), Jhagadia (JHA1), Paudh (PAU1).");
}

main().then(() => process.exit(0));
