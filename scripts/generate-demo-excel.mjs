import * as XLSX from "xlsx";
import path from "node:path";
import fs from "node:fs";

const OUT_DIR = "/Users/karanpaigude/Desktop/Resin Ops Demo Files";

function writeSheet(filename, rows) {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  fs.writeFileSync(path.join(OUT_DIR, filename), buffer);
  console.log(`Wrote ${filename} (${rows.length} rows)`);
}

// --- 1. Sales Commitment: new orders, including one new plant (CHN1) to show plant auto-create ---
writeSheet("Sales Commitment - Live Demo.xlsx", [
  {
    "Sales Order Number": "SO-2026-2001",
    "Sales Order Date": "2026-09-03",
    "Salesperson Name": "R. Kulkarni",
    "Customer Name": "Deccan Water Treatment Ltd",
    "Container Dispatch Location (Plant-internal)": "DMP1",
    "Item Code": "C-100",
    "Item Description": "Cation Exchange Resin - Standard Grade",
    "Sales Order Primary Balance Qty": 180,
    "Pallets Required": 9,
    "Sales Order Balance Value": 41400,
    "SUB PU": "SUBPU-2",
    "Product Subgroup": "Ion Exchange Resin",
    "Business Group": "Municipal",
    "Mfg. Plant": "DMP1",
  },
  {
    "Sales Order Number": "SO-2026-2002",
    "Sales Order Date": "2026-09-03",
    "Salesperson Name": "S. Mehta",
    "Customer Name": "Bharat Water Solutions",
    "Container Dispatch Location (Plant-internal)": "PNQ1",
    "Item Code": "A-200",
    "Item Description": "Anion Exchange Resin - Standard Grade",
    "Sales Order Primary Balance Qty": 140,
    "Pallets Required": 7,
    "Sales Order Balance Value": 33600,
    "SUB PU": "SUBPU-1",
    "Product Subgroup": "Ion Exchange Resin",
    "Business Group": "Industrial",
    "Mfg. Plant": "PNQ1",
  },
  {
    "Sales Order Number": "SO-2026-2003",
    "Sales Order Date": "2026-09-03",
    "Salesperson Name": "A. Iyer",
    "Customer Name": "Coastal Desalination Co.",
    "Container Dispatch Location (Plant-internal)": "CHN1",
    "Item Code": "MB-300",
    "Item Description": "Mixed Bed Resin - Standard Grade",
    "Sales Order Primary Balance Qty": 95,
    "Pallets Required": 5,
    "Sales Order Balance Value": 26600,
    "SUB PU": "SUBPU-3",
    "Product Subgroup": "Ion Exchange Resin",
    "Business Group": "Power",
    "Mfg. Plant": "CHN1",
  },
  {
    "Sales Order Number": "SO-2026-2004",
    "Sales Order Date": "2026-09-03",
    "Salesperson Name": "R. Kulkarni",
    "Customer Name": "Vishwas Pharma",
    "Container Dispatch Location (Plant-internal)": "DMP1",
    "Item Code": "C-150",
    "Item Description": "Cation Exchange Resin - Premium Grade",
    "Sales Order Primary Balance Qty": 60,
    "Pallets Required": 3,
    "Sales Order Balance Value": 15600,
    "SUB PU": "SUBPU-4",
    "Product Subgroup": "Ion Exchange Resin",
    "Business Group": "Pharma",
    "Mfg. Plant": "DMP1",
  },
]);

// --- 2. Plant Capacity: next month (October), both existing plants, all 3 streams ---
writeSheet("Plant Capacity - Live Demo.xlsx", [
  { "Plant Code": "DMP1", "Plant Name": "Dahej", "Sub Product": "Standard Grade", "Stream": "Cation", "Product": "C-100", "Monthly Capacity Qty": 18000, "Effective Month": "2026-10-01" },
  { "Plant Code": "DMP1", "Plant Name": "Dahej", "Sub Product": "Standard Grade", "Stream": "Anion", "Product": "A-200", "Monthly Capacity Qty": 15000, "Effective Month": "2026-10-01" },
  { "Plant Code": "DMP1", "Plant Name": "Dahej", "Sub Product": "Standard Grade", "Stream": "Mixed Bed", "Product": "MB-300", "Monthly Capacity Qty": 9000, "Effective Month": "2026-10-01" },
  { "Plant Code": "PNQ1", "Plant Name": "Pune", "Sub Product": "Standard Grade", "Stream": "Cation", "Product": "C-150", "Monthly Capacity Qty": 12000, "Effective Month": "2026-10-01" },
  { "Plant Code": "PNQ1", "Plant Name": "Pune", "Sub Product": "Standard Grade", "Stream": "Anion", "Product": "A-250", "Monthly Capacity Qty": 10000, "Effective Month": "2026-10-01" },
  { "Plant Code": "PNQ1", "Plant Name": "Pune", "Sub Product": "Standard Grade", "Stream": "Mixed Bed", "Product": "MB-350", "Monthly Capacity Qty": 6000, "Effective Month": "2026-10-01" },
]);

// --- 3. Daily Output: fresh days (Sept 4-5) not yet in the system, both plants, all 3 streams ---
const dailyRows = [];
for (const date of ["2026-09-04", "2026-09-05"]) {
  for (const [plant, cation, anion, mb] of [
    ["DMP1", 520, 430, 260],
    ["PNQ1", 340, 290, 175],
  ]) {
    dailyRows.push({ "Plant Code": plant, "Stream": "Cation", "Date": date, "Actual Qty": cation });
    dailyRows.push({ "Plant Code": plant, "Stream": "Anion", "Date": date, "Actual Qty": anion });
    dailyRows.push({ "Plant Code": plant, "Stream": "Mixed Bed", "Date": date, "Actual Qty": mb });
  }
}
writeSheet("Daily Output - Live Demo.xlsx", dailyRows);

console.log(`\nAll files written to: ${OUT_DIR}`);
