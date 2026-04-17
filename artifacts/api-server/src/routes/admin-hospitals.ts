import { Router } from "express";
import { db, hospitalOverrides, hospitalSpecialties } from "@workspace/db";
import { eq, ilike, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { runImport } from "../../scripts/import-cms-hospitals.js";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";

/** All fields that can be edited via the admin PATCH endpoint. */
type HospitalUpdateFields = {
  hospitalName?: string;
  address?: string | null;
  city?: string | null;
  state?: string;
  zip?: string | null;
  phone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  specialties?: string[];
  actualDesignation?: string | null;
  serviceLine?: string | null;
  strokeDesignation?: string | null;
  burnDesignation?: string | null;
  pciCapability?: string | null;
  helipad?: boolean | null;
  beds?: number | null;
  updatedAt?: Date;
};

/**
 * Build a typed patch object from an incoming request body.
 * Only fields explicitly present in the body are included so callers
 * can perform partial updates without accidentally overwriting unrelated data.
 */
function buildHospitalPatch(body: Record<string, unknown>): HospitalUpdateFields {
  const patch: HospitalUpdateFields = { updatedAt: new Date() };

  const str = (v: unknown): string | null =>
    v === null || v === undefined || v === "" ? null : String(v);
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  };
  const bool = (v: unknown): boolean | null => {
    if (v === null || v === undefined) return null;
    if (v === true || v === "true" || v === 1 || v === "1") return true;
    if (v === false || v === "false" || v === 0 || v === "0") return false;
    return null; // coercing unknown string values to boolean is error-prone; treat as no-op
  };

  if ("hospitalName" in body && body.hospitalName) patch.hospitalName = String(body.hospitalName);
  if ("address" in body) patch.address = str(body.address);
  if ("city" in body) patch.city = str(body.city);
  if ("state" in body && body.state) patch.state = String(body.state);
  if ("zip" in body) patch.zip = str(body.zip);
  if ("phone" in body) patch.phone = str(body.phone);
  if ("latitude" in body) patch.latitude = num(body.latitude);
  if ("longitude" in body) patch.longitude = num(body.longitude);
  if ("actualDesignation" in body) patch.actualDesignation = str(body.actualDesignation);
  if ("serviceLine" in body) patch.serviceLine = str(body.serviceLine);
  if ("strokeDesignation" in body) patch.strokeDesignation = str(body.strokeDesignation);
  if ("burnDesignation" in body) patch.burnDesignation = str(body.burnDesignation);
  if ("pciCapability" in body) patch.pciCapability = str(body.pciCapability);
  if ("helipad" in body) patch.helipad = body.helipad === null ? null : bool(body.helipad);
  if ("beds" in body) patch.beds = body.beds === null || body.beds === "" ? null : num(body.beds);
  if ("specialties" in body) {
    const raw = body.specialties;
    patch.specialties = Array.isArray(raw)
      ? (raw as unknown[]).map(String).filter(Boolean)
      : typeof raw === "string"
        ? raw.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
  }

  return patch;
}

const execFileAsync = promisify(execFile);

// pnpm scripts run from the package directory, so process.cwd() =
// /home/runner/workspace/artifacts/api-server (the api-server package root).
const API_SERVER_DIR = process.cwd();
const ENRICHMENT_CSV_PATH = path.join(API_SERVER_DIR, "specialty-enrichment-review.csv");
const ENRICH_SCRIPT = path.join(API_SERVER_DIR, "scripts", "run-enrich-specialties.ts");

/** Resolve tsx binary from api-server or root node_modules */
function findTsx(): string {
  const candidates = [
    path.join(API_SERVER_DIR, "node_modules", ".bin", "tsx"),
    path.join(API_SERVER_DIR, "..", "..", "node_modules", ".bin", "tsx"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "tsx"; // Fall back to PATH
}

const router = Router();

/**
 * Normalise a DB-stored osmId to the app's format.
 * DB (CMS import): "node/6779584037"  →  App: "osm-node-6779584037"
 * Admin-set ids already use the app format ("osm-node-…") and pass through unchanged.
 */
function normaliseOsmId(dbId: string): string {
  if (dbId.startsWith("osm-")) return dbId;
  return "osm-" + dbId.replace("/", "-");
}

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
 * GET /api/hospital-overrides
 * Public endpoint — returns all admin-set overrides as { [osmId]: { phone, latitude, longitude } }.
 * The mobile app fetches this to override OSM source data.
 */
router.get("/hospital-overrides", async (_req, res) => {
  try {
    const rows = await db.select().from(hospitalOverrides);
    const result: Record<string, { phone: string | null; latitude: number | null; longitude: number | null }> = {};
    for (const row of rows) {
      result[row.osmId] = {
        phone: row.phone ?? null,
        latitude: row.latitude ?? null,
        longitude: row.longitude ?? null,
      };
    }
    res.json(result);
  } catch (err) {
    console.error("GET /api/hospital-overrides error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/admin/hospitals/search?q=<name>
 * Searches hospitals by name. Returns all editable fields for the admin UI.
 * Phone, latitude, and longitude reflect *effective* values — legacy override data
 * (hospital_overrides) takes precedence, matching the nearby-hospitals read path.
 * osmIds are normalized to app format (osm-*) before looking up overrides to ensure
 * correct matching regardless of how the raw id is stored in hospital_specialties.
 */
router.get("/admin/hospitals/search", requireAdmin, async (req, res) => {
  const q = ((req.query.q as string) ?? "").trim();
  if (!q || q.length < 2) {
    res.status(400).json({ error: "Query must be at least 2 characters" });
    return;
  }

  try {
    // Step 1: fetch hospitals from hospital_specialties
    const rows = await db
      .select({
        id: hospitalSpecialties.id,
        cmsId: hospitalSpecialties.cmsId,
        osmId: hospitalSpecialties.osmId,
        hospitalName: hospitalSpecialties.hospitalName,
        address: hospitalSpecialties.address,
        city: hospitalSpecialties.city,
        state: hospitalSpecialties.state,
        zip: hospitalSpecialties.zip,
        phone: hospitalSpecialties.phone,
        latitude: hospitalSpecialties.latitude,
        longitude: hospitalSpecialties.longitude,
        specialties: hospitalSpecialties.specialties,
        actualDesignation: hospitalSpecialties.actualDesignation,
        serviceLine: hospitalSpecialties.serviceLine,
        strokeDesignation: hospitalSpecialties.strokeDesignation,
        burnDesignation: hospitalSpecialties.burnDesignation,
        pciCapability: hospitalSpecialties.pciCapability,
        helipad: hospitalSpecialties.helipad,
        beds: hospitalSpecialties.beds,
        source: hospitalSpecialties.source,
      })
      .from(hospitalSpecialties)
      .where(ilike(hospitalSpecialties.hospitalName, `%${q}%`))
      .limit(50);

    // Step 2: normalize osmIds and deduplicate, then look up any legacy overrides
    const seenKeys = new Set<string>();
    const unique = rows
      .map((r) => ({ ...r, osmId: r.osmId ? normaliseOsmId(r.osmId) : null }))
      .filter((r) => {
        const key = r.osmId ?? r.cmsId;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      })
      .slice(0, 20);

    // Fetch overrides for all osmIds in the result set.
    // hospital_overrides always stores ids in app format (osm-*), which matches
    // the normalized osmIds already computed above.
    const osmIds = unique.map((r) => r.osmId).filter((id): id is string => !!id);
    const overrideRows = osmIds.length > 0
      ? await db
          .select({
            osmId: hospitalOverrides.osmId,
            phone: hospitalOverrides.phone,
            latitude: hospitalOverrides.latitude,
            longitude: hospitalOverrides.longitude,
          })
          .from(hospitalOverrides)
          .where(inArray(hospitalOverrides.osmId, osmIds))
      : [];
    const overrideMap = new Map(overrideRows.map((o) => [o.osmId, o]));

    const result = unique.map((r) => {
      const ov = r.osmId ? overrideMap.get(r.osmId) : undefined;
      return {
        id: r.id,
        cmsId: r.cmsId,
        osmId: r.osmId ?? null,
        name: r.hospitalName,
        address: r.address ?? null,
        city: r.city ?? null,
        state: r.state,
        zip: r.zip ?? null,
        // Effective values: override wins over base (matches nearby-hospitals API)
        phone: ov?.phone ?? r.phone ?? null,
        latitude: ov?.latitude ?? r.latitude ?? null,
        longitude: ov?.longitude ?? r.longitude ?? null,
        specialties: (r.specialties as string[]) ?? [],
        actualDesignation: r.actualDesignation ?? null,
        serviceLine: r.serviceLine ?? null,
        strokeDesignation: r.strokeDesignation ?? null,
        burnDesignation: r.burnDesignation ?? null,
        pciCapability: r.pciCapability ?? null,
        helipad: r.helipad ?? null,
        beds: r.beds ?? null,
        source: r.source,
      };
    });

    res.json(result);
  } catch (err) {
    console.error("GET /api/admin/hospitals/search error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /api/admin/hospitals/:id
 * Universal full-field editor by numeric primary key.
 * Writes any subset of editable fields directly to hospital_specialties.
 * Works for all hospitals regardless of OSM match status.
 *
 * Legacy osmId callers (osm-*) receive HTTP 410 Gone with an upgrade hint.
 */
router.patch("/admin/hospitals/:id", requireAdmin, async (req, res) => {
  const raw = decodeURIComponent(req.params.id ?? "");

  if (raw.startsWith("osm-")) {
    res.status(410).json({
      error: "Editing via osmId is no longer supported.",
      hint: "Use GET /api/admin/hospitals/search to find the hospital's numeric id, then PATCH /api/admin/hospitals/:numericId.",
    });
    return;
  }

  const id = parseInt(raw, 10);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ error: "id must be a positive integer" });
    return;
  }

  const patch = buildHospitalPatch(req.body ?? {});

  if (Object.keys(patch).length <= 1) {
    res.status(400).json({ error: "No editable fields provided" });
    return;
  }

  try {
    const existing = await db
      .select({ id: hospitalSpecialties.id })
      .from(hospitalSpecialties)
      .where(eq(hospitalSpecialties.id, id))
      .limit(1);

    if (existing.length === 0) {
      res.status(404).json({ error: "Hospital not found" });
      return;
    }

    await db.update(hospitalSpecialties).set(patch).where(eq(hospitalSpecialties.id, id));

    const [saved] = await db
      .select()
      .from(hospitalSpecialties)
      .where(eq(hospitalSpecialties.id, id))
      .limit(1);

    // Clear any legacy override fields that were just edited so hospital_specialties values win.
    // hospital_overrides is kept read-only for backward compat but must not shadow new edits.
    // hospital_overrides.osmId is always in app format (osm-*). Normalize the DB osmId before
    // matching to handle any hospital_specialties rows stored in raw format (node/...).
    if (saved.osmId && (patch.phone !== undefined || patch.latitude !== undefined || patch.longitude !== undefined)) {
      const normOsmId = normaliseOsmId(saved.osmId);
      const overrideClear: { phone?: null; latitude?: null; longitude?: null } = {};
      if (patch.phone !== undefined) overrideClear.phone = null;
      if (patch.latitude !== undefined) overrideClear.latitude = null;
      if (patch.longitude !== undefined) overrideClear.longitude = null;
      await db
        .update(hospitalOverrides)
        .set(overrideClear)
        .where(eq(hospitalOverrides.osmId, normOsmId));
    }

    res.json({ success: true, hospital: saved });
  } catch (err) {
    console.error("PATCH /api/admin/hospitals/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /api/admin/hospitals/cms/:cmsId
 * Full-field editor by CMS ID. Writes any editable field directly to hospital_specialties.
 * Useful for hospitals with no OSM match where only a cmsId is known.
 */
router.patch("/admin/hospitals/cms/:cmsId", requireAdmin, async (req, res) => {
  const cmsId = decodeURIComponent(req.params.cmsId);
  if (!cmsId) {
    res.status(400).json({ error: "Invalid cmsId" });
    return;
  }

  const patch = buildHospitalPatch(req.body ?? {});

  if (Object.keys(patch).length <= 1) {
    res.status(400).json({ error: "No editable fields provided" });
    return;
  }

  try {
    const existing = await db
      .select({ id: hospitalSpecialties.id })
      .from(hospitalSpecialties)
      .where(eq(hospitalSpecialties.cmsId, cmsId))
      .limit(1);

    if (existing.length === 0) {
      res.status(404).json({ error: "Hospital not found" });
      return;
    }

    await db.update(hospitalSpecialties).set(patch).where(eq(hospitalSpecialties.cmsId, cmsId));

    const [saved] = await db
      .select()
      .from(hospitalSpecialties)
      .where(eq(hospitalSpecialties.cmsId, cmsId))
      .limit(1);

    // Mirror the same override-clearing behavior as the numeric-id PATCH endpoint.
    // Normalize osmId to app format (osm-*) before matching against hospital_overrides.
    if (saved.osmId && (patch.phone !== undefined || patch.latitude !== undefined || patch.longitude !== undefined)) {
      const normOsmId = normaliseOsmId(saved.osmId);
      const overrideClear: { phone?: null; latitude?: null; longitude?: null } = {};
      if (patch.phone !== undefined) overrideClear.phone = null;
      if (patch.latitude !== undefined) overrideClear.latitude = null;
      if (patch.longitude !== undefined) overrideClear.longitude = null;
      await db
        .update(hospitalOverrides)
        .set(overrideClear)
        .where(eq(hospitalOverrides.osmId, normOsmId));
    }

    res.json({ success: true, hospital: saved });
  } catch (err) {
    console.error("PATCH /api/admin/hospitals/cms error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


/**
 * POST /api/admin/hospitals
 * Creates a new hospital record in hospital_specialties.
 * Required: hospitalName, state.
 * Optional: all other fields.
 */
router.post("/admin/hospitals", requireAdmin, async (req, res) => {
  const body = req.body ?? {};

  // Accept both `hospitalName` (canonical) and `name` (UI alias)
  // String() guards against non-string primitives (e.g. a number passed in JSON)
  const name = String(body.hospitalName ?? body.name ?? "").trim();
  const state = String(body.state ?? "").trim();

  if (!name) {
    res.status(400).json({ error: "hospitalName is required" });
    return;
  }
  if (!state) {
    res.status(400).json({ error: "state is required" });
    return;
  }

  const str = (v: unknown): string | null =>
    v === null || v === undefined || v === "" ? null : String(v);
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  };
  const bool = (v: unknown): boolean | null => {
    if (v === null || v === undefined) return null;
    if (v === true || v === "true" || v === 1 || v === "1") return true;
    if (v === false || v === "false" || v === 0 || v === "0") return false;
    return null;
  };

  const specialtiesRaw = body.specialties;
  const specialties = Array.isArray(specialtiesRaw)
    ? specialtiesRaw.map(String).filter(Boolean)
    : typeof specialtiesRaw === "string"
      ? specialtiesRaw.split(",").map((s: string) => s.trim()).filter(Boolean)
      : [];

  // Retry up to 5 times on unique constraint conflict (extremely unlikely with UUID-based IDs)
  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Use a full UUID suffix to make collisions cryptographically infeasible
    const cmsId = `ADMIN-${randomUUID()}`;
    try {
      const [created] = await db
        .insert(hospitalSpecialties)
        .values({
          cmsId,
          hospitalName: name,
          state,
          address: str(body.address) ?? undefined,
          city: str(body.city) ?? undefined,
          zip: str(body.zip) ?? undefined,
          phone: str(body.phone) ?? undefined,
          latitude: num(body.latitude) ?? undefined,
          longitude: num(body.longitude) ?? undefined,
          specialties,
          actualDesignation: str(body.actualDesignation) ?? undefined,
          serviceLine: str(body.serviceLine) ?? undefined,
          strokeDesignation: str(body.strokeDesignation) ?? undefined,
          burnDesignation: str(body.burnDesignation) ?? undefined,
          pciCapability: str(body.pciCapability) ?? undefined,
          helipad: bool(body.helipad) ?? undefined,
          beds: num(body.beds) ?? undefined,
          source: "admin",
          emergencyServices: true,
          verified: true,
        })
        .returning();

      return res.status(201).json({ success: true, hospital: created });
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr?.code === "23505" && attempt < MAX_ATTEMPTS - 1) {
        // Unique constraint violation on cmsId — retry with a fresh UUID
        continue;
      }
      console.error("POST /api/admin/hospitals error:", err);
      res.status(500).json({ error: "Internal server error" });
      return;
    }
  }
});

// ─── CSV Export ───────────────────────────────────────────────────────────────

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

router.get("/admin/export-csv", requireAdmin, async (_req, res) => {
  try {
    const rows = await db.select().from(hospitalSpecialties).orderBy(hospitalSpecialties.cmsId);

    const headers = [
      "CMS ID", "Hospital Name", "Address", "City", "State", "ZIP",
      "Phone", "Latitude", "Longitude", "Emergency Services",
      "Confirmed Specialties", "Needs Admin Review",
      // Enriched fields — must match importer IDX names exactly
      "Actual Designation", "Service Line", "Advanced Capabilities",
      "EMS Tags", "Helipad", "Beds",
      "HIFLD Owner", "HIFLD Website",
      "Stroke Designation", "Burn Designation",
      "PCI Capability", "HIFLD Match Confidence",
    ];

    const csvLines = [headers.join(",")];

    for (const row of rows) {
      const specialties = Array.isArray(row.specialties) ? (row.specialties as string[]).join("|") : "";
      const needsReview = Array.isArray(row.needsAdminReview) ? (row.needsAdminReview as string[]).join("|") : "";

      const cols = [
        row.cmsId,
        row.hospitalName,
        row.address,
        row.city,
        row.state,
        row.zip,
        row.phone,
        row.latitude,
        row.longitude,
        row.emergencyServices === true ? "Yes" : row.emergencyServices === false ? "No" : "",
        specialties,
        needsReview,
        row.actualDesignation,
        row.serviceLine,
        row.advancedCapabilities,
        row.emsTags,
        row.helipad === true ? "true" : row.helipad === false ? "false" : "",
        row.beds,
        row.hifldOwner,
        row.hifldWebsite,
        row.strokeDesignation,
        row.burnDesignation,
        row.pciCapability,
        row.hifldMatchConfidence,
      ];

      csvLines.push(cols.map(escapeCsv).join(","));
    }

    const csv = csvLines.join("\r\n");
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="hospitals-export-${date}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error("GET /api/admin/export-csv error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── CSV Upload Import ────────────────────────────────────────────────────────

/** Parse a CSV line respecting double-quoted fields. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { fields.push(cur); cur = ""; }
      else { cur += ch; }
    }
  }
  fields.push(cur);
  return fields;
}

router.post("/admin/import-csv", requireAdmin, async (req, res) => {
  const body: string = req.body as string;
  if (typeof body !== "string" || !body.trim()) {
    res.status(400).json({ error: "No CSV data provided" });
    return;
  }

  const lines = body.trim().split(/\r?\n/);
  if (lines.length < 2) { res.status(400).json({ error: "CSV has no data rows" }); return; }

  const rawHeaders = parseCsvLine(lines[0]);
  const col = (name: string) => rawHeaders.findIndex(h => h.trim().toLowerCase() === name.toLowerCase());

  const IDX = {
    cmsId:               col("CMS ID"),
    hospitalName:        col("Hospital Name"),
    address:             col("Address"),
    city:                col("City"),
    state:               col("State"),
    zip:                 col("ZIP"),
    phone:               col("Phone"),
    lat:                 col("Latitude"),
    lon:                 col("Longitude"),
    emergency:           col("Emergency Services"),
    specialties:         col("Confirmed Specialties"),
    needsReview:         col("Needs Admin Review"),
    // Enriched / HIFLD fields
    actualDesignation:   col("Actual Designation"),
    serviceLine:         col("Service Line"),
    advancedCapabilities:col("Advanced Capabilities"),
    emsTags:             col("EMS Tags"),
    helipad:             col("Helipad"),
    beds:                col("Beds"),
    hifldOwner:          col("HIFLD Owner"),
    hifldWebsite:        col("HIFLD Website"),
    strokeDesignation:   col("Stroke Designation"),
    burnDesignation:     col("Burn Designation"),
    pciCapability:       col("PCI Capability"),
    hifldMatchConfidence:col("HIFLD Match Confidence"),
  };

  if (IDX.cmsId < 0) { res.status(400).json({ error: "Missing required column: CMS ID" }); return; }

  let updated = 0, skipped = 0, notFound = 0;
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseCsvLine(line);
    const cmsId = fields[IDX.cmsId]?.trim();
    if (!cmsId) { skipped++; continue; }

    // Fetch existing record
    const [existing] = await db
      .select()
      .from(hospitalSpecialties)
      .where(eq(hospitalSpecialties.cmsId, cmsId));

    if (!existing) { notFound++; continue; }

    try {
      const patch: Record<string, unknown> = {};

      const str = (idx: number) => (idx >= 0 ? (fields[idx] ?? "").trim() : "");

      if (IDX.address >= 0 && str(IDX.address))      patch.address = str(IDX.address);
      if (IDX.city    >= 0 && str(IDX.city))          patch.city    = str(IDX.city);
      if (IDX.state   >= 0 && str(IDX.state))         patch.state   = str(IDX.state);
      if (IDX.zip     >= 0 && str(IDX.zip))           patch.zip     = str(IDX.zip);
      if (IDX.phone   >= 0 && str(IDX.phone))         patch.phone   = str(IDX.phone);

      if (IDX.lat >= 0 && str(IDX.lat)) {
        const v = parseFloat(str(IDX.lat));
        if (!isNaN(v)) patch.latitude = v;
      }
      if (IDX.lon >= 0 && str(IDX.lon)) {
        const v = parseFloat(str(IDX.lon));
        if (!isNaN(v)) patch.longitude = v;
      }
      if (IDX.emergency >= 0 && str(IDX.emergency)) {
        patch.emergencyServices = str(IDX.emergency).toLowerCase() === "yes";
      }

      // Merge specialties — add admin-confirmed ones, preserve existing
      if (IDX.specialties >= 0 && str(IDX.specialties)) {
        const incoming = str(IDX.specialties)
          .split("|")
          .map((s: string) => s.trim())
          .filter(Boolean);

        const existing_specialties: string[] = Array.isArray(existing.specialties)
          ? (existing.specialties as string[])
          : [];
        const existing_sources: Record<string, string> =
          (existing.designationSources as Record<string, string>) ?? {};

        const merged = [...existing_specialties];
        const mergedSources = { ...existing_sources };
        for (const sp of incoming) {
          if (!merged.includes(sp)) merged.push(sp);
          if (!mergedSources[sp]) mergedSources[sp] = "admin";
        }
        patch.specialties = merged;
        patch.designationSources = mergedSources;
      }

      // Overwrite needs-admin-review list if provided
      if (IDX.needsReview >= 0 && str(IDX.needsReview) !== undefined) {
        const val = str(IDX.needsReview);
        patch.needsAdminReview = val
          ? val.split("|").map((s: string) => s.trim()).filter(Boolean)
          : [];
      }

      // ── Enriched / HIFLD fields ──────────────────────────────────────────
      // Write the value whether it's empty or not (empty string clears the field)
      if (IDX.actualDesignation   >= 0) patch.actualDesignation    = str(IDX.actualDesignation)    || null;
      if (IDX.serviceLine         >= 0) patch.serviceLine          = str(IDX.serviceLine)          || null;
      if (IDX.advancedCapabilities>= 0) patch.advancedCapabilities = str(IDX.advancedCapabilities) || null;
      if (IDX.emsTags             >= 0) patch.emsTags              = str(IDX.emsTags)              || null;
      if (IDX.hifldOwner          >= 0) patch.hifldOwner           = str(IDX.hifldOwner)           || null;
      if (IDX.hifldWebsite        >= 0) patch.hifldWebsite         = str(IDX.hifldWebsite)         || null;
      if (IDX.strokeDesignation   >= 0) patch.strokeDesignation    = str(IDX.strokeDesignation)    || null;
      if (IDX.burnDesignation     >= 0) patch.burnDesignation      = str(IDX.burnDesignation)      || null;
      if (IDX.pciCapability       >= 0) patch.pciCapability        = str(IDX.pciCapability)        || null;
      if (IDX.hifldMatchConfidence>= 0) patch.hifldMatchConfidence = str(IDX.hifldMatchConfidence) || null;

      if (IDX.helipad >= 0 && str(IDX.helipad)) {
        const v = str(IDX.helipad).toLowerCase();
        patch.helipad = v === "true" || v === "yes" || v === "1";
      }
      if (IDX.beds >= 0 && str(IDX.beds)) {
        const v = parseInt(str(IDX.beds), 10);
        if (!isNaN(v)) patch.beds = v;
      }

      if (Object.keys(patch).length > 0) {
        await db
          .update(hospitalSpecialties)
          .set(patch as any)
          .where(eq(hospitalSpecialties.cmsId, cmsId));
        updated++;
      } else {
        skipped++;
      }
    } catch (err: any) {
      errors.push(`Row ${i} (${cmsId}): ${err?.message ?? err}`);
    }
  }

  res.json({
    message: "CSV import complete",
    updated,
    skipped,
    notFound,
    errors: errors.slice(0, 20),
  });
});

// ─── Sync Specialties from Designation Fields ─────────────────────────────────

/**
 * POST /api/admin/sync-specialties
 * Rebuilds the `specialties` array for every hospital from the enriched
 * designation columns, using them as the source of truth:
 *   - "Trauma"     ← actualDesignation contains "Level I/II/III/IV"
 *   - "Stroke"     ← strokeDesignation is non-empty
 *   - "Burn"       ← burnDesignation is non-empty
 *   - "Cardiac"    ← pciCapability is non-empty
 *   - "Psychiatric"← serviceLine === "Psychiatric" (exact, case-insensitive)
 * All other specialties (Pediatric, Obstetrics, etc.) are left untouched.
 */
router.post("/admin/sync-specialties", requireAdmin, async (_req, res) => {
  const DESIGNATION_DRIVEN = new Set<string>(["Trauma", "Stroke", "Burn", "Cardiac", "Psychiatric"]);
  const traumaRe = /\blevel\s+(?:i{1,3}|iv)\b/i;

  try {
    const rows = await db
      .select({
        cmsId: hospitalSpecialties.cmsId,
        specialties: hospitalSpecialties.specialties,
        actualDesignation: hospitalSpecialties.actualDesignation,
        strokeDesignation: hospitalSpecialties.strokeDesignation,
        burnDesignation: hospitalSpecialties.burnDesignation,
        pciCapability: hospitalSpecialties.pciCapability,
        serviceLine: hospitalSpecialties.serviceLine,
      })
      .from(hospitalSpecialties);

    let updated = 0;
    let unchanged = 0;

    for (const row of rows) {
      const existing: string[] = Array.isArray(row.specialties)
        ? (row.specialties as string[])
        : [];

      // Determine which designation-driven flags should be set
      const shouldHave = new Set<string>();
      if (row.actualDesignation?.trim() && traumaRe.test(row.actualDesignation.trim())) shouldHave.add("Trauma");
      if (row.strokeDesignation?.trim()) shouldHave.add("Stroke");
      if (row.burnDesignation?.trim())   shouldHave.add("Burn");
      if (row.pciCapability?.trim())     shouldHave.add("Cardiac");
      if (row.serviceLine?.trim().toLowerCase() === "psychiatric") shouldHave.add("Psychiatric");

      // Rebuild: keep non-designation specialties, replace designation-driven ones
      const nonDesignation = existing.filter(s => !DESIGNATION_DRIVEN.has(s));
      const rebuilt = [...nonDesignation, ...Array.from(shouldHave)];

      // Only write if changed
      const same =
        rebuilt.length === existing.length &&
        rebuilt.every(s => existing.includes(s));

      if (!same) {
        await db
          .update(hospitalSpecialties)
          .set({ specialties: rebuilt })
          .where(eq(hospitalSpecialties.cmsId, row.cmsId));
        updated++;
      } else {
        unchanged++;
      }
    }

    res.json({
      success: true,
      total: rows.length,
      updated,
      unchanged,
      message: `Synced ${rows.length} hospitals: ${updated} updated, ${unchanged} already correct.`,
    });
  } catch (err) {
    console.error("POST /api/admin/sync-specialties error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Specialty Enrichment Trigger ────────────────────────────────────────────

let enrichState: {
  status: "idle" | "running" | "done" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  strokeMatched: number;
  burnMatched: number;
  pciMatched: number;
  total: number;
  error: string | null;
} = {
  status: "idle", startedAt: null, finishedAt: null,
  strokeMatched: 0, burnMatched: 0, pciMatched: 0, total: 0, error: null,
};

router.get("/admin/enrichment-status", requireAdmin, (_req, res) => {
  res.json(enrichState);
});

router.post("/admin/run-enrichment", requireAdmin, async (_req, res) => {
  if (enrichState.status === "running") {
    res.status(409).json({ error: "Enrichment already running", state: enrichState });
    return;
  }

  enrichState = {
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    strokeMatched: 0, burnMatched: 0, pciMatched: 0, total: 0,
    error: null,
  };

  try {
    const tsxBin = findTsx();
    console.log(`[Admin] Forking enrichment child process: ${tsxBin} ${ENRICH_SCRIPT}`);

    const { stdout } = await execFileAsync(tsxBin, [ENRICH_SCRIPT], {
      cwd: API_SERVER_DIR,
      env: { ...process.env },
      maxBuffer: 20 * 1024 * 1024,
    });

    // Parse ENRICHMENT_RESULT:{...} JSON line emitted by the runner
    const resultLine = stdout.split(/\r?\n/).find((l) => l.startsWith("ENRICHMENT_RESULT:"));
    if (!resultLine) {
      throw new Error("Enrichment script did not emit an ENRICHMENT_RESULT line");
    }
    const result = JSON.parse(resultLine.replace("ENRICHMENT_RESULT:", "")) as {
      strokeWritten: number;
      burnWritten: number;
      pciWritten: number;
      total: number;
    };

    enrichState = {
      status: "done",
      startedAt: enrichState.startedAt,
      finishedAt: new Date().toISOString(),
      strokeMatched: result.strokeWritten,
      burnMatched:   result.burnWritten,
      pciMatched:    result.pciWritten,
      total:         result.total,
      error: null,
    };
    console.log("[Admin] Specialty enrichment completed:", enrichState);

    res.json({
      message: "Enrichment complete",
      strokeMatched: result.strokeWritten,
      burnMatched:   result.burnWritten,
      pciMatched:    result.pciWritten,
      total:         result.total,
      csvAvailable: fs.existsSync(ENRICHMENT_CSV_PATH),
    });
  } catch (err: unknown) {
    const msg = String((err as Error)?.message ?? err);
    enrichState = {
      ...enrichState,
      status: "error",
      finishedAt: new Date().toISOString(),
      error: msg,
    };
    console.error("[Admin] Specialty enrichment failed:", err);
    res.status(500).json({ error: msg });
  }
});

router.get("/admin/enrichment-csv", requireAdmin, (_req, res) => {
  if (!fs.existsSync(ENRICHMENT_CSV_PATH)) {
    res.status(404).json({
      error: "No enrichment CSV available. Run specialty enrichment first.",
    });
    return;
  }
  const csv = fs.readFileSync(ENRICHMENT_CSV_PATH, "utf8");
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="specialty-enrichment-review-${date}.csv"`,
  );
  res.send(csv);
});

// ─── Coordinate Update Trigger ───────────────────────────────────────────────

const COORD_UPDATE_SCRIPT = path.join(API_SERVER_DIR, "scripts", "update-coords-from-osm.ts");
const GEOCODE_SCRIPT = path.join(API_SERVER_DIR, "scripts", "geocode-addresses.ts");
const GEOCODE_PASS2_SCRIPT = path.join(API_SERVER_DIR, "scripts", "geocode-addresses-pass2.ts");
const GEOCODE_CENSUS_SCRIPT = path.join(API_SERVER_DIR, "scripts", "geocode-census-batch.ts");

let coordUpdateState: {
  status: "idle" | "running" | "done" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  updated: number;
  skipped: number;
  failed: number;
  total: number;
  error: string | null;
} = {
  status: "idle", startedAt: null, finishedAt: null,
  updated: 0, skipped: 0, failed: 0, total: 0, error: null,
};

router.get("/admin/coord-update-status", requireAdmin, (_req, res) => {
  res.json(coordUpdateState);
});

/**
 * POST /api/admin/run-coord-update
 *
 * Triggers the OSM coordinate back-fill for all hospitals that have an osm_id.
 * Returns 202 immediately; poll /api/admin/coord-update-status for progress.
 */
router.post("/admin/run-coord-update", requireAdmin, async (_req, res) => {
  if (coordUpdateState.status === "running") {
    res.status(409).json({ error: "Coordinate update already running", state: coordUpdateState });
    return;
  }

  coordUpdateState = {
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    updated: 0, skipped: 0, failed: 0, total: 0,
    error: null,
  };
  res.status(202).json({ message: "Coordinate update started", state: coordUpdateState });

  const tsxBin = findTsx();
  console.log(`[Admin] Forking coord-update child process: ${tsxBin} ${COORD_UPDATE_SCRIPT}`);

  execFileAsync(tsxBin, [COORD_UPDATE_SCRIPT], {
    cwd: API_SERVER_DIR,
    env: { ...process.env },
    maxBuffer: 20 * 1024 * 1024,
    timeout: 30 * 60 * 1000,
  })
    .then(({ stdout }) => {
      const resultLine = stdout.split(/\r?\n/).find((l) => l.startsWith("COORD_UPDATE_RESULT:"));
      if (!resultLine) {
        throw new Error("Script did not emit a COORD_UPDATE_RESULT line");
      }
      const result = JSON.parse(resultLine.replace("COORD_UPDATE_RESULT:", "")) as {
        updated: number; skipped: number; failed: number; unparseable: number; total: number;
      };
      coordUpdateState = {
        status: "done",
        startedAt: coordUpdateState.startedAt,
        finishedAt: new Date().toISOString(),
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed + result.unparseable,
        total: result.total,
        error: null,
      };
      console.log("[Admin] Coord update completed:", coordUpdateState);
    })
    .catch((err: unknown) => {
      const msg = String((err as Error)?.message ?? err);
      coordUpdateState = {
        ...coordUpdateState,
        status: "error",
        finishedAt: new Date().toISOString(),
        error: msg,
      };
      console.error("[Admin] Coord update failed:", err);
    });
});

// ─── Address Geocode Trigger ──────────────────────────────────────────────────

let geocodeState: {
  status: "idle" | "running" | "done" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  updated: number;
  skipped: number;
  noResult: number;
  failed: number;
  total: number;
  error: string | null;
} = {
  status: "idle", startedAt: null, finishedAt: null,
  updated: 0, skipped: 0, noResult: 0, failed: 0, total: 0, error: null,
};

router.get("/admin/geocode-status", requireAdmin, (_req, res) => {
  res.json(geocodeState);
});

/**
 * POST /api/admin/run-geocode
 *
 * Triggers the Nominatim address geocoding pass for all hospitals that have
 * no OSM element link but do have a stored street address (ZIP centroid coords).
 * Returns 202 immediately; poll /api/admin/geocode-status for progress.
 *
 * NOTE: This runs at 1 request/second (Nominatim rate limit). For ~3,276
 * hospitals expect ~55 minutes. The timeout is set to 120 minutes.
 */
router.post("/admin/run-geocode", requireAdmin, async (_req, res) => {
  if (geocodeState.status === "running") {
    res.status(409).json({ error: "Geocoding already running", state: geocodeState });
    return;
  }

  geocodeState = {
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    updated: 0, skipped: 0, noResult: 0, failed: 0, total: 0,
    error: null,
  };
  res.status(202).json({ message: "Geocoding started", state: geocodeState });

  const tsxBin = findTsx();
  console.log(`[Admin] Forking geocode child process: ${tsxBin} ${GEOCODE_SCRIPT}`);

  // Override DATABASE_URL with RAILWAY_DATABASE_URL if set so the script runs
  // against the production Railway database rather than the local dev DB.
  const geocodeEnv = { ...process.env };
  if (process.env.RAILWAY_DATABASE_URL) {
    geocodeEnv.DATABASE_URL = process.env.RAILWAY_DATABASE_URL;
  }

  execFileAsync(tsxBin, [GEOCODE_SCRIPT], {
    cwd: API_SERVER_DIR,
    env: geocodeEnv,
    maxBuffer: 20 * 1024 * 1024,
    timeout: 120 * 60 * 1000, // 120 minutes — ~1 req/s for up to ~7,000 hospitals
  })
    .then(({ stdout }) => {
      const resultLine = stdout.split(/\r?\n/).find((l) => l.startsWith("GEOCODE_RESULT:"));
      if (!resultLine) {
        throw new Error("Script did not emit a GEOCODE_RESULT line");
      }
      const result = JSON.parse(resultLine.replace("GEOCODE_RESULT:", "")) as {
        updated: number; skipped: number; noResult: number; failed: number; total: number;
      };
      geocodeState = {
        status: "done",
        startedAt: geocodeState.startedAt,
        finishedAt: new Date().toISOString(),
        updated: result.updated,
        skipped: result.skipped,
        noResult: result.noResult,
        failed: result.failed,
        total: result.total,
        error: null,
      };
      console.log("[Admin] Geocoding completed:", geocodeState);
    })
    .catch((err: unknown) => {
      const msg = String((err as Error)?.message ?? err);
      geocodeState = {
        ...geocodeState,
        status: "error",
        finishedAt: new Date().toISOString(),
        error: msg,
      };
      console.error("[Admin] Geocoding failed:", err);
    });
});

// ─── Address Geocode Pass 2 Trigger ──────────────────────────────────────────

let geocodePass2State: {
  status: "idle" | "running" | "done" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  updated: number;
  skipped: number;
  noResult: number;
  failed: number;
  total: number;
  error: string | null;
} = {
  status: "idle", startedAt: null, finishedAt: null,
  updated: 0, skipped: 0, noResult: 0, failed: 0, total: 0, error: null,
};

router.get("/admin/geocode-pass2-status", requireAdmin, (_req, res) => {
  res.json(geocodePass2State);
});

/**
 * POST /api/admin/run-geocode-pass2
 *
 * Triggers the second Nominatim geocoding pass.  Targets only the ~765
 * hospitals that were NOT updated by the first pass (timestamps before
 * 2026-04-08 02:05:57).  Strips Suite/Box/Floor/Unit suffixes from
 * addresses before geocoding and falls back to city+state+zip if the
 * cleaned street address still returns no result.
 * Returns 202 immediately; poll /api/admin/geocode-pass2-status for progress.
 */
router.post("/admin/run-geocode-pass2", requireAdmin, async (_req, res) => {
  if (geocodePass2State.status === "running") {
    res.status(409).json({ error: "Pass-2 geocoding already running", state: geocodePass2State });
    return;
  }
  if (geocodeState.status === "running") {
    res.status(409).json({ error: "Pass-1 geocoding is still running", state: geocodeState });
    return;
  }

  geocodePass2State = {
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    updated: 0, skipped: 0, noResult: 0, failed: 0, total: 0,
    error: null,
  };
  res.status(202).json({ message: "Geocoding pass 2 started", state: geocodePass2State });

  const tsxBin = findTsx();
  console.log(`[Admin] Forking geocode-pass2 child: ${tsxBin} ${GEOCODE_PASS2_SCRIPT}`);

  const geocodeEnv = { ...process.env };
  if (process.env.RAILWAY_DATABASE_URL) {
    geocodeEnv.DATABASE_URL = process.env.RAILWAY_DATABASE_URL;
  }

  execFileAsync(tsxBin, [GEOCODE_PASS2_SCRIPT], {
    cwd: API_SERVER_DIR,
    env: geocodeEnv,
    maxBuffer: 20 * 1024 * 1024,
    timeout: 60 * 60 * 1000, // 60 minutes — 765 hospitals × 1.1 s ≈ 14 min
  })
    .then(({ stdout }) => {
      const resultLine = stdout.split(/\r?\n/).find((l) => l.startsWith("GEOCODE_RESULT:"));
      if (!resultLine) throw new Error("Script did not emit a GEOCODE_RESULT line");
      const result = JSON.parse(resultLine.replace("GEOCODE_RESULT:", "")) as {
        updated: number; skipped: number; noResult: number; failed: number; total: number;
      };
      geocodePass2State = {
        status: "done",
        startedAt: geocodePass2State.startedAt,
        finishedAt: new Date().toISOString(),
        updated: result.updated,
        skipped: result.skipped,
        noResult: result.noResult,
        failed: result.failed,
        total: result.total,
        error: null,
      };
      console.log("[Admin] Geocode pass 2 completed:", geocodePass2State);
    })
    .catch((err: unknown) => {
      const msg = String((err as Error)?.message ?? err);
      geocodePass2State = {
        ...geocodePass2State,
        status: "error",
        finishedAt: new Date().toISOString(),
        error: msg,
      };
      console.error("[Admin] Geocode pass 2 failed:", err);
    });
});

// ─── Census Batch Geocode Trigger ────────────────────────────────────────────

let censusBatchState: {
  status: "idle" | "running" | "done" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  updated: number;
  skipped: number;
  noMatch: number;
  failed: number;
  total: number;
  stillMissing: number;
  reportPath: string | null;
  error: string | null;
} = {
  status: "idle", startedAt: null, finishedAt: null,
  updated: 0, skipped: 0, noMatch: 0, failed: 0, total: 0,
  stillMissing: 0, reportPath: null, error: null,
};

router.get("/admin/census-geocode-status", requireAdmin, (_req, res) => {
  res.json(censusBatchState);
});

/**
 * GET /api/admin/missing-coords-report
 *
 * Downloads the CSV report of hospitals that still have no coordinates after
 * the last full-pass Census geocoding run.
 */
router.get("/admin/missing-coords-report", requireAdmin, (_req, res) => {
  const reportPath = censusBatchState.reportPath ??
    path.join(API_SERVER_DIR, "missing-hospital-coords.csv");

  if (!fs.existsSync(reportPath)) {
    res.status(404).json({ error: "Report not generated yet — run the Census geocoder first." });
    return;
  }

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="missing-hospital-coords.csv"'
  );
  fs.createReadStream(reportPath).pipe(res);
});

/**
 * POST /api/admin/run-census-geocode
 *
 * Triggers the US Census Bureau batch geocoder for all non-OSM emergency
 * hospitals.  Returns 202 immediately; poll /api/admin/census-geocode-status.
 * Typical runtime: 2–5 minutes for ~3,800 hospitals (4 batches of 1,000).
 */
router.post("/admin/run-census-geocode", requireAdmin, async (_req, res) => {
  if (censusBatchState.status === "running") {
    res.status(409).json({ error: "Census geocoding already running", state: censusBatchState });
    return;
  }

  censusBatchState = {
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    updated: 0, skipped: 0, noMatch: 0, failed: 0, total: 0,
    stillMissing: 0, reportPath: null,
    error: null,
  };
  res.status(202).json({ message: "Census geocoding started", state: censusBatchState });

  const tsxBin = findTsx();
  console.log(`[Admin] Forking census-geocode child: ${tsxBin} ${GEOCODE_CENSUS_SCRIPT}`);

  const geocodeEnv = { ...process.env };
  if (process.env.RAILWAY_DATABASE_URL) {
    geocodeEnv.DATABASE_URL = process.env.RAILWAY_DATABASE_URL;
  }

  execFileAsync(tsxBin, [GEOCODE_CENSUS_SCRIPT], {
    cwd: API_SERVER_DIR,
    env: geocodeEnv,
    maxBuffer: 20 * 1024 * 1024,
    timeout: 30 * 60 * 1000, // 30 minutes
  })
    .then(({ stdout }) => {
      const resultLine = stdout.split(/\r?\n/).find((l) => l.startsWith("GEOCODE_RESULT:"));
      if (!resultLine) throw new Error("Script did not emit a GEOCODE_RESULT line");
      const result = JSON.parse(resultLine.replace("GEOCODE_RESULT:", "")) as {
        total: number; submitted: number; updated: number; skipped: number;
        noMatch: number; failed: number; stillMissing: number; reportPath: string;
      };
      censusBatchState = {
        status: "done",
        startedAt: censusBatchState.startedAt,
        finishedAt: new Date().toISOString(),
        updated: result.updated,
        skipped: result.skipped,
        noMatch: result.noMatch,
        failed: result.failed,
        total: result.total,
        stillMissing: result.stillMissing,
        reportPath: result.reportPath,
        error: null,
      };
      console.log("[Admin] Census geocoding completed:", censusBatchState);
    })
    .catch((err: unknown) => {
      const msg = String((err as Error)?.message ?? err);
      censusBatchState = {
        ...censusBatchState,
        status: "error",
        finishedAt: new Date().toISOString(),
        error: msg,
      };
      console.error("[Admin] Census geocoding failed:", err);
    });
});

// ─── CMS Import Trigger ──────────────────────────────────────────────────────

let importState: {
  status: "idle" | "running" | "done" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
} = { status: "idle", startedAt: null, finishedAt: null, error: null };

router.get("/admin/import-status", requireAdmin, (_req, res) => {
  res.json(importState);
});

router.post("/admin/run-import", requireAdmin, async (_req, res) => {
  if (importState.status === "running") {
    res.status(409).json({ error: "Import already running", state: importState });
    return;
  }

  importState = { status: "running", startedAt: new Date().toISOString(), finishedAt: null, error: null };
  res.status(202).json({ message: "Import started", state: importState });

  // Run in background — do not await
  runImport()
    .then(() => {
      importState = { ...importState, status: "done", finishedAt: new Date().toISOString(), error: null };
      console.log("[Admin] CMS import completed successfully");
    })
    .catch((err: any) => {
      importState = { ...importState, status: "error", finishedAt: new Date().toISOString(), error: String(err?.message ?? err) };
      console.error("[Admin] CMS import failed:", err);
    });
});

export default router;
