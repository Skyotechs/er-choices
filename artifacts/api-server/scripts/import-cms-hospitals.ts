/**
 * CMS Care Compare Hospital Import Script
 *
 * Phase 1 – CMS Import:
 *   Fetches the CMS Hospital General Information dataset (xubh-q36u, ~5,400 hospitals)
 *   and upserts records into the hospital_specialties table.
 *
 * Phase 2 – OSM Matching Pass:
 *   Queries Overpass API for US emergency hospitals, then runs fuzzy name + state
 *   matching to link each CMS record to an OSM element ID. The match is persisted
 *   immediately to hospital_specialties.osm_id.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run import-cms
 *
 * The script is idempotent — safe to re-run; both phases use ON CONFLICT DO UPDATE
 * and deterministic matching logic.
 */

import { db, pool, hospitalSpecialties } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

/**
 * Hospital General Information dataset (xubh-q36u)
 * ~5,400 unique hospitals, includes hospital_type and emergency_services.
 * Note: this dataset does not include coordinates; Phase 2 OSM matching uses
 * name + state similarity from the Overpass API.
 */
const CMS_API_BASE =
  "https://data.cms.gov/provider-data/api/1/datastore/query/xubh-q36u/0";
const PAGE_SIZE = 1000;
const BATCH_SIZE = 200;

/**
 * Overpass API endpoints — tried in order on failure.
 */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/**
 * US split into 4 regions to stay under Overpass timeout limits.
 * Each region is [south, west, north, east].
 */
const US_REGIONS: [number, number, number, number][] = [
  [37.0, -82.0, 47.5, -67.0],  // Northeast
  [25.0, -92.0, 37.0, -75.0],  // Southeast
  [37.0, -104.0, 49.5, -82.0], // Midwest
  [25.0, -125.0, 49.5, -104.0], // West
];

function buildOverpassQuery(bbox: [number, number, number, number]): string {
  const [s, w, n, e] = bbox;
  return `
[out:json][timeout:60];
(
  node["amenity"="hospital"]["emergency"="yes"]["name"](${s},${w},${n},${e});
  way["amenity"="hospital"]["emergency"="yes"]["name"](${s},${w},${n},${e});
  relation["amenity"="hospital"]["emergency"="yes"]["name"](${s},${w},${n},${e});
);
out center;
`.trim();
}

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

interface CmsResponse {
  results?: CmsRecord[];
  count?: number;
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: {
    name?: string;
    "addr:state"?: string;
    [key: string]: string | undefined;
  };
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Normalize a hospital name for fuzzy comparison.
 * Lowercases, strips punctuation, expands common abbreviations.
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
 * Token-overlap Jaccard score (0–1) between two normalized names.
 * Only tokens with length > 2 are considered to avoid stopwords.
 */
export function nameScore(a: string, b: string): number {
  const tokA = new Set(normalizeName(a).split(" ").filter((t) => t.length > 2));
  const tokB = new Set(normalizeName(b).split(" ").filter((t) => t.length > 2));
  if (tokA.size === 0 || tokB.size === 0) return 0;
  let overlap = 0;
  for (const t of tokA) if (tokB.has(t)) overlap++;
  return overlap / Math.max(tokA.size, tokB.size);
}

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
 * Infer specialties from CMS hospital_type and emergency_services fields.
 * This is a conservative CMS baseline — admins can add finer-grained
 * specialties (trauma level, stroke centre, burn unit, etc.) later.
 */
function inferSpecialties(record: CmsRecord): string[] {
  const type = (record.hospital_type ?? "").toLowerCase();
  const hasEmergency =
    (record.emergency_services ?? "").toLowerCase() === "yes";

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

// ─── Phase 1: CMS Import ────────────────────────────────────────────────────

async function fetchCmsPage(
  offset: number
): Promise<{ records: CmsRecord[]; total: number }> {
  const url = `${CMS_API_BASE}?limit=${PAGE_SIZE}&offset=${offset}`;
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`CMS API ${res.status} at offset ${offset}`);
  const json = (await res.json()) as CmsResponse;
  return { records: json.results ?? [], total: json.count ?? 0 };
}

async function importCms(): Promise<{ imported: number; skipped: number }> {
  let offset = 0;
  let totalFetched = 0;
  let imported = 0;
  let skipped = 0;
  const seenIds = new Set<string>();

  console.log("\n[Phase 1] Fetching CMS Hospital General Information...");

  while (true) {
    const { records, total } = await fetchCmsPage(offset);
    if (records.length === 0) break;
    if (offset === 0 && total > 0) {
      console.log(`  Dataset total: ${total} rows`);
    }

    totalFetched += records.length;
    const dedupedPage = new Map<string, CmsRecord>();

    for (const rec of records) {
      if (!rec.facility_id || !rec.facility_name) {
        skipped++;
        continue;
      }
      if (!seenIds.has(rec.facility_id)) {
        dedupedPage.set(rec.facility_id, rec);
      }
    }

    const batch: Array<typeof hospitalSpecialties.$inferInsert> = [];

    for (const [id, rec] of dedupedPage) {
      seenIds.add(id);
      const hasEmergency =
        (rec.emergency_services ?? "").toLowerCase() === "yes";
      batch.push({
        cmsId: rec.facility_id,
        hospitalName: rec.facility_name,
        state: rec.state ?? "",
        latitude: null,
        longitude: null,
        specialties: inferSpecialties(rec),
        emergencyServices: hasEmergency,
        source: "cms",
        verified: true,
        osmId: null,
        updatedAt: new Date(),
      });
    }

    for (let i = 0; i < batch.length; i += BATCH_SIZE) {
      const chunk = batch.slice(i, i + BATCH_SIZE);
      if (!chunk.length) continue;
      await db
        .insert(hospitalSpecialties)
        .values(chunk)
        .onConflictDoUpdate({
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

    console.log(
      `  Offset ${offset + records.length}: ${seenIds.size} unique facilities...`
    );

    offset += records.length;
    if (records.length < PAGE_SIZE) break;
  }

  console.log(`  [Phase 1 done] Upserted ${imported}, skipped ${skipped}`);
  return { imported, skipped };
}

// ─── Phase 2: OSM Matching Pass ─────────────────────────────────────────────

interface OsmHospital {
  osmId: string;
  name: string;
  state: string | null;
  lat: number;
  lon: number;
}

async function queryOverpass(
  endpoint: string,
  query: string
): Promise<OverpassElement[]> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`Overpass ${res.status} from ${endpoint}`);
  const json = (await res.json()) as OverpassResponse;
  return json.elements ?? [];
}

function elementsToHospitals(elements: OverpassElement[]): OsmHospital[] {
  const hospitals: OsmHospital[] = [];
  for (const el of elements) {
    const name = el.tags?.name;
    if (!name) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat === undefined || lon === undefined) continue;
    hospitals.push({
      osmId: `${el.type}/${el.id}`,
      name,
      state: el.tags?.["addr:state"] ?? null,
      lat,
      lon,
    });
  }
  return hospitals;
}

async function queryOverpassWithBackoff(
  query: string,
  label: string
): Promise<OverpassElement[]> {
  const BACKOFF_DELAYS = [0, 15000, 30000];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < BACKOFF_DELAYS.length; attempt++) {
      if (BACKOFF_DELAYS[attempt] > 0) {
        console.log(
          `  [${label}] Retrying ${endpoint} in ${BACKOFF_DELAYS[attempt] / 1000}s...`
        );
        await new Promise((r) => setTimeout(r, BACKOFF_DELAYS[attempt]));
      }
      try {
        console.log(`  [${label}] → ${endpoint}`);
        return await queryOverpass(endpoint, query);
      } catch (err) {
        const msg = (err as Error).message;
        const is429 = msg.includes("429");
        if (!is429 || attempt === BACKOFF_DELAYS.length - 1) {
          console.warn(`  [${label}] Failed: ${msg}`);
          break;
        }
      }
    }
  }
  return [];
}

/**
 * For each OSM hospital, find the best-matching CMS record by name similarity.
 * Matching is constrained to the same US state when addr:state is available.
 * Threshold: name score >= 0.55 to accept a match.
 *
 * Returns a map of cmsId → osmId for confirmed matches.
 */
function matchOsmToCmsRecords(
  osmHospitals: OsmHospital[],
  cmsByState: Map<string, Array<{ cmsId: string; name: string }>>,
  alreadyMatchedCmsIds: Set<string> = new Set()
): Map<string, string> {
  const NAME_THRESHOLD = 0.55;
  const cmsIdToOsmId = new Map<string, string>();
  const usedOsmIds = new Set<string>();

  for (const osm of osmHospitals) {
    if (usedOsmIds.has(osm.osmId)) continue;

    let candidates = osm.state ? (cmsByState.get(osm.state.toUpperCase()) ?? []) : [];
    if (candidates.length === 0) {
      const all: typeof candidates = [];
      for (const list of cmsByState.values()) all.push(...list);
      candidates = all;
    }

    let bestScore = 0;
    let bestCmsId: string | null = null;

    for (const cms of candidates) {
      if (alreadyMatchedCmsIds.has(cms.cmsId) || cmsIdToOsmId.has(cms.cmsId)) continue;
      const ns = nameScore(osm.name, cms.name);
      if (ns > bestScore && ns >= NAME_THRESHOLD) {
        bestScore = ns;
        bestCmsId = cms.cmsId;
      }
    }

    if (bestCmsId) {
      cmsIdToOsmId.set(bestCmsId, osm.osmId);
      usedOsmIds.add(osm.osmId);
    }
  }

  return cmsIdToOsmId;
}

async function writeMatches(
  matches: Map<string, string>
): Promise<number> {
  const entries = Array.from(matches.entries());
  for (const [cmsId, osmId] of entries) {
    await db
      .update(hospitalSpecialties)
      .set({ osmId, updatedAt: new Date() })
      .where(eq(hospitalSpecialties.cmsId, cmsId));
  }
  return entries.length;
}

async function runOsmMatchingPass(): Promise<{
  matched: number;
  unmatched: number;
}> {
  console.log("\n[Phase 2] Starting OSM matching pass...");

  const allCms = await db
    .select({
      cmsId: hospitalSpecialties.cmsId,
      hospitalName: hospitalSpecialties.hospitalName,
      state: hospitalSpecialties.state,
    })
    .from(hospitalSpecialties);

  const cmsByState = new Map<string, Array<{ cmsId: string; name: string }>>();
  for (const row of allCms) {
    const st = (row.state ?? "").toUpperCase();
    if (!cmsByState.has(st)) cmsByState.set(st, []);
    cmsByState.get(st)!.push({ cmsId: row.cmsId, name: row.hospitalName });
  }

  const matchedCmsIds = new Set<string>();
  const seenOsmIds = new Set<string>();
  let totalWritten = 0;

  const REGION_LABELS = ["Northeast", "Southeast", "Midwest", "West"];
  const INTER_REGION_DELAY = 12000;

  for (let rIdx = 0; rIdx < US_REGIONS.length; rIdx++) {
    const regionLabel = REGION_LABELS[rIdx];
    const query = buildOverpassQuery(US_REGIONS[rIdx]);
    const elements = await queryOverpassWithBackoff(query, regionLabel);

    const osmHospitals: OsmHospital[] = [];
    for (const h of elementsToHospitals(elements)) {
      if (!seenOsmIds.has(h.osmId)) {
        seenOsmIds.add(h.osmId);
        osmHospitals.push(h);
      }
    }
    console.log(`  [${regionLabel}] ${osmHospitals.length} new OSM hospitals`);

    const regionMatches = matchOsmToCmsRecords(
      osmHospitals,
      cmsByState,
      matchedCmsIds
    );
    const written = await writeMatches(regionMatches);
    for (const cmsId of regionMatches.keys()) matchedCmsIds.add(cmsId);
    totalWritten += written;

    console.log(
      `  [${regionLabel}] Wrote ${written} osmId links (running total: ${totalWritten})`
    );

    if (rIdx < US_REGIONS.length - 1) {
      console.log(`  Pausing ${INTER_REGION_DELAY / 1000}s before next region...`);
      await new Promise((r) => setTimeout(r, INTER_REGION_DELAY));
    }
  }

  const matched = totalWritten;
  const unmatched = allCms.length - matched;
  console.log(
    `  [Phase 2 done] Wrote osmId for ${matched} CMS records; ${unmatched} remain unmatched`
  );
  return { matched, unmatched };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function run() {
  const { imported, skipped } = await importCms();
  const { matched, unmatched } = await runOsmMatchingPass();

  await pool.end();

  console.log("\n=== Import Summary ===");
  console.log(`  CMS records upserted  : ${imported}`);
  console.log(`  CMS records skipped   : ${skipped}`);
  console.log(`  OSM matches written   : ${matched}`);
  console.log(`  Unmatched (no osmId)  : ${unmatched}`);
}

run().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});

// ─── Exported types & helpers for Task 2 API endpoint ───────────────────────

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
 * Runtime helper for Task 2: given a list of OSM hospitals visible on screen
 * (from Overpass) and a list of CMS candidates pre-filtered to the user's state,
 * returns a Map<osmId, CmsCandidate> for confirmed matches.
 *
 * Matching strategy:
 *  - With coordinates (CMS lat/lon present): distance ≤ 500m + nameScore > 0.35
 *  - Without coordinates (most CMS records): nameScore ≥ 0.55 alone
 */
export function matchOsmToCms(
  osmHospitals: OsmHospitalRef[],
  cmsCandidates: CmsCandidate[]
): Map<string, CmsCandidate> {
  const DIST_THRESHOLD = 500;
  const NAME_THRESHOLD_WITH_COORDS = 0.35;
  const NAME_THRESHOLD_WITHOUT_COORDS = 0.55;

  const result = new Map<string, CmsCandidate>();

  for (const osm of osmHospitals) {
    let bestScore = 0;
    let bestCandidate: CmsCandidate | null = null;

    for (const cms of cmsCandidates) {
      const ns = nameScore(osm.name, cms.hospitalName);
      let combined: number;

      if (cms.lat !== null && cms.lon !== null) {
        const dist = haversineMeters(osm.lat, osm.lon, cms.lat, cms.lon);
        if (dist > DIST_THRESHOLD || ns < NAME_THRESHOLD_WITH_COORDS) continue;
        combined = ns * 0.7 + (1 - dist / DIST_THRESHOLD) * 0.3;
      } else {
        if (ns < NAME_THRESHOLD_WITHOUT_COORDS) continue;
        combined = ns;
      }

      if (combined > bestScore) {
        bestScore = combined;
        bestCandidate = cms;
      }
    }

    if (bestCandidate) result.set(osm.osmId, bestCandidate);
  }

  return result;
}
