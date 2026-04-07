import { Router } from "express";
import { db, hospitalOverrides, hospitalSpecialties } from "@workspace/db";
import { eq, ilike } from "drizzle-orm";
import { runImport } from "../../scripts/import-cms-hospitals.js";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";

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
 * Searches hospitals by name from the specialties table (which has CMS + admin records).
 * Returns osmId, name, current phone, latitude, longitude (with admin overrides merged).
 */
router.get("/admin/hospitals/search", requireAdmin, async (req, res) => {
  const q = ((req.query.q as string) ?? "").trim();
  if (!q || q.length < 2) {
    res.status(400).json({ error: "Query must be at least 2 characters" });
    return;
  }

  try {
    const rows = await db
      .select({
        id: hospitalSpecialties.id,
        cmsId: hospitalSpecialties.cmsId,
        osmId: hospitalSpecialties.osmId,
        hospitalName: hospitalSpecialties.hospitalName,
        cmsPhone: hospitalSpecialties.phone,
        latitude: hospitalSpecialties.latitude,
        longitude: hospitalSpecialties.longitude,
        specialties: hospitalSpecialties.specialties,
      })
      .from(hospitalSpecialties)
      .where(ilike(hospitalSpecialties.hospitalName, `%${q}%`))
      .limit(50);

    // Normalise osmIds; keep all hospitals (OSM-matched and CMS-only)
    const seenKeys = new Set<string>();
    const unique = rows
      .map((r) => ({
        ...r,
        osmId: r.osmId ? normaliseOsmId(r.osmId) : null,
      }))
      .filter((r) => {
        const key = r.osmId ?? r.cmsId;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      });

    // Fetch overrides for OSM-matched hospitals
    const osmIds = unique.map((r) => r.osmId).filter((id): id is string => !!id);
    const allOverrides = osmIds.length > 0
      ? await Promise.all(
          osmIds.map((id) =>
            db.select().from(hospitalOverrides).where(eq(hospitalOverrides.osmId, id)).limit(1)
          )
        ).then((results) => results.flat())
      : [];

    const overrideMap: Record<string, { phone: string | null; latitude: number | null; longitude: number | null }> = {};
    for (const o of allOverrides) {
      overrideMap[o.osmId] = { phone: o.phone ?? null, latitude: o.latitude ?? null, longitude: o.longitude ?? null };
    }

    const merged = unique.slice(0, 20).map((r) => {
      const override = r.osmId ? overrideMap[r.osmId] : undefined;
      return {
        id: r.id,
        cmsId: r.cmsId,
        osmId: r.osmId ?? null,
        name: r.hospitalName,
        phone: override?.phone ?? r.cmsPhone ?? null,
        latitude: override?.latitude ?? r.latitude ?? null,
        longitude: override?.longitude ?? r.longitude ?? null,
        specialties: (r.specialties as string[]) ?? [],
        hasAdminOverride: !!override,
      };
    });

    res.json(merged);
  } catch (err) {
    console.error("GET /api/admin/hospitals/search error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /api/admin/hospitals/:osmId
 * Upserts phone, latitude, and longitude overrides for a hospital.
 * Any field included in the body will be saved (null clears it).
 */
router.patch("/admin/hospitals/:osmId", requireAdmin, async (req, res) => {
  const osmId = decodeURIComponent(req.params.osmId);
  if (!osmId || !osmId.startsWith("osm-")) {
    res.status(400).json({ error: "Invalid osmId — must start with 'osm-'" });
    return;
  }

  const body = req.body ?? {};
  const hasPhone = "phone" in body;
  const hasLat = "latitude" in body;
  const hasLon = "longitude" in body;

  if (!hasPhone && !hasLat && !hasLon) {
    res.status(400).json({ error: "At least one of phone, latitude, or longitude must be provided" });
    return;
  }

  if (hasPhone && body.phone !== null && typeof body.phone !== "string") {
    res.status(400).json({ error: "phone must be a string or null" });
    return;
  }
  if (hasLat && body.latitude !== null && typeof body.latitude !== "number") {
    res.status(400).json({ error: "latitude must be a number or null" });
    return;
  }
  if (hasLon && body.longitude !== null && typeof body.longitude !== "number") {
    res.status(400).json({ error: "longitude must be a number or null" });
    return;
  }

  try {
    const existing = await db
      .select()
      .from(hospitalOverrides)
      .where(eq(hospitalOverrides.osmId, osmId))
      .limit(1);

    if (existing.length > 0) {
      const updateValues: Partial<{
        phone: string | null;
        latitude: number | null;
        longitude: number | null;
        updatedAt: Date;
      }> = { updatedAt: new Date() };

      if (hasPhone) updateValues.phone = body.phone ?? null;
      if (hasLat) updateValues.latitude = body.latitude ?? null;
      if (hasLon) updateValues.longitude = body.longitude ?? null;

      await db
        .update(hospitalOverrides)
        .set(updateValues)
        .where(eq(hospitalOverrides.osmId, osmId));
    } else {
      await db.insert(hospitalOverrides).values({
        osmId,
        phone: hasPhone ? (body.phone ?? null) : null,
        latitude: hasLat ? (body.latitude ?? null) : null,
        longitude: hasLon ? (body.longitude ?? null) : null,
        updatedAt: new Date(),
      });
    }

    const [saved] = await db
      .select()
      .from(hospitalOverrides)
      .where(eq(hospitalOverrides.osmId, osmId))
      .limit(1);

    res.json({
      success: true,
      osmId,
      phone: saved.phone ?? null,
      latitude: saved.latitude ?? null,
      longitude: saved.longitude ?? null,
    });
  } catch (err) {
    console.error("PATCH /api/admin/hospitals error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /api/admin/hospitals/cms/:cmsId
 * Updates phone, latitude, and longitude directly on hospitalSpecialties for CMS-only hospitals
 * (hospitals with no OSM match). Any field included in the body will be saved (null clears it).
 */
router.patch("/admin/hospitals/cms/:cmsId", requireAdmin, async (req, res) => {
  const cmsId = decodeURIComponent(req.params.cmsId);
  if (!cmsId) {
    res.status(400).json({ error: "Invalid cmsId" });
    return;
  }

  const body = req.body ?? {};
  const hasPhone = "phone" in body;
  const hasLat = "latitude" in body;
  const hasLon = "longitude" in body;

  if (!hasPhone && !hasLat && !hasLon) {
    res.status(400).json({ error: "At least one of phone, latitude, or longitude must be provided" });
    return;
  }

  if (hasPhone && body.phone !== null && typeof body.phone !== "string") {
    res.status(400).json({ error: "phone must be a string or null" });
    return;
  }
  if (hasLat && body.latitude !== null && typeof body.latitude !== "number") {
    res.status(400).json({ error: "latitude must be a number or null" });
    return;
  }
  if (hasLon && body.longitude !== null && typeof body.longitude !== "number") {
    res.status(400).json({ error: "longitude must be a number or null" });
    return;
  }

  try {
    const existing = await db
      .select()
      .from(hospitalSpecialties)
      .where(eq(hospitalSpecialties.cmsId, cmsId))
      .limit(1);

    if (existing.length === 0) {
      res.status(404).json({ error: "Hospital not found" });
      return;
    }

    const updateValues: Partial<{ phone: string | null; latitude: string | null; longitude: string | null }> = {};
    if (hasPhone) updateValues.phone = body.phone ?? null;
    if (hasLat) updateValues.latitude = body.latitude != null ? String(body.latitude) : null;
    if (hasLon) updateValues.longitude = body.longitude != null ? String(body.longitude) : null;

    await db.update(hospitalSpecialties).set(updateValues).where(eq(hospitalSpecialties.cmsId, cmsId));

    const [saved] = await db
      .select()
      .from(hospitalSpecialties)
      .where(eq(hospitalSpecialties.cmsId, cmsId))
      .limit(1);

    res.json({
      success: true,
      cmsId,
      phone: saved.phone ?? null,
      latitude: saved.latitude != null ? Number(saved.latitude) : null,
      longitude: saved.longitude != null ? Number(saved.longitude) : null,
    });
  } catch (err) {
    console.error("PATCH /api/admin/hospitals/cms error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── CSV Export ──────────────────────────────────────────────────────────────

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
