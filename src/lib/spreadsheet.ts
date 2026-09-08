import * as XLSX from "xlsx";

export function parseSpreadsheet(buffer: ArrayBuffer): Record<string, unknown>[] {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

// Raw row/column grid access for sheets that aren't a simple header-row +
// data-rows table (e.g. Thermax's Planning-Capacity Master, which is a wide
// pivot with plant name and section headers at fixed cell positions). One
// grid per sheet in the workbook, in sheet order.
export type SheetGrid = { sheetName: string; grid: unknown[][] };

export function parseWorkbookGrids(buffer: ArrayBuffer): SheetGrid[] {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  return workbook.SheetNames.map((sheetName) => ({
    sheetName,
    grid: XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: "",
      raw: false,
    }) as unknown[][],
  }));
}
