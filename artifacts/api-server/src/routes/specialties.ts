import { Router } from "express";
import { db, hospitalSpecialties } from "@workspace/db";
import { isNotNull } from "drizzle-orm";

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

const VALID_SPECIALTIES = new Set([
  "Trauma",
  "Cardiac",
  "Stroke",
  "Pediatric",
  "Burn",
  "Obstetrics",
  "Psychiatric",
  "Cancer",
]);

/**
 * GET /api/specialties
 * Returns { [osmId]: string[] } for all matched hospitals.
 * Admin-sourced records take priority over CMS-sourced ones when
 * both exist for the same osmId.
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
      if (specialties.length > 0) {
        result[osmId] = specialties;
      }
    }

    res.json(result);
  } catch (err) {
    console.error("GET /api/specialties error:", err);
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

  const filtered = (specialties as string[]).filter((s) =>
    VALID_SPECIALTIES.has(s)
  );

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

export default router;
