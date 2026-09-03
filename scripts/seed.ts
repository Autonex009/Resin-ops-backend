import { getDb } from "../src/db";
import { plants } from "../src/db/schema";

async function main() {
  const db = getDb();

  await db
    .insert(plants)
    .values([{ code: "DMP1", name: "Dahej" }])
    .onConflictDoNothing();

  console.log("Seeded plants.");
}

main().then(() => process.exit(0));
