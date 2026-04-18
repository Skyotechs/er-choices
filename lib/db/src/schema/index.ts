import { boolean, integer, jsonb, pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";
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
  /**
   * Per-designation source provenance map.
   * Keys are canonical designation strings; values are source tags.
   * Example: { "Trauma - Adult Level 1 & 2": "acs", "Behavioral Health": "samhsa" }
   * Updated incrementally as each import phase resolves new designations.
   * A designation absent from this map was either not yet sourced or came from CMS.
   */
  designationSources: jsonb("designation_sources").notNull().default({}),
  verified: boolean("verified").notNull().default(true),
  needsAdminReview: jsonb("needs_admin_review").notNull().default([]),
  // ── Enriched fields from HIFLD / first-responder research pass ──────────────
  /** e.g. "Level II Trauma Center; Acute Care Hospital" */
  actualDesignation: text("actual_designation"),
  /** e.g. "General Acute Care", "Critical Access", "Psychiatric" */
  serviceLine: text("service_line"),
  /** e.g. "Trauma capability; Helipad" */
  advancedCapabilities: text("advanced_capabilities"),
  /** Pipe-separated EMS classification tags, e.g. "TRAUMA_1 | HELIPAD | ED" */
  emsTags: text("ems_tags"),
  /** Whether the facility has a helipad (from HIFLD) */
  helipad: boolean("helipad"),
  /** Staffed bed count from HIFLD */
  beds: integer("beds"),
  /** Ownership type from HIFLD, e.g. "GOVERNMENT - STATE", "VOLUNTARY NON-PROFIT" */
  hifldOwner: text("hifld_owner"),
  /** Official website from HIFLD */
  hifldWebsite: text("hifld_website"),
  /** Stroke center designation, e.g. "Comprehensive Stroke Center" */
  strokeDesignation: text("stroke_designation"),
  /** Burn center designation */
  burnDesignation: text("burn_designation"),
  /** PCI/STEMI capability description */
  pciCapability: text("pci_capability"),
  /** HIFLD match confidence: HIGH | MEDIUM | LOW | UNMATCHED */
  hifldMatchConfidence: text("hifld_match_confidence"),
  /** Whether this record is active. False = soft-deleted; excluded from nearby-hospitals query. */
  active: boolean("active").notNull().default(true),
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
