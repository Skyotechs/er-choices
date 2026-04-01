import { Router } from "express";
import { db, hospitalOverrides, hospitalSpecialties } from "@workspace/db";
import { eq, ilike } from "drizzle-orm";

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
        osmId: hospitalSpecialties.osmId,
        hospitalName: hospitalSpecialties.hospitalName,
        latitude: hospitalSpecialties.latitude,
        longitude: hospitalSpecialties.longitude,
      })
      .from(hospitalSpecialties)
      .where(ilike(hospitalSpecialties.hospitalName, `%${q}%`))
      .limit(50);

    // Normalise osmIds and deduplicate, keeping first occurrence
    const seenOsmIds = new Set<string>();
    const unique = rows
      .filter((r) => !!r.osmId)
      .map((r) => ({ ...r, osmId: normaliseOsmId(r.osmId as string) }))
      .filter((r) => {
        if (seenOsmIds.has(r.osmId)) return false;
        seenOsmIds.add(r.osmId);
        return true;
      });

    const osmIds = unique.map((r) => r.osmId);

    // Fetch all overrides for these osmIds in one query
    const allOverrides = osmIds.length > 0
      ? await Promise.all(
          osmIds.map((id) =>
            db
              .select()
              .from(hospitalOverrides)
              .where(eq(hospitalOverrides.osmId, id))
              .limit(1)
          )
        ).then((results) => results.flat())
      : [];

    const overrideMap: Record<string, { phone: string | null; latitude: number | null; longitude: number | null }> = {};
    for (const o of allOverrides) {
      overrideMap[o.osmId] = {
        phone: o.phone ?? null,
        latitude: o.latitude ?? null,
        longitude: o.longitude ?? null,
      };
    }

    const merged = unique.slice(0, 20).map((r) => {
      const override = overrideMap[r.osmId as string];
      return {
        osmId: r.osmId,
        name: r.hospitalName,
        phone: override?.phone ?? null,
        latitude: override?.latitude ?? r.latitude ?? null,
        longitude: override?.longitude ?? r.longitude ?? null,
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

export default router;
