import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { plants, plantCapacities, productionPlans, dailyOutputs, salesCommitments } from "../src/db/schema";

// Calibrated against Thermax's real "Sample Templates.xlsx" (Tracker/Summary
// sheets): total planned/actual output across plants runs in m3/day, with
// ~80% attainment (912 actual / 1142 planned m3 as of the 8/16 snapshot).
// Dahej is the largest plant (~33-41 m3/day); the second plant here is
// scaled to roughly Jhagadia's real range (~22-30 m3/day) even though it's
// still named "Pune" in this demo -- see conversation notes on plant names.
const db = getDb();

const STREAMS = ["cation", "anion", "mixed_bed"] as const;

const PLANT_DEFS = [
  { code: "DMP1", name: "Dahej" },
  { code: "PNQ1", name: "Pune" },
];

// Monthly capacity (m3), split cation/anion/mixed_bed in the same
// proportions as before, rescaled to real plant-level monthly totals.
const MONTHLY_CAPACITY: Record<string, Record<(typeof STREAMS)[number], number>> = {
  DMP1: { cation: 520, anion: 430, mixed_bed: 250 }, // 1200 m3/month
  PNQ1: { cation: 345, anion: 290, mixed_bed: 165 }, // 800 m3/month
};

// Monthly production plan (m3) -- ~85% of capacity, matching the existing
// capacity/plan headroom ratio.
const MONTHLY_PLAN: Record<string, Record<(typeof STREAMS)[number], number>> = {
  DMP1: { cation: 440, anion: 365, mixed_bed: 210 }, // 1015 m3/month
  PNQ1: { cation: 293, anion: 246, mixed_bed: 140 }, // 679 m3/month
};

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
  const plantIds: Record<string, string> = {};
  for (const p of PLANT_DEFS) {
    const row = await db.query.plants.findFirst({ where: eq(plants.code, p.code) });
    if (!row) throw new Error(`Plant ${p.code} not found -- run seed-demo.ts first`);
    plantIds[p.code] = row.id;
  }

  // --- Capacity + production plan (August, September) ---
  for (const p of PLANT_DEFS) {
    await db.delete(plantCapacities).where(eq(plantCapacities.plantId, plantIds[p.code]));
  }
  for (const monthNum of [8, 9]) {
    const monthStart = dateStr(2026, monthNum, 1);
    for (const p of PLANT_DEFS) {
      for (const stream of STREAMS) {
        const capacity = MONTHLY_CAPACITY[p.code][stream];
        const plan = MONTHLY_PLAN[p.code][stream];
        const { sub, code } = PRODUCT[stream];

        await db.insert(plantCapacities).values({
          plantId: plantIds[p.code],
          stream,
          subProduct: sub,
          product: code,
          monthlyCapacityQty: String(capacity),
          effectiveMonth: monthStart,
        });

        await db
          .insert(productionPlans)
          .values({ plantId: plantIds[p.code], stream, planMonth: monthStart, plannedQty: String(plan) })
          .onConflictDoUpdate({
            target: [productionPlans.plantId, productionPlans.stream, productionPlans.planMonth],
            set: { plannedQty: String(plan) },
          });
      }
    }
  }

  // --- Daily output: ~80% of plan (matching the real 912/1142 attainment) ---
  for (const p of PLANT_DEFS) {
    for (const stream of STREAMS) {
      await db
        .delete(dailyOutputs)
        .where(eq(dailyOutputs.plantId, plantIds[p.code]));
    }
  }
  for (const monthNum of [8, 9]) {
    const numDays = daysInMonth(2026, monthNum);
    for (const p of PLANT_DEFS) {
      for (const stream of STREAMS) {
        const plan = MONTHLY_PLAN[p.code][stream];
        const dailyTarget = plan / numDays;
        for (let day = 1; day <= numDays; day++) {
          const actual = Math.round(dailyTarget * rand(0.75, 0.85) * 10) / 10;
          await db.insert(dailyOutputs).values({
            plantId: plantIds[p.code],
            stream,
            outputDate: dateStr(2026, monthNum, day),
            actualQty: String(actual),
          });
        }
      }
    }
  }

  // --- Sales commitments: rescale balance qty to real order-line magnitude
  // (real file: 6,792-22,640 units at ~217-311 INR/unit, ~1,132 units/pallet) ---
  const existing = await db.query.salesCommitments.findMany();
  for (const row of existing) {
    const qty = Math.round(rand(3000, 25000));
    const value = qty * Math.round(rand(200, 310));
    const pallets = Math.max(1, Math.round(qty / 1132));
    await db
      .update(salesCommitments)
      .set({ balanceQty: String(qty), balanceValue: String(value), palletsRequired: String(pallets) })
      .where(eq(salesCommitments.id, row.id));
  }

  console.log("Done.");
}

main().then(() => process.exit(0));
