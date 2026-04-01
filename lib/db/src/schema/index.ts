import { boolean, jsonb, pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";
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

/**
 * Verified hospital specialty data sourced from CMS Care Compare
 * or manually set by an admin. osmId is populated after matching
 * the CMS record to an OpenStreetMap hospital node at query time.
 */
export const hospitalSpecialties = pgTable("hospital_specialties", {
  id: serial("id").primaryKey(),
  osmId: text("osm_id"),
  cmsId: text("cms_id").notNull().unique(),
  hospitalName: text("hospital_name").notNull(),
  state: text("state").notNull(),
  latitude: real("latitude"),
  longitude: real("longitude"),
  specialties: jsonb("specialties").notNull().default([]),
  emergencyServices: boolean("emergency_services").notNull().default(false),
  source: text("source").notNull().default("cms"),
  verified: boolean("verified").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HospitalSpecialty = typeof hospitalSpecialties.$inferSelect;
export type InsertHospitalSpecialty = typeof hospitalSpecialties.$inferInsert;
