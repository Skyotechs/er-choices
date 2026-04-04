import { Router } from "express";
import { db, hospitalSpecialties, hospitalOverrides } from "@workspace/db";
import { and, isNotNull, sql, eq } from "drizzle-orm";

const router = Router();

function normaliseOsmId(dbId: string): string {
  if (dbId.startsWith("osm-")) return dbId;
  return "osm-" + dbId.replace("/", "-");
}

const CANONICAL_TO_LEGACY: Record<string, string> = {
  "Behavioral Health": "Psychiatric",
  "Burn Center - Adult": "Burn",
  "Burn Center - Pediatric": "Burn",
  "Cardiac - PCI Capable": "Cardiac",
  "HazMat/Decontamination": "Trauma",
  "Obstetrics": "Obstetrics",
  "Pediatric Care": "Pediatric",
  "Stroke - Comprehensive Center": "Stroke",
  "Stroke - Thrombectomy Capable Center": "Stroke",
  "Stroke - Primary Center": "Stroke",
  "Stroke - Acute Ready Center": "Stroke",
  "Trauma - Adult Level 1 & 2": "Trauma",
  "Trauma - Adult Level 3": "Trauma",
  "Trauma - Adult Level 4": "Trauma",
  "Trauma - Pediatric Level 1": "Trauma",
  "Trauma - Pediatric Level 2": "Trauma",
};

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
  }
  return Array.from(out);
}

/**
 * GET /api/hospitals/nearby?lat=&lon=&radius=
 *
 * Returns emergency hospitals from the CMS database within `radius` miles
 * (default 50, max 300) sorted by distance. Admin lat/lon/phone overrides
 * are applied automatically via a LEFT JOIN on hospital_overrides.
 *
 * Response: { hospitals: HospitalNearby[] }
 */
router.get("/hospitals/nearby", async (req, res) => {
  const lat = parseFloat(req.query.lat as string);
  const lon = parseFloat(req.query.lon as string);
  const radiusMiles = Math.min(
    parseFloat((req.query.radius as string) || "50"),
    300
  );

  if (isNaN(lat) || isNaN(lon)) {
    res.status(400).json({ error: "lat and lon are required numeric parameters" });
    return;
  }

  try {
    const distanceSql = sql<number>`
      (3959.0 * acos(LEAST(1.0,
        cos(radians(${lat})) * cos(radians(${hospitalSpecialties.latitude}))
        * cos(radians(${hospitalSpecialties.longitude}) - radians(${lon}))
        + sin(radians(${lat})) * sin(radians(${hospitalSpecialties.latitude}))
      )))
    `;

    const rows = await db
      .select({
        osmId: hospitalSpecialties.osmId,
        cmsId: hospitalSpecialties.cmsId,
        hospitalName: hospitalSpecialties.hospitalName,
        address: hospitalSpecialties.address,
        city: hospitalSpecialties.city,
        state: hospitalSpecialties.state,
        zip: hospitalSpecialties.zip,
        cmsPhone: hospitalSpecialties.phone,
        latitude: hospitalSpecialties.latitude,
        longitude: hospitalSpecialties.longitude,
        specialties: hospitalSpecialties.specialties,
        distance: distanceSql,
        overrideLat: hospitalOverrides.latitude,
        overrideLon: hospitalOverrides.longitude,
        overridePhone: hospitalOverrides.phone,
        // Enriched fields from HIFLD / research pass
        actualDesignation: hospitalSpecialties.actualDesignation,
        serviceLine: hospitalSpecialties.serviceLine,
        advancedCapabilities: hospitalSpecialties.advancedCapabilities,
        emsTags: hospitalSpecialties.emsTags,
        helipad: hospitalSpecialties.helipad,
        beds: hospitalSpecialties.beds,
        hifldOwner: hospitalSpecialties.hifldOwner,
        hifldWebsite: hospitalSpecialties.hifldWebsite,
        strokeDesignation: hospitalSpecialties.strokeDesignation,
        burnDesignation: hospitalSpecialties.burnDesignation,
        pciCapability: hospitalSpecialties.pciCapability,
        hifldMatchConfidence: hospitalSpecialties.hifldMatchConfidence,
      })
      .from(hospitalSpecialties)
      .leftJoin(
        hospitalOverrides,
        eq(hospitalSpecialties.osmId, hospitalOverrides.osmId)
      )
      .where(
        and(
          eq(hospitalSpecialties.emergencyServices, true),
          isNotNull(hospitalSpecialties.latitude),
          isNotNull(hospitalSpecialties.longitude),
          sql`${distanceSql} < ${radiusMiles}`
        )
      )
      .orderBy(distanceSql)
      .limit(50);

    const hospitals = rows.map((row) => {
      const finalLat = row.overrideLat ?? row.latitude;
      const finalLon = row.overrideLon ?? row.longitude;
      const id = row.osmId
        ? normaliseOsmId(row.osmId)
        : `cms-${row.cmsId}`;
      const categories = toMobileCategories(
        (row.specialties as string[]) ?? []
      );

      return {
        id,
        name: row.hospitalName,
        address: row.address ?? null,
        city: row.city ?? null,
        state: row.state,
        zip: row.zip ?? null,
        latitude: finalLat,
        longitude: finalLon,
        distance: row.distance,
        categories,
        specialties: (row.specialties as string[]) ?? [],
        phone: row.overridePhone ?? row.cmsPhone ?? null,
        // Enriched fields
        actualDesignation: row.actualDesignation ?? null,
        serviceLine: row.serviceLine ?? null,
        advancedCapabilities: row.advancedCapabilities ?? null,
        emsTags: row.emsTags ?? null,
        helipad: row.helipad ?? null,
        beds: row.beds ?? null,
        hifldOwner: row.hifldOwner ?? null,
        hifldWebsite: row.hifldWebsite ?? null,
        strokeDesignation: row.strokeDesignation ?? null,
        burnDesignation: row.burnDesignation ?? null,
        pciCapability: row.pciCapability ?? null,
        hifldMatchConfidence: row.hifldMatchConfidence ?? null,
      };
    });

    res.json({ hospitals });
  } catch (err) {
    console.error("GET /api/hospitals/nearby error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
