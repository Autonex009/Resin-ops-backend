import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  plants,
  salesCommitments,
  plantCapacities,
  productionPlans,
  dailyOutputs,
  fileImports,
} from "@/db/schema";
import { parseSpreadsheet, parseWorkbookGrids } from "@/lib/spreadsheet";
import {
  normalizeStream,
  normalizeRow,
  pick,
  parseNumber,
  toDateString,
  toMonthDate,
  addDays,
  PROVISIONAL_LEAD_TIME_DAYS,
} from "@/lib/import-helpers";

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

// For sheets that give us a plant NAME but no code (e.g. "Jhagadia Plant" —
// Thermax hasn't told us their plant-code convention for this plant). Reuse
// an existing plant by name if one exists; otherwise derive a placeholder
// code so a plant record can exist at all. This code is a guess and should
// be reconciled once Thermax confirms real codes for these plants.
async function upsertPlantByName(db: Db, name: string) {
  const trimmedName = name.trim();
  const existing = await db.query.plants.findFirst({ where: eq(plants.name, trimmedName) });
  if (existing) return existing.id;

  // Derive a placeholder code from the name, but never reuse a code that
  // already belongs to a *different* plant — two names sharing a 3-letter
  // prefix (e.g. "Jhagadia" and "Jhajjar" → both "JHA") would otherwise be
  // silently merged into one plant. Walk PREFIX1, PREFIX2, … until a code is
  // free (or already owned by this exact name).
  const base = trimmedName.replace(/[^a-zA-Z0-9]/g, "").slice(0, 3).toUpperCase() || "PLT";
  for (let n = 1; ; n++) {
    const code = `${base}${n}`;
    const clash = await db.query.plants.findFirst({ where: eq(plants.code, code) });
    if (!clash) return upsertPlant(db, code, trimmedName);
    if (clash.name === trimmedName) return clash.id;
  }
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
      const r = normalizeRow(row);
      const plantCode = String(pick(r, "Mfg. Plant") ?? "").trim();
      const plantId = plantCode ? await upsertPlant(db, plantCode) : null;

      const salesOrderDate = toDateString(pick(r, "Sales Order Date"));
      const requiredDateRaw = pick(r, "Required Date");
      const requiredDate = requiredDateRaw
        ? toDateString(requiredDateRaw)
        : addDays(salesOrderDate, PROVISIONAL_LEAD_TIME_DAYS);

      await db.insert(salesCommitments).values({
        salesOrderNumber: String(pick(r, "Sales Order Number") ?? ""),
        salesOrderDate,
        requiredDate,
        salespersonName: String(pick(r, "Salesperson Name") ?? "") || null,
        customerName: String(pick(r, "Customer Name") ?? ""),
        dispatchLocation:
          String(
            pick(r, "Container Dispatch Location (Plant-internal)", "Container Dispatch Location") ?? "",
          ) || null,
        itemCode: String(pick(r, "Item Code", "Item") ?? ""),
        itemDescription: String(pick(r, "Item Description") ?? "") || null,
        balanceQty: parseNumber(pick(r, "Sales Order Primary Balance Qty")),
        palletsRequired: parseNumber(pick(r, "Pallets Required", "Pallets")),
        balanceValue: parseNumber(pick(r, "Sales Order Balance Value")),
        subPu: String(pick(r, "SUB PU") ?? "") || null,
        productSubgroup: String(pick(r, "Product Subgroup") ?? "") || null,
        businessGroup: String(pick(r, "Business Group") ?? "") || null,
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

// Thermax's "Planning-Capacity Master" export: one sheet per plant, laid out
// as a wide pivot rather than one-row-per-record. Row 2 holds the plant name
// ("Jhagadia Plant"); row 4 is the header row, where column A reads
// "<Stream> (Product Type)" — the whole sheet is scoped to that one stream.
// Data rows start at row 5: columns A-G are Product/Monthly Req/Prod
// Plan/Output/C-T, and every column from H onward is a repeating (date, A
// shift, B shift, C shift) group — monthly placeholder dates first, then
// real daily dates.
//
// There's no column that represents a hard capacity ceiling (only planning
// figures), so this feeds Plan vs Actual, not Capacity Utilization:
// "Prod Plan" summed across products -> one monthly production plan row per
// plant/stream; the daily shift columns summed (A+B+C, across products) ->
// daily output rows. Sheets that don't match this shape (Commitment File,
// Tracker, Summary) are skipped.
export async function importPlanningCapacityMaster(file: File): Promise<ImportResult> {
  const db = getDb();

  try {
    const sheets = parseWorkbookGrids(await file.arrayBuffer());

    const [importRecord] = await db
      .insert(fileImports)
      .values({ fileType: "planning_capacity_master", fileName: file.name, rowCount: sheets.length })
      .returning();

    let plansWritten = 0;
    let outputRowsWritten = 0;
    let sheetsProcessed = 0;

    for (const { sheetName, grid } of sheets) {
      const plantNameRaw = String(grid[1]?.[0] ?? "").trim();
      const typeHeaderRaw = String(grid[3]?.[0] ?? "").trim();
      if (!plantNameRaw || !typeHeaderRaw) continue;

      let stream;
      try {
        stream = normalizeStream(typeHeaderRaw);
      } catch {
        continue;
      }

      const plantName = plantNameRaw.replace(/\s+plant$/i, "").trim() || plantNameRaw;
      const plantId = await upsertPlantByName(db, plantName);

      const headerRow = grid[3] ?? [];
      const dateRow = grid[2] ?? [];

      // Shift-triple columns start after the fixed A-G columns; each date
      // owns 3 columns (A/B/C shift). The sheet mixes two kinds of date
      // column: one placeholder date per month (always the 8th — a template
      // artifact, not real output) and a real day-by-day block for the
      // current reporting month. Group by month and keep only the month
      // that has more than one distinct day — that's the real daily data.
      const allDateCols: { dateStr: string; col: number }[] = [];
      for (let col = 7; col < headerRow.length; col += 3) {
        const dateRaw = dateRow[col];
        if (dateRaw === undefined || dateRaw === "") continue;
        const dateStr = toDateString(dateRaw);
        if (dateStr) allDateCols.push({ dateStr, col });
      }
      const byMonth = new Map<string, { dateStr: string; col: number }[]>();
      for (const dc of allDateCols) {
        const month = dc.dateStr.slice(0, 7);
        if (!byMonth.has(month)) byMonth.set(month, []);
        byMonth.get(month)!.push(dc);
      }
      // The real daily block is the month with more than one distinct day
      // (single-day months are the per-month placeholder artifact). If two
      // months both look like real daily data, the "pick the first" heuristic
      // would silently drop a whole month — fail loud instead so the file can
      // be split rather than half-imported without warning.
      const multiDayMonths = [...byMonth.values()].filter((cols) => cols.length > 1);
      if (multiDayMonths.length > 1) {
        const months = multiDayMonths
          .map((cols) => cols[0].dateStr.slice(0, 7))
          .sort()
          .join(", ");
        throw new Error(
          `Sheet "${sheetName}" has real daily data for more than one month (${months}); this importer only supports one reporting month per sheet. Split the file by month and re-import.`,
        );
      }
      const dailyDateCols = multiDayMonths[0] ?? [];

      let planQtySum = 0;
      const dailyTotals = new Map<string, number>();

      for (let r = 4; r < grid.length; r++) {
        const row = grid[r] ?? [];
        const product = String(row[2] ?? "").trim();
        if (!product) continue;

        planQtySum += Number(parseNumber(row[4]));

        for (const { dateStr, col } of dailyDateCols) {
          const shiftTotal =
            Number(parseNumber(row[col])) +
            Number(parseNumber(row[col + 1])) +
            Number(parseNumber(row[col + 2]));
          if (shiftTotal > 0) {
            dailyTotals.set(dateStr, (dailyTotals.get(dateStr) ?? 0) + shiftTotal);
          }
        }
      }

      if (planQtySum > 0 && dailyDateCols.length > 0) {
        const planMonth = toMonthDate(dailyDateCols[0].dateStr);
        await db
          .insert(productionPlans)
          .values({ plantId, stream, planMonth, plannedQty: String(planQtySum) })
          .onConflictDoUpdate({
            target: [productionPlans.plantId, productionPlans.stream, productionPlans.planMonth],
            set: { plannedQty: String(planQtySum) },
          });
        plansWritten++;
      }

      for (const [dateStr, total] of dailyTotals) {
        await db
          .insert(dailyOutputs)
          .values({ plantId, stream, outputDate: dateStr, actualQty: String(total), importId: importRecord.id })
          .onConflictDoUpdate({
            target: [dailyOutputs.plantId, dailyOutputs.stream, dailyOutputs.outputDate],
            set: { actualQty: String(total), importId: importRecord.id },
          });
        outputRowsWritten++;
      }

      sheetsProcessed++;
    }

    if (sheetsProcessed === 0) {
      return {
        success: false,
        message: "No recognizable plant/stream sheets found (expected plant name in row 2, a \"<Stream> (Product Type)\" header in row 4).",
      };
    }

    return {
      success: true,
      message: `Processed ${sheetsProcessed} sheet(s): ${plansWritten} production plan row(s), ${outputRowsWritten} daily output row(s).`,
    };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) };
  }
}
