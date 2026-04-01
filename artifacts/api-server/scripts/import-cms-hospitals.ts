/**
 * CMS Care Compare Hospital Import Script
 *
 * Fetches the CMS Hospital General Information dataset and upserts
 * records into the hospital_specialties table.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run import-cms
 *
 * OSM Matching:
 *   osmId is intentionally left null at import time. Matching to OSM
 *   hospital IDs happens lazily at the /api/specialties endpoint (Task 2)
 *   when the app sends back nearby hospital coordinates from Overpass.
 *   The matchCmsToOsm() utility exported from this file is used there.
 */

import { db, pool, hospitalSpecialties } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Hospital General Information dataset (xubh-q36u)
 * ~5,400 unique hospitals, includes hospital_type and emergency_services.
 * Note: this dataset does not include coordinates; OSM matching uses
 * name + state similarity at query time (Task 2).
 */
const CMS_API_BASE =
  "https://data.cms.gov/provider-data/api/1/datastore/query/xubh-q36u/0";
const PAGE_SIZE = 1000;

interface CmsRecord {
  facility_id: string;
  facility_name: string;
  address?: string;
  city?: string;
  state: string;
  zip_code?: string;
  hospital_type?: string;
  emergency_services?: string;
  location?:
    | string
    | { latitude?: string | number; longitude?: string | number }
    | null;
  [key: string]: unknown;
}

/**
 * Parse lat/lon from the CMS location field which can be:
 *  - WKT:    "POINT (-85.394 31.242)"
 *  - Object: { latitude: "31.242", longitude: "-85.394" }
 *  - null / undefined
 */
function parseLocation(
  location: CmsRecord["location"]
): { lat: number; lon: number } | null {
  if (!location) return null;

  if (typeof location === "string") {
    const match = location.match(/POINT\s*\(([^\s]+)\s+([^\s)]+)\)/i);
    if (match) {
      const lon = parseFloat(match[1]);
      const lat = parseFloat(match[2]);
      if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
    }
    return null;
  }

  if (typeof location === "object") {
    const lat = parseFloat(String(location.latitude ?? ""));
    const lon = parseFloat(String(location.longitude ?? ""));
    if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
  }

  return null;
}

/**
 * Derive specialties from CMS hospital_type and emergency_services fields.
 * This is a conservative baseline — admins can add finer-grained specialties
 * (stroke center type, trauma level, burn center, etc.) via the admin dashboard.
 */
function inferSpecialties(record: CmsRecord): string[] {
  const type = (record.hospital_type ?? "").toLowerCase();
  const hasEmergency = (record.emergency_services ?? "").toLowerCase() === "yes";

  if (!hasEmergency) return [];

  if (type.includes("children") || type.includes("pediatric")) {
    return ["Pediatric"];
  }

  if (
    type.includes("acute care") ||
    type.includes("critical access") ||
    type.includes("short-term acute")
  ) {
    return ["Trauma", "Cardiac"];
  }

  if (type.includes("surgical")) {
    return ["Trauma"];
  }

  return [];
}

interface CmsResponse {
  results?: CmsRecord[];
  count?: number;
}

async function fetchPage(offset: number): Promise<{ records: CmsRecord[]; total: number }> {
  const url = `${CMS_API_BASE}?limit=${PAGE_SIZE}&offset=${offset}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`CMS API error ${res.status} at offset ${offset}`);
  }
  const json = (await res.json()) as CmsResponse;
  return { records: json.results ?? [], total: json.count ?? 0 };
}

const BATCH_SIZE = 200;

async function run() {
  let offset = 0;
  let totalFetched = 0;
  let imported = 0;
  let skipped = 0;
  let noCoords = 0;
  let knownTotal: number | null = null;
  const seenIds = new Set<string>();

  console.log("Fetching CMS Hospital General Information...");

  while (true) {
    const { records, total: apiTotal } = await fetchPage(offset);
    if (records.length === 0) break;
    if (knownTotal === null && apiTotal > 0) {
      knownTotal = apiTotal;
      console.log(`  Dataset total: ${knownTotal} rows (deduplicated by facility ID)`);
    }

    totalFetched += records.length;

    const dedupedThisPage = new Map<string, CmsRecord>();
    for (const rec of records) {
      if (!rec.facility_id || !rec.facility_name) {
        skipped++;
        continue;
      }
      if (!seenIds.has(rec.facility_id)) {
        dedupedThisPage.set(rec.facility_id, rec);
      }
    }

    const batch: Array<typeof hospitalSpecialties.$inferInsert> = [];

    for (const [id, rec] of dedupedThisPage) {
      seenIds.add(id);

      const hasEmergency =
        (rec.emergency_services ?? "").toLowerCase() === "yes";

      const coords = parseLocation(rec.location);
      if (!coords) noCoords++;

      const specialties = inferSpecialties(rec);

      batch.push({
        cmsId: rec.facility_id,
        hospitalName: rec.facility_name,
        state: rec.state ?? "",
        latitude: coords?.lat ?? null,
        longitude: coords?.lon ?? null,
        specialties: specialties,
        emergencyServices: hasEmergency,
        source: "cms",
        verified: true,
        osmId: null,
        updatedAt: new Date(),
      });
    }

    for (let i = 0; i < batch.length; i += BATCH_SIZE) {
      const chunk = batch.slice(i, i + BATCH_SIZE);
      if (chunk.length === 0) continue;
      await db
        .insert(hospitalSpecialties)
        .values(chunk)
        .onConflictDoUpdate({
          target: hospitalSpecialties.cmsId,
          set: {
            hospitalName: sql`EXCLUDED.hospital_name`,
            state: sql`EXCLUDED.state`,
            latitude: sql`EXCLUDED.latitude`,
            longitude: sql`EXCLUDED.longitude`,
            specialties: sql`EXCLUDED.specialties`,
            emergencyServices: sql`EXCLUDED.emergency_services`,
            updatedAt: sql`EXCLUDED.updated_at`,
          },
        });
      imported += chunk.length;
    }

    console.log(
      `  Offset ${offset + records.length}: ${seenIds.size} unique facilities so far...`
    );

    offset += records.length;
    if (records.length < PAGE_SIZE) break;
  }

  await pool.end();
  console.log("\n=== CMS Import Complete ===");
  console.log(`  Total rows fetched    : ${totalFetched}`);
  console.log(`  Unique facilities     : ${seenIds.size}`);
  console.log(`  Upserted to DB        : ${imported}`);
  console.log(`  Skipped (no ID/name)  : ${skipped}`);
  console.log(`  No coordinates        : ${noCoords}`);
  console.log(
    "\nOSM matching is done lazily at /api/specialties (Task 2)."
  );
  console.log(
    "Run the API server and the app to trigger coordinate-based matching.\n"
  );
}

run().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});

// ─── OSM Matching Utility (used by Task 2 API endpoint) ──────────────────────

/**
 * Haversine distance in meters between two coordinate pairs.
 */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Normalize a hospital name for fuzzy comparison.
 * Lowercases, strips punctuation, expands common abbreviations.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[''.,\-]/g, " ")
    .replace(/\bmedical center\b/g, "medical center")
    .replace(/\bmed ctr\b/g, "medical center")
    .replace(/\bhosp\b/g, "hospital")
    .replace(/\bregional\b/g, "regional")
    .replace(/\bmemorial\b/g, "memorial")
    .replace(/\buniversity\b/g, "university")
    .replace(/\buniv\b/g, "university")
    .replace(/\bst\b/g, "saint")
    .replace(/\bsaint\b/g, "saint")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Token overlap score (0–1) between two normalized names.
 * 1.0 = identical token sets, 0.0 = no overlap.
 */
export function nameScore(a: string, b: string): number {
  const tokA = new Set(normalizeName(a).split(" ").filter((t) => t.length > 2));
  const tokB = new Set(normalizeName(b).split(" ").filter((t) => t.length > 2));
  if (tokA.size === 0 || tokB.size === 0) return 0;
  let overlap = 0;
  for (const t of tokA) if (tokB.has(t)) overlap++;
  return overlap / Math.max(tokA.size, tokB.size);
}

export interface OsmHospitalRef {
  osmId: string;
  name: string;
  lat: number;
  lon: number;
}

export interface CmsCandidate {
  cmsId: string;
  hospitalName: string;
  lat: number | null;
  lon: number | null;
  specialties: string[];
  emergencyServices: boolean;
  osmId: string | null;
}

/**
 * Given a list of OSM hospitals (from Overpass) and a list of CMS candidates
 * (from the database, pre-filtered to the relevant state), find the best CMS
 * match for each OSM hospital.
 *
 * Matching strategy:
 *  - If CMS record has coordinates AND OSM has coordinates: use distance + name score
 *  - Otherwise (CMS has no coordinates): use name score alone, threshold > 0.55
 *
 * Returns a Map<osmId, CmsCandidate> for hospitals where a confident match was found.
 */
export function matchOsmToCms(
  osmHospitals: OsmHospitalRef[],
  cmsCandidates: CmsCandidate[]
): Map<string, CmsCandidate> {
  const result = new Map<string, CmsCandidate>();

  for (const osm of osmHospitals) {
    let bestScore = 0;
    let bestCandidate: CmsCandidate | null = null;

    for (const cms of cmsCandidates) {
      const ns = nameScore(osm.name, cms.hospitalName);

      let combined: number;

      if (cms.lat !== null && cms.lon !== null) {
        const dist = haversineMeters(osm.lat, osm.lon, cms.lat, cms.lon);
        if (dist > 1000) continue;
        combined = ns * 0.7 + (1 - Math.min(dist, 1000) / 1000) * 0.3;
        if (ns < 0.35) continue;
      } else {
        combined = ns;
        if (ns < 0.55) continue;
      }

      if (combined > bestScore) {
        bestScore = combined;
        bestCandidate = cms;
      }
    }

    if (bestCandidate) {
      result.set(osm.osmId, bestCandidate);
    }
  }

  return result;
}
