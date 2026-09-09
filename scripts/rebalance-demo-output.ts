import { and, eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { plants, dailyOutputs } from "../src/db/schema";

const db = getDb();

const STREAMS = ["cation", "anion", "mixed_bed"] as const;

const PLANT_DEFS = [
  { code: "DMP1", name: "Dahej" },
  { code: "PNQ1", name: "Pune" },
];

// Same monthly capacity figures as scripts/seed-demo.ts.
const MONTHLY_CAPACITY: Record<string, Record<(typeof STREAMS)[number], number>> = {
  DMP1: { cation: 18000, anion: 15000, mixed_bed: 9000 },
  PNQ1: { cation: 12000, anion: 10000, mixed_bed: 6000 },
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
    if (!row) throw new Error(`Plant ${p.code} not found — run seed-demo.ts first`);
    plantIds[p.code] = row.id;
  }

  // Clear existing daily output for these plants/streams, then repopulate
  // every day (both months) at ~50-60% of that day's fair capacity share.
  for (const p of PLANT_DEFS) {
    for (const stream of STREAMS) {
      await db
        .delete(dailyOutputs)
        .where(and(eq(dailyOutputs.plantId, plantIds[p.code]), eq(dailyOutputs.stream, stream)));
    }
  }

  for (const monthNum of [8, 9]) {
    const numDays = daysInMonth(2026, monthNum);
    for (const p of PLANT_DEFS) {
      for (const stream of STREAMS) {
        const capacity = MONTHLY_CAPACITY[p.code][stream];
        const dailyCapacity = capacity / numDays;

        for (let day = 1; day <= numDays; day++) {
          const actual = Math.round(dailyCapacity * rand(0.5, 0.6));
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

  console.log("Done.");
}

main().then(() => process.exit(0));
