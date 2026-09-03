import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  plants,
  salesCommitments,
  plantCapacities,
  dailyOutputs,
  fileImports,
} from "@/db/schema";
import { parseSpreadsheet } from "@/lib/spreadsheet";
import { normalizeStream, parseNumber, toDateString, toMonthDate } from "@/lib/import-helpers";

export type ImportResult = { success: boolean; message: string };

type Db = ReturnType<typeof getDb>;

async function upsertPlant(db: Db, code: string, name?: string) {
  const trimmedCode = code.trim();
  const existing = await db.query.plants.findFirst({ where: eq(plants.code, trimmedCode) });
  if (existing) return existing.id;
  const [created] = await db
    .insert(plants)
    .values({ code: trimmedCode, name: name?.trim() || trimmedCode })
    .returning();
  return created.id;
}

export async function importSalesCommitments(file: File): Promise<ImportResult> {
  const db = getDb();

  try {
    const rows = parseSpreadsheet(await file.arrayBuffer());
    if (rows.length === 0) return { success: false, message: "File has no rows." };

    const [importRecord] = await db
      .insert(fileImports)
      .values({ fileType: "sales_commitment", fileName: file.name, rowCount: rows.length })
      .returning();

    for (const row of rows) {
      const plantCode = String(row["Mfg. Plant"] ?? "").trim();
      const plantId = plantCode ? await upsertPlant(db, plantCode) : null;

      await db.insert(salesCommitments).values({
        salesOrderNumber: String(row["Sales Order Number"] ?? ""),
        salesOrderDate: toDateString(row["Sales Order Date"]),
        salespersonName: String(row["Salesperson Name"] ?? "") || null,
        customerName: String(row["Customer Name"] ?? ""),
        dispatchLocation:
          String(row["Container Dispatch Location (Plant-internal)"] ?? "") || null,
        itemCode: String(row["Item Code"] ?? ""),
        itemDescription: String(row["Item Description"] ?? "") || null,
        balanceQty: parseNumber(row["Sales Order Primary Balance Qty"]),
        palletsRequired: parseNumber(row["Pallets Required"]),
        balanceValue: parseNumber(row["Sales Order Balance Value"]),
        subPu: String(row["SUB PU"] ?? "") || null,
        productSubgroup: String(row["Product Subgroup"] ?? "") || null,
        businessGroup: String(row["Business Group"] ?? "") || null,
        mfgPlantId: plantId,
        importId: importRecord.id,
      });
    }

    return { success: true, message: `Imported ${rows.length} sales commitment rows.` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export async function importPlantCapacity(file: File): Promise<ImportResult> {
  const db = getDb();

  try {
    const rows = parseSpreadsheet(await file.arrayBuffer());
    if (rows.length === 0) return { success: false, message: "File has no rows." };

    const [importRecord] = await db
      .insert(fileImports)
      .values({ fileType: "plant_capacity", fileName: file.name, rowCount: rows.length })
      .returning();

    for (const row of rows) {
      const plantId = await upsertPlant(
        db,
        String(row["Plant Code"] ?? ""),
        String(row["Plant Name"] ?? ""),
      );

      await db.insert(plantCapacities).values({
        plantId,
        stream: normalizeStream(row["Stream"]),
        subProduct: String(row["Sub Product"] ?? ""),
        product: String(row["Product"] ?? ""),
        monthlyCapacityQty: parseNumber(row["Monthly Capacity Qty"]),
        effectiveMonth: toMonthDate(row["Effective Month"]),
        importId: importRecord.id,
      });
    }

    return { success: true, message: `Imported ${rows.length} plant capacity rows.` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export async function importDailyOutput(file: File): Promise<ImportResult> {
  const db = getDb();

  try {
    const rows = parseSpreadsheet(await file.arrayBuffer());
    if (rows.length === 0) return { success: false, message: "File has no rows." };

    const [importRecord] = await db
      .insert(fileImports)
      .values({ fileType: "daily_output", fileName: file.name, rowCount: rows.length })
      .returning();

    for (const row of rows) {
      const plantId = await upsertPlant(db, String(row["Plant Code"] ?? ""));

      await db
        .insert(dailyOutputs)
        .values({
          plantId,
          stream: normalizeStream(row["Stream"]),
          outputDate: toDateString(row["Date"]),
          actualQty: parseNumber(row["Actual Qty"]),
          importId: importRecord.id,
        })
        .onConflictDoUpdate({
          target: [dailyOutputs.plantId, dailyOutputs.stream, dailyOutputs.outputDate],
          set: { actualQty: parseNumber(row["Actual Qty"]), importId: importRecord.id },
        });
    }

    return { success: true, message: `Imported ${rows.length} daily output rows.` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) };
  }
}
