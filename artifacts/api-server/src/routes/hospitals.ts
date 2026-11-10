import { Router } from "express";
import { hospitalDb as db, hospitalSpecialties, hospitalOverrides } from "@workspace/db";
import { and, isNotNull, sql, eq, or } from "drizzle-orm";
import { publicSpeciality } from "../lib/speciality-store";

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
 * The CMS emergency_services filter stays on. When
 * SHOW_VERIFIED_TRAUMA_WHEN_CMS_ER_NO is true/1/yes/on, hospitals that have
 * a verified Trauma specialty entry are also included. The flag defaults to off.
 *
 * Response: { hospitals: HospitalNearby[] }
 */

function showVerifiedTraumaWhenCmsErNo(): boolean {
  const v = (process.env.SHOW_VERIFIED_TRAUMA_WHEN_CMS_ER_NO ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

const hasVerifiedTraumaSpecialty = sql`
  EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      COALESCE(${hospitalSpecialties.designationSources}->'_specialityV1'->'entries', '[]'::jsonb)
    ) AS speciality_entry
    WHERE speciality_entry->>'category' = 'Trauma'
      AND speciality_entry->>'status' = 'verified'
  )
`;

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
        designationSources: hospitalSpecialties.designationSources,
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
        sql`CASE WHEN ${hospitalSpecialties.osmId} LIKE 'osm-%'
          THEN ${hospitalSpecialties.osmId}
          ELSE 'osm-' || replace(${hospitalSpecialties.osmId}, '/', '-')
          END = ${hospitalOverrides.osmId}`
      )
      .where(
        and(
          showVerifiedTraumaWhenCmsErNo()
            ? or(
                eq(hospitalSpecialties.emergencyServices, true),
                hasVerifiedTraumaSpecialty,
              )
            : eq(hospitalSpecialties.emergencyServices, true),
          eq(hospitalSpecialties.active, true),
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
      const speciality = publicSpeciality(row.designationSources);

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
        ...speciality,
        phone: row.overridePhone ?? row.cmsPhone ?? null,
        // Enriched fields
        serviceLine: row.serviceLine ?? null,
        advancedCapabilities: row.advancedCapabilities ?? null,
        emsTags: row.emsTags ?? null,
        helipad: row.helipad ?? null,
        beds: row.beds ?? null,
        hifldOwner: row.hifldOwner ?? null,
        hifldWebsite: row.hifldWebsite ?? null,
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
