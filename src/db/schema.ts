import {
  pgEnum,
  pgTable,
  uuid,
  text,
  numeric,
  date,
  timestamp,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const streamEnum = pgEnum("stream", ["cation", "anion", "mixed_bed"]);

export const batchStatusEnum = pgEnum("batch_status", [
  "planned",
  "in_progress",
  "completed",
  "delayed",
]);

export const fileImportTypeEnum = pgEnum("file_import_type", [
  "sales_commitment",
  "plant_capacity",
  "daily_output",
]);

// Plants — e.g. DMP1 (Dahej). Source of truth for which plants exist.
export const plants = pgTable("plants", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(), // e.g. "DMP1"
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("plants_code_idx").on(table.code),
]);

// Plant Capacity Master File: Sub Product -> Stream -> Product, by plant.
// Anchor/source-of-truth for what can be produced, where, and how much.
export const plantCapacities = pgTable("plant_capacities", {
  id: uuid("id").primaryKey().defaultRandom(),
  plantId: uuid("plant_id").notNull().references(() => plants.id, { onDelete: "cascade" }),
  stream: streamEnum("stream").notNull(),
  subProduct: text("sub_product").notNull(),
  product: text("product").notNull(),
  monthlyCapacityQty: numeric("monthly_capacity_qty", { precision: 14, scale: 2 }).notNull(),
  effectiveMonth: date("effective_month").notNull(),
  importId: uuid("import_id").references(() => fileImports.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Sales Commitment Data (Next Month) — demand-side input driving the plan.
export const salesCommitments = pgTable("sales_commitments", {
  id: uuid("id").primaryKey().defaultRandom(),
  salesOrderNumber: text("sales_order_number").notNull(),
  salesOrderDate: date("sales_order_date").notNull(),
  salespersonName: text("salesperson_name"),
  customerName: text("customer_name").notNull(),
  dispatchLocation: text("dispatch_location"),
  itemCode: text("item_code").notNull(),
  itemDescription: text("item_description"),
  balanceQty: numeric("balance_qty", { precision: 14, scale: 2 }).notNull(),
  palletsRequired: numeric("pallets_required", { precision: 12, scale: 2 }),
  balanceValue: numeric("balance_value", { precision: 16, scale: 2 }),
  subPu: text("sub_pu"),
  productSubgroup: text("product_subgroup"),
  businessGroup: text("business_group"),
  mfgPlantId: uuid("mfg_plant_id").references(() => plants.id, { onDelete: "set null" }),
  importId: uuid("import_id").references(() => fileImports.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Stream-wise Monthly Production Plan, per plant, derived from capacity + commitments.
export const productionPlans = pgTable("production_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  plantId: uuid("plant_id").notNull().references(() => plants.id, { onDelete: "cascade" }),
  stream: streamEnum("stream").notNull(),
  planMonth: date("plan_month").notNull(),
  plannedQty: numeric("planned_qty", { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("production_plans_plant_stream_month_idx").on(table.plantId, table.stream, table.planMonth),
]);

// Batch schedule — atomic unit of production scheduling.
export const batches = pgTable("batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchNumber: text("batch_number").notNull(),
  plantId: uuid("plant_id").notNull().references(() => plants.id, { onDelete: "cascade" }),
  stream: streamEnum("stream").notNull(),
  plannedQty: numeric("planned_qty", { precision: 14, scale: 2 }).notNull(),
  actualQty: numeric("actual_qty", { precision: 14, scale: 2 }),
  plannedCompletion: date("planned_completion").notNull(),
  actualCompletion: date("actual_completion"),
  status: batchStatusEnum("status").default("planned").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Daily output tracking — actuals per plant/stream/day.
export const dailyOutputs = pgTable("daily_outputs", {
  id: uuid("id").primaryKey().defaultRandom(),
  plantId: uuid("plant_id").notNull().references(() => plants.id, { onDelete: "cascade" }),
  stream: streamEnum("stream").notNull(),
  outputDate: date("output_date").notNull(),
  actualQty: numeric("actual_qty", { precision: 14, scale: 2 }).notNull(),
  importId: uuid("import_id").references(() => fileImports.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("daily_outputs_plant_stream_date_idx").on(table.plantId, table.stream, table.outputDate),
]);

// Tracks each file import (Phase 1 is file-import based — no direct ERP integration).
export const fileImports = pgTable("file_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileType: fileImportTypeEnum("file_type").notNull(),
  fileName: text("file_name").notNull(),
  uploadedBy: text("uploaded_by"),
  rowCount: integer("row_count"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const plantsRelations = relations(plants, ({ many }) => ({
  capacities: many(plantCapacities),
  salesCommitments: many(salesCommitments),
  productionPlans: many(productionPlans),
  batches: many(batches),
  dailyOutputs: many(dailyOutputs),
}));

export const plantCapacitiesRelations = relations(plantCapacities, ({ one }) => ({
  plant: one(plants, { fields: [plantCapacities.plantId], references: [plants.id] }),
  import: one(fileImports, { fields: [plantCapacities.importId], references: [fileImports.id] }),
}));

export const salesCommitmentsRelations = relations(salesCommitments, ({ one }) => ({
  plant: one(plants, { fields: [salesCommitments.mfgPlantId], references: [plants.id] }),
  import: one(fileImports, { fields: [salesCommitments.importId], references: [fileImports.id] }),
}));

export const productionPlansRelations = relations(productionPlans, ({ one }) => ({
  plant: one(plants, { fields: [productionPlans.plantId], references: [plants.id] }),
}));

export const batchesRelations = relations(batches, ({ one }) => ({
  plant: one(plants, { fields: [batches.plantId], references: [plants.id] }),
}));

export const dailyOutputsRelations = relations(dailyOutputs, ({ one }) => ({
  plant: one(plants, { fields: [dailyOutputs.plantId], references: [plants.id] }),
  import: one(fileImports, { fields: [dailyOutputs.importId], references: [fileImports.id] }),
}));

export const fileImportsRelations = relations(fileImports, ({ many }) => ({
  plantCapacities: many(plantCapacities),
  salesCommitments: many(salesCommitments),
  dailyOutputs: many(dailyOutputs),
}));
