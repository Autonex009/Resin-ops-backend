import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import {
  plants,
  plantCapacities,
  productionPlans,
  dailyOutputs,
  batches,
  salesCommitments,
} from "../src/db/schema";

const db = getDb();

const STREAMS = ["cation", "anion", "mixed_bed"] as const;

const PLANT_DEFS = [
  { code: "DMP1", name: "Dahej" },
  { code: "PNQ1", name: "Pune" },
];

// monthly figures per plant+stream: [capacity, plan]
const MONTHLY: Record<string, Record<(typeof STREAMS)[number], [number, number]>> = {
  DMP1: { cation: [18000, 15000], anion: [15000, 12500], mixed_bed: [9000, 7500] },
  PNQ1: { cation: [12000, 10000], anion: [10000, 8500], mixed_bed: [6000, 5000] },
};

const PRODUCT: Record<(typeof STREAMS)[number], { sub: string; code: string }> = {
  cation: { sub: "Standard Grade", code: "C-100" },
  anion: { sub: "Standard Grade", code: "A-200" },
  mixed_bed: { sub: "Standard Grade", code: "MB-300" },
};

const CUSTOMERS = [
  "Apex Chemicals Pvt Ltd",
  "Kaveri Industries",
  "Bharat Water Solutions",
  "Sundar Power Projects",
  "Nilgiri Textiles",
  "Vishwas Pharma",
  "Ganga Steel Works",
  "Coastal Desalination Co.",
];

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function dateStr(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function upsertPlant(code: string, name: string) {
  const existing = await db.query.plants.findFirst({ where: eq(plants.code, code) });
  if (existing) return existing.id;
  const [created] = await db.insert(plants).values({ code, name }).returning();
  return created.id;
}

async function main() {
  const plantIds: Record<string, string> = {};
  for (const p of PLANT_DEFS) {
    plantIds[p.code] = await upsertPlant(p.code, p.name);
  }

  // --- Plant capacity + production plan for August (complete) and September (ongoing) ---
  for (const monthNum of [8, 9]) {
    const monthStart = dateStr(2026, monthNum, 1);
    for (const p of PLANT_DEFS) {
      for (const stream of STREAMS) {
        const [capacity, plan] = MONTHLY[p.code][stream];
        const { sub, code } = PRODUCT[stream];

        await db.insert(plantCapacities).values({
          plantId: plantIds[p.code],
          stream,
          subProduct: sub,
          product: code,
          monthlyCapacityQty: String(capacity),
          effectiveMonth: monthStart,
        });

        await db.insert(productionPlans).values({
          plantId: plantIds[p.code],
          stream,
          planMonth: monthStart,
          plannedQty: String(plan),
        });
      }
    }
  }

  // --- Daily output: full August, plus first 3 days of September ---
  for (const p of PLANT_DEFS) {
    for (const stream of STREAMS) {
      const [, augPlan] = MONTHLY[p.code][stream];
      const augDailyTarget = augPlan / 31;

      for (let day = 1; day <= 31; day++) {
        const actual = Math.round(augDailyTarget * rand(0.85, 1.15));
        await db
          .insert(dailyOutputs)
          .values({
            plantId: plantIds[p.code],
            stream,
            outputDate: dateStr(2026, 8, day),
            actualQty: String(actual),
          })
          .onConflictDoNothing();
      }

      const [, sepPlan] = MONTHLY[p.code][stream];
      const sepDailyTarget = sepPlan / 30;
      for (let day = 1; day <= 3; day++) {
        const actual = Math.round(sepDailyTarget * rand(1.0, 1.2));
        await db
          .insert(dailyOutputs)
          .values({
            plantId: plantIds[p.code],
            stream,
            outputDate: dateStr(2026, 9, day),
            actualQty: String(actual),
          })
          .onConflictDoNothing();
      }
    }
  }

  // --- Batches: a finished August history + a live September mix ---
  let batchSeq = 1;
  for (const p of PLANT_DEFS) {
    for (const stream of STREAMS) {
      const streamTag = stream === "mixed_bed" ? "MB" : stream.slice(0, 3).toUpperCase();
      const batchQty = () => String(Math.round(rand(150, 400)));

      // August: two completed batches, one on-time, one a couple days late
      const augOnTime = Math.floor(rand(5, 15));
      await db.insert(batches).values({
        batchNumber: `${p.code}-${streamTag}-${String(batchSeq++).padStart(4, "0")}`,
        plantId: plantIds[p.code],
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
        batchNumber: `${p.code}-${streamTag}-${String(batchSeq++).padStart(4, "0")}`,
        plantId: plantIds[p.code],
        stream,
        plannedQty: batchQty(),
        actualQty: batchQty(),
        plannedCompletion: dateStr(2026, 8, augLatePlanned),
        actualCompletion: dateStr(2026, 8, augLateActual),
        status: "completed",
      });

      // September: one completed on day 1, one overdue (no completion, behind),
      // one in progress upcoming, one planned further out
      await db.insert(batches).values({
        batchNumber: `${p.code}-${streamTag}-${String(batchSeq++).padStart(4, "0")}`,
        plantId: plantIds[p.code],
        stream,
        plannedQty: batchQty(),
        actualQty: batchQty(),
        plannedCompletion: dateStr(2026, 9, 1),
        actualCompletion: dateStr(2026, 9, 1),
        status: "completed",
      });

      await db.insert(batches).values({
        batchNumber: `${p.code}-${streamTag}-${String(batchSeq++).padStart(4, "0")}`,
        plantId: plantIds[p.code],
        stream,
        plannedQty: batchQty(),
        actualQty: null,
        plannedCompletion: dateStr(2026, 9, 2),
        actualCompletion: null,
        status: "in_progress",
      });

      await db.insert(batches).values({
        batchNumber: `${p.code}-${streamTag}-${String(batchSeq++).padStart(4, "0")}`,
        plantId: plantIds[p.code],
        stream,
        plannedQty: batchQty(),
        actualQty: null,
        plannedCompletion: dateStr(2026, 9, 12),
        actualCompletion: null,
        status: "planned",
      });

      await db.insert(batches).values({
        batchNumber: `${p.code}-${streamTag}-${String(batchSeq++).padStart(4, "0")}`,
        plantId: plantIds[p.code],
        stream,
        plannedQty: batchQty(),
        actualQty: null,
        plannedCompletion: dateStr(2026, 9, 22),
        actualCompletion: null,
        status: "planned",
      });
    }
  }

  // --- Sales commitments ---
  const items: { code: string; desc: string; group: string }[] = [
    { code: "C-100", desc: "Cation Exchange Resin - Standard Grade", group: "Industrial" },
    { code: "A-200", desc: "Anion Exchange Resin - Standard Grade", group: "Municipal" },
    { code: "MB-300", desc: "Mixed Bed Resin - Standard Grade", group: "Power" },
    { code: "C-150", desc: "Cation Exchange Resin - Premium Grade", group: "Pharma" },
  ];

  for (let i = 0; i < 16; i++) {
    const plant = PLANT_DEFS[i % PLANT_DEFS.length];
    const item = items[i % items.length];
    const customer = CUSTOMERS[i % CUSTOMERS.length];
    const day = 3 + (i % 26);
    const month = i % 3 === 0 ? 8 : 9;
    const qty = Math.round(rand(20, 250));
    const value = qty * Math.round(rand(180, 260));

    await db.insert(salesCommitments).values({
      salesOrderNumber: `SO-2026-${String(1000 + i)}`,
      salesOrderDate: dateStr(2026, month, day),
      salespersonName: ["R. Kulkarni", "S. Mehta", "A. Iyer"][i % 3],
      customerName: customer,
      dispatchLocation: plant.code,
      itemCode: item.code,
      itemDescription: item.desc,
      balanceQty: String(qty),
      palletsRequired: String(Math.max(1, Math.round(qty / 20))),
      balanceValue: String(value),
      subPu: `SUBPU-${(i % 4) + 1}`,
      productSubgroup: "Ion Exchange Resin",
      businessGroup: item.group,
      mfgPlantId: plantIds[plant.code],
    });
  }

  console.log("Seeded demo dataset: plants, capacity, production plans, daily output, batches, commitments.");
}

main().then(() => process.exit(0));
