import { eq, isNull } from "drizzle-orm";
import { getDb } from "../src/db";
import { salesCommitments } from "../src/db/schema";
import { addDays, PROVISIONAL_LEAD_TIME_DAYS } from "../src/lib/import-helpers";

async function main() {
  const db = getDb();
  const rows = await db.query.salesCommitments.findMany({
    where: isNull(salesCommitments.requiredDate),
  });

  for (const row of rows) {
    await db
      .update(salesCommitments)
      .set({ requiredDate: addDays(row.salesOrderDate, PROVISIONAL_LEAD_TIME_DAYS) })
      .where(eq(salesCommitments.id, row.id));
  }

  console.log(`Backfilled requiredDate for ${rows.length} existing commitment(s).`);
}

main().then(() => process.exit(0));
