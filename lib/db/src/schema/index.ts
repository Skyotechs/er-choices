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
 *
 * needsAdminReview: jsonb array of designation strings that could not be
 * sourced from any public dataset and require manual admin verification.
 */
export const hospitalSpecialties = pgTable("hospital_specialties", {
  id: serial("id").primaryKey(),
  osmId: text("osm_id"),
  cmsId: text("cms_id").notNull().unique(),
  hospitalName: text("hospital_name").notNull(),
  address: text("address"),
  city: text("city"),
  state: text("state").notNull(),
  zip: text("zip"),
  phone: text("phone"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  specialties: jsonb("specialties").notNull().default([]),
  emergencyServices: boolean("emergency_services").notNull().default(false),
  source: text("source").notNull().default("cms"),
  verified: boolean("verified").notNull().default(true),
  needsAdminReview: jsonb("needs_admin_review").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HospitalSpecialty = typeof hospitalSpecialties.$inferSelect;
export type InsertHospitalSpecialty = typeof hospitalSpecialties.$inferInsert;

/**
 * Canonical list of all 16 specialty designations recognized by the system.
 * This table is the single source of truth for valid designation strings.
 * Seeded on startup; never deleted at runtime.
 */
export const specialtyDefinitions = pgTable("specialty_definitions", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  category: text("category").notNull(),
  cmsField: text("cms_field"),
  sourceable: boolean("sourceable").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SpecialtyDefinition = typeof specialtyDefinitions.$inferSelect;
export type InsertSpecialtyDefinition = typeof specialtyDefinitions.$inferInsert;

/**
 * Admin-sourced overrides for hospital phone, latitude, and longitude.
 * These values take priority over OSM source data when present.
 */
export const hospitalOverrides = pgTable("hospital_overrides", {
  id: serial("id").primaryKey(),
  osmId: text("osm_id").notNull().unique(),
  phone: text("phone"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HospitalOverride = typeof hospitalOverrides.$inferSelect;
export type InsertHospitalOverride = typeof hospitalOverrides.$inferInsert;
