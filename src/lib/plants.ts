import { getDb } from "@/db";
import { plants } from "@/db/schema";

export async function listPlants() {
  const db = getDb();
  return db.select().from(plants).orderBy(plants.code);
}
