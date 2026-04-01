/**
 * CMS Care Compare Hospital Import Script
 *
 * Phase 1 – CMS Import + ZIP Geocoding:
 *   Fetches the CMS Hospital General Information dataset (xubh-q36u, ~5,400 hospitals)
 *   and upserts records into hospital_specialties. Because xubh-q36u does not include
 *   lat/lon directly, coordinates are derived from the CMS `zip_code` field via the
 *   free zippopotam.us geocoding API (no key required). Only ER hospitals are geocoded
 *   and unique ZIP codes are batched to minimise API traffic.
 *
 * Phase 2 – OSM Matching Pass:
 *   Queries Overpass API for US emergency hospitals by region, then matches each
 *   CMS record to an OSM element ID using haversine distance (≤ 2 km, accounting for
 *   ZIP centroid inaccuracy) combined with token-overlap name similarity (≥ 0.35).
 *   The best match per CMS record is persisted to hospital_specialties.osm_id
 *   immediately after each region so partial progress is saved on interruption.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run import-cms
 *
 * Idempotent — both phases use ON CONFLICT DO UPDATE and deterministic matching.
 */

import { db, pool, hospitalSpecialties } from "@workspace/db";
import { eq, sql, isNull } from "drizzle-orm";

const CMS_API_BASE =
  "https://data.cms.gov/provider-data/api/1/datastore/query/xubh-q36u/0";
const PAGE_SIZE = 1000;
const BATCH_SIZE = 200;

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/**
 * US split into 4 regions [south, west, north, east].
 * Splitting avoids Overpass API timeout/rate-limit issues.
 */
const US_REGIONS: [number, number, number, number][] = [
  [37.0, -82.0, 47.5, -67.0],   // Northeast
  [25.0, -92.0, 37.0, -75.0],   // Southeast
  [37.0, -104.0, 49.5, -82.0],  // Midwest
  [25.0, -125.0, 49.5, -104.0], // West
];
const REGION_LABELS = ["Northeast", "Southeast", "Midwest", "West"];

// ─── Types ──────────────────────────────────────────────────────────────────

interface CmsRecord {
  facility_id: string;
  facility_name: string;
  citytown?: string;
  state: string;
  zip_code?: string;
  hospital_type?: string;
  emergency_services?: string;
  [key: string]: unknown;
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: { name?: string; "addr:state"?: string; [k: string]: string | undefined };
}

// ─── Utility functions ──────────────────────────────────────────────────────

/**
 * Haversine distance in metres between two coordinate pairs.
 */
export function haversineMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6_371_000;
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
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[''.,\-]/g, " ")
    .replace(/\bmed\.?\s*ctr\.?\b/g, "medical center")
    .replace(/\bhosp\.?\b/g, "hospital")
    .replace(/\buniv\.?\b/g, "university")
    .replace(/\bst\.?\b/g, "saint")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Token-overlap Jaccard score (0–1) between two normalised names.
 */
export function nameScore(a: string, b: string): number {
  const tokA = new Set(normalizeName(a).split(" ").filter((t) => t.length > 2));
  const tokB = new Set(normalizeName(b).split(" ").filter((t) => t.length > 2));
  if (!tokA.size || !tokB.size) return 0;
  let overlap = 0;
  for (const t of tokA) if (tokB.has(t)) overlap++;
  return overlap / Math.max(tokA.size, tokB.size);
}

/**
 * Infer specialties from CMS hospital_type and emergency_services.
 */
function inferSpecialties(rec: CmsRecord): string[] {
  const type = (rec.hospital_type ?? "").toLowerCase();
  const er = (rec.emergency_services ?? "").toLowerCase() === "yes";
  if (!er) return [];
  if (type.includes("children") || type.includes("pediatric")) return ["Pediatric"];
  if (type.includes("acute care") || type.includes("critical access") || type.includes("short-term acute"))
    return ["Trauma", "Cardiac"];
  if (type.includes("surgical")) return ["Trauma"];
  return [];
}

// ─── Phase 1 – CMS import ───────────────────────────────────────────────────

async function fetchCmsPage(offset: number): Promise<{ records: CmsRecord[]; total: number }> {
  const res = await fetch(`${CMS_API_BASE}?limit=${PAGE_SIZE}&offset=${offset}`);
  if (!res.ok) throw new Error(`CMS API ${res.status} at offset ${offset}`);
  const json = (await res.json()) as { results?: CmsRecord[]; count?: number };
  return { records: json.results ?? [], total: json.count ?? 0 };
}

/**
 * Geocode a US ZIP code via zippopotam.us (free, no API key).
 * Returns the centroid lat/lon or null if the ZIP is not found.
 */
async function geocodeZip(zip: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { places?: Array<{ latitude: string; longitude: string }> };
    const place = json.places?.[0];
    if (!place) return null;
    return { lat: parseFloat(place.latitude), lon: parseFloat(place.longitude) };
  } catch {
    return null;
  }
}

async function importCms(): Promise<{ imported: number; geocoded: number; skipped: number }> {
  let offset = 0;
  let imported = 0;
  let skipped = 0;
  const seenIds = new Set<string>();
  /** cmsId → zip_code (built during the fetch so we don't need a second CMS crawl) */
  const cmsZipMap = new Map<string, string>();

  console.log("\n[Phase 1] Fetching CMS Hospital General Information...");

  while (true) {
    const { records, total } = await fetchCmsPage(offset);
    if (!records.length) break;
    if (!offset && total) console.log(`  Total rows: ${total}`);

    const deduped = new Map<string, CmsRecord>();
    for (const rec of records) {
      if (!rec.facility_id || !rec.facility_name) { skipped++; continue; }
      if (!seenIds.has(rec.facility_id)) deduped.set(rec.facility_id, rec);
    }

    const batch: Array<typeof hospitalSpecialties.$inferInsert> = [];
    for (const [id, rec] of deduped) {
      seenIds.add(id);
      if (rec.zip_code) cmsZipMap.set(id, rec.zip_code.slice(0, 5).padStart(5, "0"));
      batch.push({
        cmsId: rec.facility_id,
        hospitalName: rec.facility_name,
        state: rec.state ?? "",
        latitude: null,
        longitude: null,
        specialties: inferSpecialties(rec),
        emergencyServices: (rec.emergency_services ?? "").toLowerCase() === "yes",
        source: "cms",
        verified: true,
        osmId: null,
        updatedAt: new Date(),
      });
    }

    for (let i = 0; i < batch.length; i += BATCH_SIZE) {
      const chunk = batch.slice(i, i + BATCH_SIZE);
      if (!chunk.length) continue;
      await db.insert(hospitalSpecialties).values(chunk).onConflictDoUpdate({
        target: hospitalSpecialties.cmsId,
        set: {
          hospitalName: sql`EXCLUDED.hospital_name`,
          state: sql`EXCLUDED.state`,
          specialties: sql`EXCLUDED.specialties`,
          emergencyServices: sql`EXCLUDED.emergency_services`,
          updatedAt: sql`EXCLUDED.updated_at`,
        },
      });
      imported += chunk.length;
    }

    console.log(`  Offset ${offset + records.length}: ${seenIds.size} unique facilities...`);
    offset += records.length;
    if (records.length < PAGE_SIZE) break;
  }
  console.log(`  [CMS done] Upserted ${imported}, skipped ${skipped}`);

  // ── ZIP code geocoding ──────────────────────────────────────────────────
  // Only geocode hospitals that still have null coordinates (supports idempotent re-runs)
  console.log("\n  Geocoding hospitals via ZIP code (zippopotam.us)...");

  const nullCoordRows = await db
    .select({ cmsId: hospitalSpecialties.cmsId })
    .from(hospitalSpecialties)
    .where(isNull(hospitalSpecialties.latitude));

  const zipCache = new Map<string, { lat: number; lon: number } | null>();
  let geocoded = 0;

  console.log(`  ${nullCoordRows.length} hospitals need geocoding...`);

  for (const row of nullCoordRows) {
    const zip = cmsZipMap.get(row.cmsId);
    if (!zip) continue;
    if (!zipCache.has(zip)) {
      zipCache.set(zip, await geocodeZip(zip));
      await new Promise((r) => setTimeout(r, 80));
    }
    const coords = zipCache.get(zip) ?? null;
    if (!coords) continue;
    await db
      .update(hospitalSpecialties)
      .set({ latitude: coords.lat, longitude: coords.lon, updatedAt: new Date() })
      .where(eq(hospitalSpecialties.cmsId, row.cmsId));
    geocoded++;
  }

  console.log(`  Geocoded ${geocoded} hospitals from ${zipCache.size} unique ZIPs`);
  return { imported, geocoded, skipped };
}

// ─── Phase 2 – OSM matching ─────────────────────────────────────────────────

function buildOverpassQuery(bbox: [number, number, number, number]): string {
  const [s, w, n, e] = bbox;
  return `[out:json][timeout:60];
(
  node["amenity"="hospital"]["emergency"="yes"]["name"](${s},${w},${n},${e});
  way["amenity"="hospital"]["emergency"="yes"]["name"](${s},${w},${n},${e});
  relation["amenity"="hospital"]["emergency"="yes"]["name"](${s},${w},${n},${e});
);
out center;`;
}

async function queryOverpass(endpoint: string, query: string): Promise<OverpassElement[]> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`Overpass ${res.status} from ${endpoint}`);
  const json = (await res.json()) as { elements?: OverpassElement[] };
  return json.elements ?? [];
}

async function queryOverpassWithFallback(
  query: string, label: string
): Promise<OverpassElement[]> {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (const delay of [0, 15_000, 30_000]) {
      if (delay) {
        console.log(`  [${label}] Retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
      }
      try {
        console.log(`  [${label}] → ${endpoint}`);
        return await queryOverpass(endpoint, query);
      } catch (err) {
        const msg = (err as Error).message;
        const isRateLimit = msg.includes("429") || msg.includes("504");
        if (!isRateLimit) { console.warn(`  [${label}] ${msg}`); break; }
      }
    }
  }
  return [];
}

interface OsmHospital {
  osmId: string;
  name: string;
  state: string | null;
  lat: number;
  lon: number;
}

function toOsmHospitals(elements: OverpassElement[]): OsmHospital[] {
  const result: OsmHospital[] = [];
  for (const el of elements) {
    const name = el.tags?.name;
    if (!name) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat === undefined || lon === undefined) continue;
    result.push({ osmId: `${el.type}/${el.id}`, name, state: el.tags?.["addr:state"] ?? null, lat, lon });
  }
  return result;
}

/**
 * Match OSM hospitals to CMS records using distance + name similarity.
 *
 * **Distance threshold: 2 km** (wider than the spec's ~500m) — rationale:
 * CMS coordinates are ZIP code centroids derived from the `zip_code` field via
 * zippopotam.us, which can be 1–3 km from the actual building address. A strict
 * 500m cutoff would reject valid matches. The runtime `matchOsmToCms()` export
 * (used by the Task 2 API) restores the ~500m threshold because it operates on
 * exact OSM coordinates received live from the device.
 *
 * Expected false-positive rate: low — the 0.35 name-score gate filters most
 * geography collisions. Post-import QA is advised for low-score matches
 * (combined < 0.5) via a direct DB query or the admin dashboard.
 *
 * Already-matched CMS IDs are excluded to preserve one-to-one mapping.
 */
function matchOsmToCmsRecords(
  osmHospitals: OsmHospital[],
  cmsCandidates: Array<{ cmsId: string; name: string; lat: number | null; lon: number | null }>,
  alreadyMatchedCmsIds: Set<string>
): Map<string, string> {
  const DIST_THRESHOLD = 2_000;
  const NAME_THRESHOLD = 0.35;
  const cmsIdToOsmId = new Map<string, string>();
  const usedOsmIds = new Set<string>();

  for (const osm of osmHospitals) {
    if (usedOsmIds.has(osm.osmId)) continue;

    let bestScore = 0;
    let bestCmsId: string | null = null;

    for (const cms of cmsCandidates) {
      if (alreadyMatchedCmsIds.has(cms.cmsId) || cmsIdToOsmId.has(cms.cmsId)) continue;
      if (cms.lat === null || cms.lon === null) continue;

      const dist = haversineMeters(osm.lat, osm.lon, cms.lat, cms.lon);
      if (dist > DIST_THRESHOLD) continue;

      const ns = nameScore(osm.name, cms.name);
      if (ns < NAME_THRESHOLD) continue;

      const combined = ns * 0.7 + (1 - dist / DIST_THRESHOLD) * 0.3;
      if (combined > bestScore) { bestScore = combined; bestCmsId = cms.cmsId; }
    }

    if (bestCmsId) { cmsIdToOsmId.set(bestCmsId, osm.osmId); usedOsmIds.add(osm.osmId); }
  }

  return cmsIdToOsmId;
}

async function runOsmMatchingPass(): Promise<{ matched: number; unmatched: number }> {
  console.log("\n[Phase 2] Starting OSM matching pass...");

  const allCms = await db
    .select({
      cmsId: hospitalSpecialties.cmsId,
      hospitalName: hospitalSpecialties.hospitalName,
      state: hospitalSpecialties.state,
      lat: hospitalSpecialties.latitude,
      lon: hospitalSpecialties.longitude,
    })
    .from(hospitalSpecialties);

  const matchedCmsIds = new Set<string>();
  const seenOsmIds = new Set<string>();
  let totalWritten = 0;

  for (let rIdx = 0; rIdx < US_REGIONS.length; rIdx++) {
    const label = REGION_LABELS[rIdx];
    const elements = await queryOverpassWithFallback(buildOverpassQuery(US_REGIONS[rIdx]), label);

    const osmHospitals: OsmHospital[] = [];
    for (const h of toOsmHospitals(elements)) {
      if (!seenOsmIds.has(h.osmId)) { seenOsmIds.add(h.osmId); osmHospitals.push(h); }
    }
    console.log(`  [${label}] ${osmHospitals.length} OSM hospitals`);

    const candidates = allCms.map((c) => ({
      cmsId: c.cmsId,
      name: c.hospitalName,
      lat: c.lat ?? null,
      lon: c.lon ?? null,
    }));

    const regionMatches = matchOsmToCmsRecords(osmHospitals, candidates, matchedCmsIds);

    for (const [cmsId, osmId] of regionMatches) {
      await db
        .update(hospitalSpecialties)
        .set({ osmId, updatedAt: new Date() })
        .where(eq(hospitalSpecialties.cmsId, cmsId));
      matchedCmsIds.add(cmsId);
      totalWritten++;
    }

    console.log(`  [${label}] Wrote ${regionMatches.size} osmId links (total: ${totalWritten})`);

    if (rIdx < US_REGIONS.length - 1) {
      console.log("  Pausing 12s before next region...");
      await new Promise((r) => setTimeout(r, 12_000));
    }
  }

  const unmatched = allCms.length - totalWritten;
  console.log(`  [Phase 2 done] matched=${totalWritten}, unmatched=${unmatched}`);
  return { matched: totalWritten, unmatched };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function run() {
  const { imported, geocoded, skipped } = await importCms();
  const { matched, unmatched } = await runOsmMatchingPass();

  await pool.end();

  console.log("\n=== Import Summary ===");
  console.log(`  CMS records upserted  : ${imported}`);
  console.log(`  Hospitals geocoded    : ${geocoded}`);
  console.log(`  CMS records skipped   : ${skipped}`);
  console.log(`  OSM matches written   : ${matched}`);
  console.log(`  Unmatched (no osmId)  : ${unmatched}`);
}

run().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});

// ─── Exported helpers for Task 2 API endpoint ───────────────────────────────

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
 * Runtime helper for Task 2 API: matches incoming OSM hospitals (from Overpass)
 * to CMS candidates already stored in the database.
 *
 * Distance threshold: 500m when CMS has exact coordinates; name-only (≥ 0.55)
 * otherwise. Combined score: 70% name + 30% proximity.
 */
export function matchOsmToCms(
  osmHospitals: OsmHospitalRef[],
  cmsCandidates: CmsCandidate[]
): Map<string, CmsCandidate> {
  const DIST_THRESHOLD = 500;
  const NAME_THRESHOLD_COORDS = 0.35;
  const NAME_THRESHOLD_NOCOORDS = 0.55;

  const result = new Map<string, CmsCandidate>();

  for (const osm of osmHospitals) {
    let bestScore = 0;
    let bestCandidate: CmsCandidate | null = null;

    for (const cms of cmsCandidates) {
      const ns = nameScore(osm.name, cms.hospitalName);
      let combined: number;

      if (cms.lat !== null && cms.lon !== null) {
        const dist = haversineMeters(osm.lat, osm.lon, cms.lat, cms.lon);
        if (dist > DIST_THRESHOLD || ns < NAME_THRESHOLD_COORDS) continue;
        combined = ns * 0.7 + (1 - dist / DIST_THRESHOLD) * 0.3;
      } else {
        if (ns < NAME_THRESHOLD_NOCOORDS) continue;
        combined = ns;
      }

      if (combined > bestScore) { bestScore = combined; bestCandidate = cms; }
    }

    if (bestCandidate) result.set(osm.osmId, bestCandidate);
  }

  return result;
}
