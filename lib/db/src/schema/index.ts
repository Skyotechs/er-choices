import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const hospitalReports = pgTable("hospital_reports", {
  id: serial("id").primaryKey(),
  osmId: text("osm_id").notNull(),
  hospitalName: text("hospital_name").notNull(),
  issueType: text("issue_type").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("pending"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const insertReportSchema = createInsertSchema(hospitalReports).omit({
  id: true,
  status: true,
  submittedAt: true,
  resolvedAt: true,
});

export type InsertReport = z.infer<typeof insertReportSchema>;
export type HospitalReport = typeof hospitalReports.$inferSelect;
