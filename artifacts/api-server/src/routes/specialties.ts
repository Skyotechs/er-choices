import { Router } from "express";
import { db, hospitalSpecialties, specialtyDefinitions } from "@workspace/db";
import { isNotNull, eq, sql, count } from "drizzle-orm";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const router = Router();

function requireAdmin(req: any, res: any, next: any) {
  const secret = process.env.ADMIN_SECRET;
  const auth = (req.headers["authorization"] as string) ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!secret || token !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/**
 * Normalise a DB-stored osmId to the mobile app's format.
 * DB (import script): "node/6779584037"  →  App: "osm-node-6779584037"
 * Admin-set ids already use the app format ("osm-node-…") and pass through unchanged.
 */
function normaliseOsmId(dbId: string): string {
  if (dbId.startsWith("osm-")) return dbId;
  return "osm-" + dbId.replace("/", "-");
}

/**
 * All 16 canonical specialty designations.
 * These mirror the specialty_definitions table (seeded on startup).
 */
export const ALL_16_DESIGNATIONS: Array<{
  key: string;
  label: string;
  category: string;
  cmsField: string | null;
  sourceable: boolean;
  notes: string | null;
}> = [
  {
    key: "Behavioral Health",
    label: "Behavioral Health",
    category: "Psychiatric",
    cmsField: null,
    sourceable: false,
    notes: "CMS does not carry this designation; requires admin entry.",
  },
  {
    key: "Burn Center - Adult",
    label: "Burn Center – Adult",
    category: "Burn",
    cmsField: null,
    sourceable: false,
    notes: "Verified by ABA; no free national API available.",
  },
  {
    key: "Burn Center - Pediatric",
    label: "Burn Center – Pediatric",
    category: "Burn",
    cmsField: null,
    sourceable: false,
    notes: "Verified by ABA; no free national API available.",
  },
  {
    key: "Cardiac - PCI Capable",
    label: "Cardiac – PCI Capable",
    category: "Cardiac",
    cmsField: null,
    sourceable: false,
    notes: "CMS General Information does not carry PCI capability data. Requires admin entry.",
  },
  {
    key: "HazMat/Decontamination",
    label: "HazMat / Decontamination",
    category: "HazMat",
    cmsField: null,
    sourceable: false,
    notes: "No reliable national public dataset; always requires admin entry.",
  },
  {
    key: "Obstetrics",
    label: "Obstetrics",
    category: "Obstetrics",
    cmsField: null,
    sourceable: false,
    notes: "Not in CMS General Information; requires admin entry or OSM tag match.",
  },
  {
    key: "Pediatric Care",
    label: "Pediatric Care",
    category: "Pediatric",
    cmsField: null,
    sourceable: false,
    notes: "Not directly in CMS; inferred from hospital name/type.",
  },
  {
    key: "Stroke - Comprehensive Center",
    label: "Stroke – Comprehensive Center",
    category: "Stroke",
    cmsField: null,
    sourceable: false,
    notes: "Certified by Joint Commission/DNV; no free public API.",
  },
  {
    key: "Stroke - Thrombectomy Capable Center",
    label: "Stroke – Thrombectomy Capable Center",
    category: "Stroke",
    cmsField: null,
    sourceable: false,
    notes: "Certified by Joint Commission/DNV; no free public API.",
  },
  {
    key: "Stroke - Primary Center",
    label: "Stroke – Primary Center",
    category: "Stroke",
    cmsField: null,
    sourceable: false,
    notes: "Certified by Joint Commission/DNV; no free public API.",
  },
  {
    key: "Stroke - Acute Ready Center",
    label: "Stroke – Acute Ready Center",
    category: "Stroke",
    cmsField: null,
    sourceable: false,
    notes: "State-certified; no unified national public dataset.",
  },
  {
    key: "Trauma - Adult Level 1 & 2",
    label: "Trauma – Adult Level 1 & 2",
    category: "Trauma",
    cmsField: null,
    sourceable: true,
    notes: "Supplementary source: HRSA hospital list (trauma level tags) and OSM trauma= tag. Unmatched hospitals require admin entry.",
  },
  {
    key: "Trauma - Adult Level 3",
    label: "Trauma – Adult Level 3",
    category: "Trauma",
    cmsField: null,
    sourceable: true,
    notes: "Supplementary source: HRSA hospital list (trauma level tags) and OSM trauma= tag. Unmatched hospitals require admin entry.",
  },
  {
    key: "Trauma - Adult Level 4",
    label: "Trauma – Adult Level 4",
    category: "Trauma",
    cmsField: null,
    sourceable: true,
    notes: "Supplementary source: HRSA hospital list (trauma level tags) and OSM trauma= tag. Unmatched hospitals require admin entry.",
  },
  {
    key: "Trauma - Pediatric Level 1",
    label: "Trauma – Pediatric Level 1",
    category: "Trauma",
    cmsField: null,
    sourceable: true,
    notes: "Supplementary source: HRSA hospital list (trauma level tags) and OSM trauma= tag. Unmatched hospitals require admin entry.",
  },
  {
    key: "Trauma - Pediatric Level 2",
    label: "Trauma – Pediatric Level 2",
    category: "Trauma",
    cmsField: null,
    sourceable: true,
    notes: "Supplementary source: HRSA hospital list (trauma level tags) and OSM trauma= tag. Unmatched hospitals require admin entry.",
  },
];

const VALID_SPECIALTY_KEYS = new Set(ALL_16_DESIGNATIONS.map((d) => d.key));

/**
 * Also accept the legacy short-form specialty strings used by the existing
 * admin UI specialty editor (Trauma, Cardiac, Stroke, etc.) so old records
 * are not rejected. These are mapped from CMS import / OSM inference.
 */
const LEGACY_VALID_SPECIALTIES = new Set([
  "Trauma",
  "Cardiac",
  "Stroke",
  "Pediatric",
  "Burn",
  "Obstetrics",
  "Psychiatric",
  "Cancer",
]);

function isValidSpecialty(s: string): boolean {
  return VALID_SPECIALTY_KEYS.has(s) || LEGACY_VALID_SPECIALTIES.has(s);
}

/**
 * Seed the specialty_definitions table with the 16 canonical designations.
 * Safe to call on every startup — uses upsert on the `key` column.
 */
export async function seedSpecialtyDefinitions(): Promise<void> {
  try {
    for (const def of ALL_16_DESIGNATIONS) {
      await db
        .insert(specialtyDefinitions)
        .values({
          key: def.key,
          label: def.label,
          category: def.category,
          cmsField: def.cmsField,
          sourceable: def.sourceable,
          notes: def.notes,
        })
        .onConflictDoUpdate({
          target: specialtyDefinitions.key,
          set: {
            label: def.label,
            category: def.category,
            cmsField: def.cmsField,
            sourceable: def.sourceable,
            notes: def.notes,
          },
        });
    }
    console.log("[specialties] Seeded", ALL_16_DESIGNATIONS.length, "specialty definitions");
  } catch (err) {
    console.error("[specialties] Failed to seed specialty definitions:", err);
  }
}

/**
 * Translate canonical designation strings (e.g. "Trauma - Adult Level 1 & 2") to the
 * legacy HospitalCategory values the mobile app expects ("Trauma", "Cardiac", etc.).
 *
 * This is the backwards-compat layer between the 16-designation internal model and
 * the 9-value HospitalCategory union the mobile client filters by.
 * Canonical strings that don't map to any legacy category are dropped from the
 * external response (they are still visible via the admin gap UI).
 */
const CANONICAL_TO_LEGACY: Record<string, string> = {
  "Behavioral Health":                    "Psychiatric",
  "Burn Center - Adult":                  "Burn",
  "Burn Center - Pediatric":              "Burn",
  "Cardiac - PCI Capable":               "Cardiac",
  "HazMat/Decontamination":              "Trauma",   // nearest general emergency category
  "Obstetrics":                           "Obstetrics",
  "Pediatric Care":                       "Pediatric",
  "Stroke - Comprehensive Center":        "Stroke",
  "Stroke - Thrombectomy Capable Center": "Stroke",
  "Stroke - Primary Center":             "Stroke",
  "Stroke - Acute Ready Center":         "Stroke",
  "Trauma - Adult Level 1 & 2":          "Trauma",
  "Trauma - Adult Level 3":              "Trauma",
  "Trauma - Adult Level 4":              "Trauma",
  "Trauma - Pediatric Level 1":          "Trauma",
  "Trauma - Pediatric Level 2":          "Trauma",
};

/**
 * Translate a list of raw specialty strings (may be canonical or legacy) to the
 * legacy HospitalCategory set the mobile app expects.
 * Legacy strings that are already valid pass through unchanged.
 * Duplicates are removed.
 */
const LEGACY_CATEGORIES = new Set([
  "Trauma", "Stroke", "Obstetrics", "Burn", "Pediatric",
  "Psychiatric", "Cardiac", "Cancer",
]);

function toMobileCategories(rawSpecialties: string[]): string[] {
  const out = new Set<string>();
  for (const s of rawSpecialties) {
    if (LEGACY_CATEGORIES.has(s)) {
      out.add(s);
    } else if (CANONICAL_TO_LEGACY[s]) {
      out.add(CANONICAL_TO_LEGACY[s]);
    }
    // Unknown strings are silently dropped — forward-compat safety
  }
  return Array.from(out);
}

/**
 * GET /api/specialties
 * Returns { [osmId]: HospitalCategory[] } for all matched hospitals.
 * Admin-sourced records take priority over CMS-sourced ones when both exist.
 *
 * Canonical designation strings are translated to the legacy HospitalCategory
 * short-form values the mobile app expects ("Trauma", "Cardiac", etc.).
 */
router.get("/specialties", async (_req, res) => {
  try {
    const rows = await db
      .select({
        osmId: hospitalSpecialties.osmId,
        specialties: hospitalSpecialties.specialties,
        source: hospitalSpecialties.source,
      })
      .from(hospitalSpecialties)
      .where(isNotNull(hospitalSpecialties.osmId));

    const map = new Map<string, { specialties: string[]; source: string }>();
    for (const row of rows) {
      if (!row.osmId) continue;
      const normId = normaliseOsmId(row.osmId);
      const existing = map.get(normId);
      const isAdmin = row.source === "admin";
      if (!existing || (isAdmin && existing.source !== "admin")) {
        map.set(normId, {
          specialties: (row.specialties as string[]) ?? [],
          source: row.source,
        });
      }
    }

    const result: Record<string, string[]> = {};
    for (const [osmId, { specialties }] of map) {
      result[osmId] = toMobileCategories(specialties);
    }

    res.json(result);
  } catch (err) {
    console.error("GET /api/specialties error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/specialty-definitions
 * Returns the canonical list of all 16 specialty designations.
 */
router.get("/specialty-definitions", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(specialtyDefinitions)
      .orderBy(specialtyDefinitions.category, specialtyDefinitions.key);
    res.json(rows);
  } catch (err) {
    console.error("GET /api/specialty-definitions error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/admin/specialty-gaps
 * Returns all hospitals that have one or more designations flagged as
 * needs_admin_review, grouped by designation.
 *
 * Response shape:
 * {
 *   byDesignation: {
 *     [designation: string]: Array<{ id, osmId, cmsId, hospitalName, state, specialties, needsAdminReview }>
 *   },
 *   totalHospitals: number,
 *   totalGaps: number
 * }
 */
router.get("/admin/specialty-gaps", requireAdmin, async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: hospitalSpecialties.id,
        osmId: hospitalSpecialties.osmId,
        cmsId: hospitalSpecialties.cmsId,
        hospitalName: hospitalSpecialties.hospitalName,
        state: hospitalSpecialties.state,
        specialties: hospitalSpecialties.specialties,
        needsAdminReview: hospitalSpecialties.needsAdminReview,
        source: hospitalSpecialties.source,
      })
      .from(hospitalSpecialties)
      .where(
        sql`jsonb_array_length(${hospitalSpecialties.needsAdminReview}) > 0`
      );

    const byDesignation: Record<
      string,
      Array<{
        id: number;
        osmId: string | null;
        cmsId: string;
        hospitalName: string;
        state: string;
        specialties: string[];
        needsAdminReview: string[];
      }>
    > = {};

    const hospitalsSeen = new Set<number>();

    for (const row of rows) {
      const reviewList = (row.needsAdminReview as string[]) ?? [];
      hospitalsSeen.add(row.id);
      for (const designation of reviewList) {
        if (!byDesignation[designation]) byDesignation[designation] = [];
        byDesignation[designation].push({
          id: row.id,
          osmId: row.osmId,
          cmsId: row.cmsId,
          hospitalName: row.hospitalName,
          state: row.state,
          specialties: (row.specialties as string[]) ?? [],
          needsAdminReview: reviewList,
        });
      }
    }

    const totalGaps = Object.values(byDesignation).reduce(
      (sum, arr) => sum + arr.length,
      0
    );

    res.json({
      byDesignation,
      totalHospitals: hospitalsSeen.size,
      totalGaps,
    });
  } catch (err) {
    console.error("GET /api/admin/specialty-gaps error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /api/admin/specialty-gaps/:id/resolve
 * Marks a specific designation gap as resolved for a hospital record.
 * Body: { designation: string, present: boolean }
 *   - present: true  → add designation to specialties, remove from needsAdminReview
 *   - present: false → remove from needsAdminReview (confirmed absent)
 */
router.patch("/admin/specialty-gaps/:id/resolve", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { designation, present } = req.body ?? {};
  if (typeof designation !== "string" || !designation.trim()) {
    res.status(400).json({ error: "designation must be a non-empty string" });
    return;
  }
  if (!VALID_SPECIALTY_KEYS.has(designation)) {
    res.status(400).json({
      error: `designation "${designation}" is not a recognized specialty key`,
      validKeys: Array.from(VALID_SPECIALTY_KEYS),
    });
    return;
  }
  if (typeof present !== "boolean") {
    res.status(400).json({ error: "present must be a boolean" });
    return;
  }

  try {
    const [record] = await db
      .select({
        id: hospitalSpecialties.id,
        specialties: hospitalSpecialties.specialties,
        needsAdminReview: hospitalSpecialties.needsAdminReview,
      })
      .from(hospitalSpecialties)
      .where(eq(hospitalSpecialties.id, id));

    if (!record) {
      res.status(404).json({ error: "Hospital specialty record not found" });
      return;
    }

    const currentSpecialties = (record.specialties as string[]) ?? [];
    const currentReview = (record.needsAdminReview as string[]) ?? [];

    const newReview = currentReview.filter((d) => d !== designation);
    let newSpecialties = currentSpecialties;

    if (present && !currentSpecialties.includes(designation)) {
      newSpecialties = [...currentSpecialties, designation];
    } else if (!present && currentSpecialties.includes(designation)) {
      newSpecialties = currentSpecialties.filter((s) => s !== designation);
    }

    await db
      .update(hospitalSpecialties)
      .set({
        specialties: newSpecialties,
        needsAdminReview: newReview,
        source: "admin",
        verified: true,
        updatedAt: new Date(),
      })
      .where(eq(hospitalSpecialties.id, id));

    res.json({
      success: true,
      id,
      designation,
      present,
      specialties: newSpecialties,
      needsAdminReview: newReview,
    });
  } catch (err) {
    console.error("PATCH /api/admin/specialty-gaps/:id/resolve error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PUT /api/admin/specialty-gaps/:id/resolve-all
 * Full specialty edit for a hospital record from the gap view.
 * Sets the complete list of confirmed specialties and clears needsAdminReview
 * for any designation not in the provided list (marks them confirmed absent).
 *
 * Body: { specialties: string[] } — complete list of confirmed-present designations.
 */
router.put("/admin/specialty-gaps/:id/resolve-all", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { specialties } = req.body ?? {};
  if (!Array.isArray(specialties) || !specialties.every((s: unknown) => typeof s === "string")) {
    res.status(400).json({ error: "specialties must be an array of strings" });
    return;
  }

  const filtered = (specialties as string[]).filter((s) => isValidSpecialty(s));

  try {
    await db
      .update(hospitalSpecialties)
      .set({
        specialties: filtered,
        needsAdminReview: [],
        source: "admin",
        verified: true,
        updatedAt: new Date(),
      })
      .where(eq(hospitalSpecialties.id, id));

    res.json({ success: true, id, specialties: filtered, needsAdminReview: [] });
  } catch (err) {
    console.error("PUT /api/admin/specialty-gaps/:id/resolve-all error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PUT /api/admin/specialties/:osmId
 * Upserts an admin-sourced specialty record for the given OSM hospital.
 * Validates specialties against the allowed list and stores only known values.
 */
router.put("/admin/specialties/:osmId", requireAdmin, async (req, res) => {
  const { osmId } = req.params;
  if (!osmId || typeof osmId !== "string" || !osmId.startsWith("osm-")) {
    res.status(400).json({ error: "Invalid osmId — must start with 'osm-'" });
    return;
  }

  const { specialties } = req.body ?? {};
  if (!Array.isArray(specialties) || !specialties.every((s: unknown) => typeof s === "string")) {
    res.status(400).json({ error: "specialties must be an array of strings" });
    return;
  }

  const filtered = (specialties as string[]).filter((s) => isValidSpecialty(s));

  const adminCmsId = `admin-${osmId}`;

  try {
    await db
      .insert(hospitalSpecialties)
      .values({
        cmsId: adminCmsId,
        osmId,
        hospitalName: osmId,
        state: "XX",
        specialties: filtered,
        needsAdminReview: [],
        emergencyServices: true,
        source: "admin",
        verified: true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: hospitalSpecialties.cmsId,
        set: {
          osmId,
          specialties: filtered,
          needsAdminReview: [],
          source: "admin",
          verified: true,
          updatedAt: new Date(),
        },
      });

    res.json({ success: true, osmId, specialties: filtered });
  } catch (err) {
    console.error("PUT /api/admin/specialties error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const IMPORT_PID_FILE = "/tmp/er-choices-import.pid";
const IMPORT_LOG_FILE = "/tmp/er-choices-import.log";
const IMPORT_STARTED_FILE = "/tmp/er-choices-import-started.txt";

/**
 * Walk up from cwd until we find pnpm-workspace.yaml — works on both Replit
 * (cwd = artifacts/api-server) and Railway Docker (cwd = /app).
 */
function findWorkspaceRoot(): string {
  let dir = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd(); // fallback
    dir = parent;
  }
}

/**
 * Check if the import process is currently running by inspecting the PID file.
 */
function isImportRunning(): boolean {
  try {
    const pid = parseInt(fs.readFileSync(IMPORT_PID_FILE, "utf8").trim(), 10);
    if (!pid || isNaN(pid)) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the last N lines from the import log file.
 */
function readImportLog(lines = 60): string {
  try {
    const content = fs.readFileSync(IMPORT_LOG_FILE, "utf8");
    const all = content.split("\n");
    return all.slice(-lines).join("\n");
  } catch {
    return "";
  }
}

/**
 * GET /api/admin/seed/status
 * Returns current seed job status and recent log lines.
 * Status is derived from the PID file (survives server restarts).
 */
router.get("/admin/seed/status", requireAdmin, async (_req, res) => {
  try {
    const [row] = await db.select({ n: count() }).from(hospitalSpecialties);
    const hospitalCount = Number(row?.n ?? 0);

    let status: "idle" | "running" | "done";
    let startedAt: string | null = null;

    if (isImportRunning()) {
      status = "running";
    } else if (hospitalCount > 0) {
      status = "done";
    } else {
      status = "idle";
    }

    try {
      startedAt = fs.readFileSync(IMPORT_STARTED_FILE, "utf8").trim();
    } catch { /* no file yet */ }

    res.json({
      status,
      startedAt,
      hospitalCount,
      recentLog: readImportLog(60),
    });
  } catch (err) {
    res.json({ status: "idle", startedAt: null, hospitalCount: 0, recentLog: "" });
  }
});

/**
 * POST /api/admin/seed
 * Triggers the CMS hospital import as a fully detached background process.
 * Survives API server restarts — the import continues even if the server is killed.
 * Safe to call multiple times — import script uses upserts.
 */
router.post("/admin/seed", requireAdmin, async (_req, res) => {
  if (isImportRunning()) {
    return res.json({ status: "running", message: "Import already in progress." });
  }

  // Truncate log file and write start timestamp
  try { fs.writeFileSync(IMPORT_LOG_FILE, `[seed] Starting CMS hospital import…\n`); } catch { /* ignore */ }
  try { fs.writeFileSync(IMPORT_STARTED_FILE, new Date().toISOString()); } catch { /* ignore */ }

  // Open log file for writing by child process
  const logFd = fs.openSync(IMPORT_LOG_FILE, "a");

  const root = findWorkspaceRoot();
  const tsxBin = path.join(root, "node_modules/.bin/tsx");
  const scriptFile = path.join(root, "artifacts/api-server/scripts/import-cms-hospitals.ts");

  const proc = spawn(
    tsxBin,
    [scriptFile],
    {
      cwd: root,
      stdio: ["ignore", logFd, logFd],
      detached: true,
      env: { ...process.env },
    }
  );

  fs.closeSync(logFd);

  // Write PID so we can detect if it's still running after restarts
  try { fs.writeFileSync(IMPORT_PID_FILE, String(proc.pid)); } catch { /* ignore */ }

  // Clean up PID file when process exits (only fires if this server instance survives)
  proc.on("close", () => {
    try { fs.unlinkSync(IMPORT_PID_FILE); } catch { /* ignore */ }
  });

  // Prevent unhandled error from crashing the server (e.g. binary not found)
  proc.on("error", (err) => {
    try { fs.appendFileSync(IMPORT_LOG_FILE, `[seed] Spawn error: ${err.message}\n`); } catch { /* ignore */ }
    try { fs.unlinkSync(IMPORT_PID_FILE); } catch { /* ignore */ }
  });

  // Unref so the API server can exit freely without waiting for the import
  proc.unref();

  res.json({ status: "started", message: "CMS import started in background. This takes 10–20 minutes. Refresh status to monitor progress." });
});

export default router;
