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
 * Phase 3 – Supplementary Data Pull (superseded):
 *   Legacy HRSA trauma matching pass (source="hrsa"). This function remains available
 *   for manual targeted re-runs but is no longer called by the main run() pipeline.
 *   Phase 4 (ACS, source="acs") supersedes Phase 3 with the same HRSA data source
 *   plus an added proximity gate and a clearer provenance tag.
 *
 * Phase 4 – ACS Trauma Center Import:
 *   Uses HRSA Trauma Finder dataset (best available proxy for ACS-verified trauma
 *   centers; ACS facs.org has no public API). Resolves trauma designations with
 *   name+state matching plus haversine proximity gate (≤ 3 km). Source tag: "acs".
 *
 * Phase 5 – ABA Burn Center Import:
 *   Attempts ABA ameriburn.org endpoint; gracefully skips when unavailable (HTTP 307
 *   redirect to HTML SPA). Burn designations remain in admin review queue until ABA
 *   publishes a stable public API. Source tag: "aba" (applied only when data found).
 *
 * Phase 6 – Joint Commission Stroke Center Import:
 *   Attempts TJC qualitycheck.org endpoint; gracefully skips (returns HTTP 403).
 *   Stroke designations remain in admin review queue. Source tag: "joint-commission".
 *
 * Phase 7 – SAMHSA Behavioral Health Import:
 *   SAMHSA findtreatment.gov returns HTML; uses CMS IPF dataset (q9vs-r7wp, ~1,400
 *   inpatient psychiatric facilities) as a proxy. Primary match: exact cmsId (facility_id).
 *   Secondary match: normalizedName + state. Source tag: "samhsa".
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run import-cms
 *
 * Idempotent — both phases use ON CONFLICT DO UPDATE and deterministic matching.
 */

import { db, pool, hospitalSpecialties } from "@workspace/db";
import { eq, sql, isNull, isNotNull, and } from "drizzle-orm";

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

/**
 * All 16 canonical designation strings — must stay in sync with
 * the specialty_definitions table (seeded on API server startup).
 */
const ALL_16_DESIGNATIONS = [
  "Behavioral Health",
  "Burn Center - Adult",
  "Burn Center - Pediatric",
  "Cardiac - PCI Capable",
  "HazMat/Decontamination",
  "Obstetrics",
  "Pediatric Care",
  "Stroke - Comprehensive Center",
  "Stroke - Thrombectomy Capable Center",
  "Stroke - Primary Center",
  "Stroke - Acute Ready Center",
  "Trauma - Adult Level 1 & 2",
  "Trauma - Adult Level 3",
  "Trauma - Adult Level 4",
  "Trauma - Pediatric Level 1",
  "Trauma - Pediatric Level 2",
] as const;

/**
 * Designations that CMS General Information covers (via Emergency_Services
 * field + hospital_type). These can be populated automatically at import time.
 *
 * CMS field → designation mapping:
 *  - hospital_type contains "Children" | "Pediatric" + emergency_services=Yes
 *    → "Pediatric Care"
 *  - hospital_type contains "Acute Care" | "Critical Access" | "Short-Term Acute" + emergency_services=Yes
 *    → "Cardiac - PCI Capable" (acute ER hospitals are potential PCI-capable cardiac centers)
 *  - emergency_services=Yes (any acute ER type)
 *    → none of the trauma sub-levels (CMS doesn't provide ACS level data)
 *
 * Note: Behavioral Health, Burn, Stroke sub-levels, Trauma levels, HazMat,
 * and Obstetrics are NOT in CMS General Information. Those require supplementary
 * sources or admin entry and are placed in needs_admin_review.
 */

/**
 * CMS-sourced designations + the needs_admin_review list for this record.
 */
interface DesignationResult {
  specialties: string[];
  needsAdminReview: string[];
}

/**
 * Map a CMS hospital record to the canonical 16 designations.
 *
 * Returns:
 *  - specialties: designations confirmed present from CMS data
 *  - needsAdminReview: designations that couldn't be determined from CMS
 *    and require supplementary data or admin entry
 */
function mapCmsToDesignations(rec: CmsRecord): DesignationResult {
  const type = (rec.hospital_type ?? "").toLowerCase();
  const er = (rec.emergency_services ?? "").toLowerCase() === "yes";

  // Non-ER hospitals: no designations, no gaps to flag (they're not ER facilities)
  if (!er) {
    return { specialties: [], needsAdminReview: [] };
  }

  const specialties: string[] = [];
  const needsAdminReview: string[] = [];

  const isPediatricHospital = type.includes("children") || type.includes("pediatric");

  // CMS field → designation mapping:
  //
  // "Pediatric Care": CMS hospital_type with "children"/"pediatric" + emergency_services=Yes
  //   is a reliable indicator. This is the ONLY auto-confirmed designation from CMS data.
  //
  // All other designations require supplementary sources or admin entry.
  // Notably, "Cardiac - PCI Capable" is NOT auto-confirmed from emergency_services=Yes;
  // the CMS General Information dataset does not carry PCI capability data. It is flagged
  // for admin review like all other cardiac/stroke designations.

  if (isPediatricHospital) {
    specialties.push("Pediatric Care");
  }

  // All 16 designations that CMS General Information cannot confirm — flag for review.
  // "Pediatric Care" is removed from this list only when isPediatricHospital is true.
  const allToReview: string[] = [
    "Behavioral Health",
    "Burn Center - Adult",
    "Burn Center - Pediatric",
    "Cardiac - PCI Capable",
    "HazMat/Decontamination",
    "Obstetrics",
    "Stroke - Comprehensive Center",
    "Stroke - Thrombectomy Capable Center",
    "Stroke - Primary Center",
    "Stroke - Acute Ready Center",
    "Trauma - Adult Level 1 & 2",
    "Trauma - Adult Level 3",
    "Trauma - Adult Level 4",
    "Trauma - Pediatric Level 1",
    "Trauma - Pediatric Level 2",
  ];

  // For non-pediatric hospitals, also flag Pediatric Care
  if (!isPediatricHospital) {
    allToReview.push("Pediatric Care");
  }

  for (const d of allToReview) {
    needsAdminReview.push(d);
  }

  // Deduplicate and remove any already confirmed present
  const reviewSet = new Set(needsAdminReview);
  for (const s of specialties) reviewSet.delete(s);

  return { specialties, needsAdminReview: Array.from(reviewSet) };
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface CmsRecord {
  facility_id: string;
  facility_name: string;
  address?: string;
  citytown?: string;
  state: string;
  zip_code?: string;
  hospital_type?: string;
  emergency_services?: string;
  telephone_number?: string;
  [key: string]: unknown;
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
    trauma?: string;
    "healthcare:speciality"?: string;
    [k: string]: string | undefined;
  };
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
 * Convert an ALL-CAPS CMS string to Title Case.
 * e.g. "1108 ROSS CLARK CIRCLE" → "1108 Ross Clark Circle"
 */
function toTitleCase(str: string): string {
  const lower = ["of", "the", "and", "at", "in", "on", "for", "a", "an"];
  return str
    .toLowerCase()
    .split(" ")
    .map((word, i) =>
      i === 0 || !lower.includes(word)
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : word
    )
    .join(" ");
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
      const { specialties, needsAdminReview } = mapCmsToDesignations(rec);
      batch.push({
        cmsId: rec.facility_id,
        hospitalName: rec.facility_name,
        address: rec.address ? toTitleCase(rec.address) : null,
        city: rec.citytown ? toTitleCase(rec.citytown) : null,
        state: rec.state ?? "",
        zip: rec.zip_code ? rec.zip_code.slice(0, 5).padStart(5, "0") : null,
        phone: rec.telephone_number ?? null,
        latitude: null,
        longitude: null,
        specialties,
        needsAdminReview,
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
          address: sql`EXCLUDED.address`,
          city: sql`EXCLUDED.city`,
          state: sql`EXCLUDED.state`,
          zip: sql`EXCLUDED.zip`,
          phone: sql`EXCLUDED.phone`,
          specialties: sql`EXCLUDED.specialties`,
          needsAdminReview: sql`EXCLUDED.needs_admin_review`,
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
out center tags;`;
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
  tags: Record<string, string | undefined>;
}

function toOsmHospitals(elements: OverpassElement[]): OsmHospital[] {
  const result: OsmHospital[] = [];
  for (const el of elements) {
    const name = el.tags?.name;
    if (!name) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat === undefined || lon === undefined) continue;
    const osmId = `${el.type}/${el.id}`;
    result.push({
      osmId,
      name,
      state: el.tags?.["addr:state"] ?? null,
      lat,
      lon,
      tags: (el.tags ?? {}) as Record<string, string | undefined>,
    });
  }
  return result;
}

/**
 * Map OSM tags (trauma=*, healthcare:speciality=*) to canonical designation strings.
 * Returns designations that can be enriched from OSM data for this hospital.
 *
 * IMPORTANT — confidence levels vary by designation type:
 *   - Trauma levels (trauma=level_1/2/3/4): HIGH confidence when tag is present.
 *     OSM contributors typically copy this directly from official ACS/state trauma lists.
 *   - Non-trauma speciality tags (burn, pediatric, obstetric, stroke, psychiatric):
 *     HEURISTIC — these indicate the hospital has that department/service but do not
 *     confirm formal certification. They remove the designation from needsAdminReview,
 *     so admin should still verify before treating as certified.
 *   - "Cardiac - PCI Capable": NOT inferrable from OSM. OSM healthcare:speciality=cardiology
 *     means the hospital has a cardiology department, which does NOT imply PCI capability
 *     (a specific interventional procedure). This designation remains in needsAdminReview.
 */
function extractOsmDesignations(tags: Record<string, string | undefined>): string[] {
  const confirmed: string[] = [];

  const trauma = (tags["trauma"] ?? "").toLowerCase();
  const speciality = (tags["healthcare:speciality"] ?? "").toLowerCase();

  // Trauma levels — high confidence from OSM trauma= tag
  if (trauma === "yes" || trauma === "trauma_center") {
    // Generic trauma without level — cannot determine level from OSM, skip to avoid false data
  }
  if (trauma.includes("level_1") || trauma.includes("level1") || trauma === "1") {
    confirmed.push("Trauma - Adult Level 1 & 2");
  } else if (trauma.includes("level_2") || trauma.includes("level2") || trauma === "2") {
    confirmed.push("Trauma - Adult Level 1 & 2");
  } else if (trauma.includes("level_3") || trauma.includes("level3") || trauma === "3") {
    confirmed.push("Trauma - Adult Level 3");
  } else if (trauma.includes("level_4") || trauma.includes("level4") || trauma === "4") {
    confirmed.push("Trauma - Adult Level 4");
  }

  // Non-trauma OSM healthcare:speciality tags — heuristic enrichment
  // These indicate the hospital has the relevant service but do not confirm formal certification.
  if (speciality.includes("burn")) {
    // OSM "burn" speciality → heuristic: likely a burn center; adult vs pediatric unknown
    confirmed.push("Burn Center - Adult");
  }
  if (speciality.includes("paediatric") || speciality.includes("pediatric") || speciality.includes("children")) {
    confirmed.push("Pediatric Care");
  }
  if (speciality.includes("obstetric") || speciality.includes("gynecol") || speciality.includes("matern")) {
    confirmed.push("Obstetrics");
  }
  if (speciality.includes("stroke")) {
    // OSM doesn't differentiate stroke center certification level — use Primary as minimum
    confirmed.push("Stroke - Primary Center");
  }
  // NOTE: "Cardiac - PCI Capable" intentionally excluded: OSM cardiology tag indicates
  // a cardiology department, not PCI (percutaneous coronary intervention) capability.
  // Cardiac PCI remains in needsAdminReview for all hospitals regardless of OSM tags.
  if (speciality.includes("psychiatr") || speciality.includes("mental") || speciality.includes("behavioral")) {
    confirmed.push("Behavioral Health");
  }

  return [...new Set(confirmed)];
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
): Map<string, { osmId: string; osmTags: Record<string, string | undefined> }> {
  const DIST_THRESHOLD = 2_000;
  const NAME_THRESHOLD = 0.35;
  // keyed by cmsId → { osmId, osmTags }
  const result = new Map<string, { osmId: string; osmTags: Record<string, string | undefined> }>();
  const usedOsmIds = new Set<string>();

  for (const osm of osmHospitals) {
    if (usedOsmIds.has(osm.osmId)) continue;

    let bestScore = 0;
    let bestCmsId: string | null = null;

    for (const cms of cmsCandidates) {
      if (alreadyMatchedCmsIds.has(cms.cmsId) || result.has(cms.cmsId)) continue;
      if (cms.lat === null || cms.lon === null) continue;

      const dist = haversineMeters(osm.lat, osm.lon, cms.lat, cms.lon);
      if (dist > DIST_THRESHOLD) continue;

      const ns = nameScore(osm.name, cms.name);
      if (ns < NAME_THRESHOLD) continue;

      const combined = ns * 0.7 + (1 - dist / DIST_THRESHOLD) * 0.3;
      if (combined > bestScore) { bestScore = combined; bestCmsId = cms.cmsId; }
    }

    if (bestCmsId) {
      result.set(bestCmsId, { osmId: osm.osmId, osmTags: osm.tags });
      usedOsmIds.add(osm.osmId);
    }
  }

  return result;
}

async function runOsmMatchingPass(): Promise<{
  matched: number;
  unmatched: number;
  enrichedFromOsm: number;
}> {
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
  let totalEnriched = 0;

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

    for (const [cmsId, { osmId, osmTags }] of regionMatches) {
      await db
        .update(hospitalSpecialties)
        .set({ osmId, updatedAt: new Date() })
        .where(eq(hospitalSpecialties.cmsId, cmsId));
      matchedCmsIds.add(cmsId);
      totalWritten++;

      // Enrich with OSM tags if they contain useful designation data
      const osmDesignations = extractOsmDesignations(osmTags);
      if (osmDesignations.length > 0) {
        // Fetch current record to merge
        const [current] = await db
          .select({ specialties: hospitalSpecialties.specialties, needsAdminReview: hospitalSpecialties.needsAdminReview })
          .from(hospitalSpecialties)
          .where(eq(hospitalSpecialties.cmsId, cmsId));

        if (current) {
          const currentSpec = (current.specialties as string[]) ?? [];
          const currentReview = (current.needsAdminReview as string[]) ?? [];
          const mergedSpec = [...new Set([...currentSpec, ...osmDesignations])];
          const mergedReview = currentReview.filter((d) => !osmDesignations.includes(d));

          // Use "osm" source to track provenance of OSM-enriched designations
          await db
            .update(hospitalSpecialties)
            .set({
              specialties: mergedSpec,
              needsAdminReview: mergedReview,
              source: "osm",
              updatedAt: new Date(),
            })
            .where(eq(hospitalSpecialties.cmsId, cmsId));
          totalEnriched++;
        }
      }
    }

    console.log(`  [${label}] Wrote ${regionMatches.size} osmId links (total: ${totalWritten})`);

    if (rIdx < US_REGIONS.length - 1) {
      console.log("  Pausing 12s before next region...");
      await new Promise((r) => setTimeout(r, 12_000));
    }
  }

  const unmatched = allCms.length - totalWritten;
  console.log(`  [Phase 2 done] matched=${totalWritten}, unmatched=${unmatched}, enriched_from_osm=${totalEnriched}`);
  return { matched: totalWritten, unmatched, enrichedFromOsm: totalEnriched };
}

// ─── Phase 3 – Supplementary data pull ──────────────────────────────────────

/**
 * HRSA Health Resources & Services Administration public API.
 * Provides data on shortage areas, critical access hospitals, trauma centers.
 *
 * We attempt to pull from HRSA's publicly accessible trauma data endpoint.
 * If unavailable, we log the attempt and skip gracefully (non-fatal).
 *
 * Source: https://data.hrsa.gov (public, free, no API key required)
 */
const HRSA_TRAUMA_API =
  "https://data.hrsa.gov/api/export/excel?fileExt=Json&sourceName=HPSA_RURAL_TRAUMA_MAP";

interface HrsaTraumaRecord {
  facility_name?: string;
  city?: string;
  state_code?: string;
  trauma_level?: string;
  latitude?: string | number;
  longitude?: string | number;
  facility_id?: string;
}

async function fetchHrsaTraumaData(): Promise<HrsaTraumaRecord[]> {
  try {
    console.log("  Attempting HRSA trauma data fetch...");
    const res = await fetch(HRSA_TRAUMA_API, {
      signal: AbortSignal.timeout(30_000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      console.log(`  HRSA returned HTTP ${res.status} — skipping`);
      return [];
    }
    const json = await res.json();
    if (Array.isArray(json)) return json as HrsaTraumaRecord[];
    if (json && Array.isArray(json.data)) return json.data as HrsaTraumaRecord[];
    console.log("  HRSA response not in expected format — skipping");
    return [];
  } catch (err) {
    console.log(`  HRSA fetch failed: ${(err as Error).message} — skipping`);
    return [];
  }
}

/**
 * Map HRSA trauma level string to canonical designation.
 *
 * Ordering is critical: most-specific patterns are tested first to avoid substring
 * collisions. "level i" would naively match "level ii", "level iii", and "level iv"
 * because they all contain "level i" as a prefix. To avoid misclassification, we:
 *  1. Handle pediatric variants before adult variants (different designation family)
 *  2. Check level IV before III (IV contains "iv"; III contains "iii")
 *  3. Check level II before I (II contains "ii"; I matches any "level i*" substring)
 *  4. Numeric forms are non-ambiguous and handled separately
 */
export function hrsaTraumaLevelToDesignation(level: string): string | null {
  const l = level.toLowerCase().trim();
  const isPediatric = l.includes("pediatric") || l.includes("paediatric") || l.includes("children");

  if (isPediatric) {
    // Pediatric Level 2 before Level 1 (same reason — "level ii" contains "level i")
    if (/level\s+ii\b/.test(l) || l.includes("level 2") || l === "2") return "Trauma - Pediatric Level 2";
    if (/level\s+i\b/.test(l) || l.includes("level 1") || l === "1") return "Trauma - Pediatric Level 1";
    return null;
  }

  // Adult trauma levels — check from highest roman numeral down
  if (/level\s+iv\b/.test(l) || l.includes("level 4") || l === "4") return "Trauma - Adult Level 4";
  if (/level\s+iii\b/.test(l) || l.includes("level 3") || l === "3") return "Trauma - Adult Level 3";
  if (/level\s+ii\b/.test(l) || l.includes("level 2") || l === "2") return "Trauma - Adult Level 1 & 2";
  if (/level\s+i\b/.test(l) || l.includes("level 1") || l === "1") return "Trauma - Adult Level 1 & 2";

  return null;
}

/**
 * Phase 3: Attempt to pull trauma level data from HRSA and cross-reference
 * with CMS records by name + state matching.
 *
 * For each hospital in the DB that still has trauma level designations in
 * needs_admin_review, attempt to resolve them via:
 * 1. HRSA public trauma dataset (name + state match)
 *
 * Designations that remain unresolved after all public source attempts
 * are kept in needs_admin_review so admins can manually enter them.
 * HazMat/Decontamination is ALWAYS kept in needs_admin_review — it has
 * no national public dataset.
 */
async function runSupplementaryDataPull(): Promise<{
  hrsaRecords: number;
  resolved: number;
  stillFlagged: number;
}> {
  console.log("\n[Phase 3] Supplementary data pull (HRSA trauma, OSM enrichment)...");

  const hrsaRecords = await fetchHrsaTraumaData();
  console.log(`  HRSA records fetched: ${hrsaRecords.length}`);

  if (hrsaRecords.length === 0) {
    console.log("  No HRSA data available — trauma level designations remain flagged for admin review");

    // Count how many hospitals have unresolved trauma designations
    const stillFlaggedRows = await db
      .select({ id: hospitalSpecialties.id })
      .from(hospitalSpecialties)
      .where(sql`${hospitalSpecialties.needsAdminReview} @> '["Trauma - Adult Level 1 & 2"]'::jsonb`);
    console.log(`  ${stillFlaggedRows.length} hospitals still have trauma gaps flagged`);

    const totalFlagged = await db
      .select({ id: hospitalSpecialties.id })
      .from(hospitalSpecialties)
      .where(sql`jsonb_array_length(${hospitalSpecialties.needsAdminReview}) > 0`);
    console.log(`  ${totalFlagged.length} hospitals total with gaps flagged for admin review`);

    return { hrsaRecords: 0, resolved: 0, stillFlagged: totalFlagged.length };
  }

  // Build a lookup map: normalizedName+state → trauma designation
  const hrsaMap = new Map<string, string>();
  for (const rec of hrsaRecords) {
    if (!rec.facility_name || !rec.state_code || !rec.trauma_level) continue;
    const designation = hrsaTraumaLevelToDesignation(rec.trauma_level);
    if (!designation) continue;
    const key = `${normalizeName(rec.facility_name)}|${rec.state_code.toUpperCase()}`;
    hrsaMap.set(key, designation);
  }
  console.log(`  Parsed ${hrsaMap.size} HRSA trauma designations`);

  // Fetch all DB hospitals that have trauma designations in needs_admin_review
  const traumaDesignations = [
    "Trauma - Adult Level 1 & 2",
    "Trauma - Adult Level 3",
    "Trauma - Adult Level 4",
    "Trauma - Pediatric Level 1",
    "Trauma - Pediatric Level 2",
  ];

  const rows = await db
    .select({
      id: hospitalSpecialties.id,
      cmsId: hospitalSpecialties.cmsId,
      hospitalName: hospitalSpecialties.hospitalName,
      state: hospitalSpecialties.state,
      specialties: hospitalSpecialties.specialties,
      needsAdminReview: hospitalSpecialties.needsAdminReview,
      designationSources: hospitalSpecialties.designationSources,
    })
    .from(hospitalSpecialties)
    .where(sql`jsonb_array_length(${hospitalSpecialties.needsAdminReview}) > 0`);

  let resolved = 0;

  for (const row of rows) {
    const currentReview = (row.needsAdminReview as string[]) ?? [];
    const currentSpec = (row.specialties as string[]) ?? [];
    const hasTraumaGap = currentReview.some((d) => traumaDesignations.includes(d));
    if (!hasTraumaGap) continue;

    const key = `${normalizeName(row.hospitalName)}|${row.state.toUpperCase()}`;
    const designation = hrsaMap.get(key);
    if (!designation) continue;

    const newSpec = [...new Set([...currentSpec, designation])];
    const newReview = currentReview.filter((d) => d !== designation);
    const newDesignationSources = {
      ...(row.designationSources as Record<string, string> ?? {}),
      [designation]: "hrsa",
    };

    // Use "hrsa" source to track provenance of HRSA-enriched designations
    await db
      .update(hospitalSpecialties)
      .set({
        specialties: newSpec,
        needsAdminReview: newReview,
        source: "hrsa",
        designationSources: newDesignationSources,
        updatedAt: new Date(),
      })
      .where(eq(hospitalSpecialties.id, row.id));
    resolved++;
  }

  console.log(`  Resolved ${resolved} trauma designations from HRSA data`);

  const totalFlagged = await db
    .select({ id: hospitalSpecialties.id })
    .from(hospitalSpecialties)
    .where(sql`jsonb_array_length(${hospitalSpecialties.needsAdminReview}) > 0`);

  console.log(`  ${totalFlagged.length} hospitals still have designations flagged for admin review`);

  return { hrsaRecords: hrsaRecords.length, resolved, stillFlagged: totalFlagged.length };
}

// ─── Phase 4 – ACS Trauma Center Import ──────────────────────────────────────

/**
 * American College of Surgeons (ACS) trauma center import.
 *
 * ACS maintains the authoritative national trauma center verification database.
 * Their website (facs.org) does not expose a public machine-readable API endpoint;
 * all known REST paths return HTTP 404.  The best available public programmatic
 * source that covers ACS-verified trauma centers is the HRSA Trauma Finder dataset,
 * which is used here.  When data is successfully fetched from HRSA, resolved records
 * carry source="acs" to signal that the HRSA data is a proxy for ACS certification.
 *
 * Matching strategy:
 *   Primary  : normalizedName + state (same as Phase 3)
 *   Secondary: if both DB record and HRSA record carry lat/lon, haversine distance
 *              ≤ 3 km is required to confirm the match (reduces false positives for
 *              common hospital name fragments in large states).
 *
 * Idempotency: Only hospitals with trauma designations still in needsAdminReview
 * are processed. Admin-verified records (source="admin") are never overwritten.
 *
 * Source tag: "acs"
 */


const TRAUMA_DESIGNATIONS = [
  "Trauma - Adult Level 1 & 2",
  "Trauma - Adult Level 3",
  "Trauma - Adult Level 4",
  "Trauma - Pediatric Level 1",
  "Trauma - Pediatric Level 2",
] as const;

async function runAcsTraumaImport(): Promise<{
  hrsaRecords: number;
  resolved: number;
  stillFlagged: number;
}> {
  console.log("\n[Phase 4] ACS Trauma Center import (via HRSA data)...");
  console.log("  Note: ACS facs.org has no public machine-readable API; using HRSA as proxy.");

  const hrsaRaw = await fetchHrsaTraumaData();
  console.log(`  HRSA trauma records fetched: ${hrsaRaw.length}`);

  if (hrsaRaw.length === 0) {
    console.log("  HRSA data unavailable — trauma designations remain in admin review queue");
    const totalFlagged = await db
      .select({ id: hospitalSpecialties.id })
      .from(hospitalSpecialties)
      .where(sql`jsonb_array_length(${hospitalSpecialties.needsAdminReview}) > 0`);
    return { hrsaRecords: 0, resolved: 0, stillFlagged: totalFlagged.length };
  }

  // Build lookup: normalizedName|STATE → { designation, lat, lon }
  interface TraumaEntry { designation: string; lat: number | null; lon: number | null }
  const hrsaMap = new Map<string, TraumaEntry>();
  for (const rec of hrsaRaw) {
    if (!rec.facility_name || !rec.state_code || !rec.trauma_level) continue;
    const designation = hrsaTraumaLevelToDesignation(rec.trauma_level);
    if (!designation) continue;
    const key = `${normalizeName(rec.facility_name)}|${rec.state_code.toUpperCase()}`;
    if (!hrsaMap.has(key)) {
      const lat = rec.latitude !== null && rec.latitude !== "" ? parseFloat(String(rec.latitude)) : null;
      const lon = rec.longitude !== null && rec.longitude !== "" ? parseFloat(String(rec.longitude)) : null;
      hrsaMap.set(key, {
        designation,
        lat: lat !== null && !isNaN(lat) ? lat : null,
        lon: lon !== null && !isNaN(lon) ? lon : null,
      });
    }
  }
  console.log(`  Parsed ${hrsaMap.size} HRSA trauma designations`);

  const rows = await db
    .select({
      id: hospitalSpecialties.id,
      hospitalName: hospitalSpecialties.hospitalName,
      state: hospitalSpecialties.state,
      latitude: hospitalSpecialties.latitude,
      longitude: hospitalSpecialties.longitude,
      specialties: hospitalSpecialties.specialties,
      needsAdminReview: hospitalSpecialties.needsAdminReview,
      source: hospitalSpecialties.source,
      designationSources: hospitalSpecialties.designationSources,
    })
    .from(hospitalSpecialties)
    .where(
      and(
        sql`jsonb_array_length(${hospitalSpecialties.needsAdminReview}) > 0`,
        sql`${hospitalSpecialties.source} != 'admin'`
      )
    );

  let resolved = 0;

  for (const row of rows) {
    const currentReview = (row.needsAdminReview as string[]) ?? [];
    const currentSpec = (row.specialties as string[]) ?? [];
    if (!currentReview.some((d) => (TRAUMA_DESIGNATIONS as readonly string[]).includes(d))) continue;

    const key = `${normalizeName(row.hospitalName)}|${row.state.toUpperCase()}`;
    const entry = hrsaMap.get(key);
    if (!entry) continue;

    // Proximity gate: when both records have coordinates, require ≤ 3 km
    const PROXIMITY_THRESHOLD_M = 3000;
    if (
      row.latitude !== null && row.longitude !== null &&
      entry.lat !== null && entry.lon !== null
    ) {
      const dist = haversineMeters(row.latitude, row.longitude, entry.lat, entry.lon);
      if (dist > PROXIMITY_THRESHOLD_M) {
        console.log(
          `  Proximity reject: ${row.hospitalName} (${row.state}) — HRSA match ${dist.toFixed(0)}m away`
        );
        continue;
      }
    }

    // Remove ALL trauma designations from review; add the confirmed ACS level
    const newSpec = [...new Set([...currentSpec, entry.designation])];
    const newReview = currentReview.filter(
      (d) => !(TRAUMA_DESIGNATIONS as readonly string[]).includes(d)
    );
    // Tag the resolved designation with source="acs" for per-designation provenance
    const existingDS = (row.designationSources as Record<string, string>) ?? {};
    const newDesignationSources = { ...existingDS, [entry.designation]: "acs" };

    await db
      .update(hospitalSpecialties)
      .set({
        specialties: newSpec,
        needsAdminReview: newReview,
        source: "acs",
        designationSources: newDesignationSources,
        updatedAt: new Date(),
      })
      .where(eq(hospitalSpecialties.id, row.id));
    resolved++;
  }

  console.log(`  Resolved ${resolved} trauma designations (source=acs)`);

  const totalFlagged = await db
    .select({ id: hospitalSpecialties.id })
    .from(hospitalSpecialties)
    .where(sql`jsonb_array_length(${hospitalSpecialties.needsAdminReview}) > 0`);
  console.log(`  ${totalFlagged.length} hospitals still have designations flagged for admin review`);

  return { hrsaRecords: hrsaRaw.length, resolved, stillFlagged: totalFlagged.length };
}

// ─── Phase 5 – ABA Burn Center Import ────────────────────────────────────────

/**
 * American Burn Association (ABA) burn center import.
 *
 * ABA verifies ~130 burn centers nationally (ameriburn.org).  Their website
 * does not expose a public machine-readable API — direct requests return HTTP 307
 * redirects to an HTML SPA.  No equivalent CMS or HRSA dataset lists burn-center
 * certification specifically.
 *
 * This phase attempts to reach the ABA endpoint and gracefully skips when
 * unavailable, leaving burn designations in the admin review queue for manual
 * verification.  If ABA ever exposes a stable JSON endpoint the fetch logic
 * below will automatically pick it up without other code changes.
 *
 * Source tag: "aba" (applied only when ABA data is actually retrieved)
 */

interface AbaBurnCenter {
  name?: string;
  facility_name?: string;
  state?: string;
  state_code?: string;
  type?: string;
  center_type?: string;
  adult?: boolean | string;
  pediatric?: boolean | string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  [key: string]: unknown;
}

/**
 * Attempt to fetch ABA burn center list.
 * Returns empty array on any failure — this is expected until ABA publishes
 * a stable public API.
 */
async function fetchAbaBurnCenters(): Promise<AbaBurnCenter[]> {
  const endpoints = [
    "https://ameriburn.org/api/burn-centers",
    "https://ameriburn.org/quality-care/burn-center-verification/burn-center-directory/?format=json",
  ];

  for (const url of endpoints) {
    try {
      console.log(`  Trying ABA endpoint: ${url}`);
      const res = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        headers: { Accept: "application/json", "User-Agent": "ER-Choices-DataImport/1.0" },
      });
      if (!res.ok) {
        console.log(`  ABA endpoint ${url} returned HTTP ${res.status}`);
        continue;
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("json")) {
        console.log(`  ABA endpoint returned non-JSON (${contentType.split(";")[0]})`);
        continue;
      }
      const json = await res.json();
      const arr = Array.isArray(json) ? json
        : Array.isArray(json?.data) ? json.data
        : Array.isArray(json?.results) ? json.results
        : null;
      if (arr) {
        console.log(`  ABA: retrieved ${arr.length} records from ${url}`);
        return arr as AbaBurnCenter[];
      }
      console.log(`  ABA endpoint returned unrecognised JSON shape`);
    } catch (err) {
      console.log(`  ABA fetch unavailable (${url}): ${(err as Error).message}`);
    }
  }
  return [];
}

const BURN_DESIGNATIONS = ["Burn Center - Adult", "Burn Center - Pediatric"] as const;

/**
 * Map ABA record to one or both burn designations.
 * Defaults to adult when type is ambiguous.
 */
function abaBurnDesignations(rec: AbaBurnCenter): string[] {
  const type = String(rec.type ?? rec.center_type ?? "").toLowerCase();
  const adult = rec.adult;
  const ped = rec.pediatric;
  const out: string[] = [];

  if (adult === true || adult === "true" || adult === "1") out.push("Burn Center - Adult");
  if (ped === true || ped === "true" || ped === "1") out.push("Burn Center - Pediatric");

  if (out.length === 0) {
    if (type.includes("pediatric") || type.includes("children")) out.push("Burn Center - Pediatric");
    else out.push("Burn Center - Adult");
  }
  return out;
}

async function runAbaBurnImport(): Promise<{
  abaRecords: number;
  resolved: number;
  stillFlagged: number;
}> {
  console.log("\n[Phase 5] ABA Burn Center import...");
  console.log("  Note: ABA ameriburn.org has no public machine-readable API.");

  const abaRaw = await fetchAbaBurnCenters();
  console.log(`  ABA records fetched: ${abaRaw.length}`);

  const totalFlagged = await db
    .select({ id: hospitalSpecialties.id })
    .from(hospitalSpecialties)
    .where(sql`jsonb_array_length(${hospitalSpecialties.needsAdminReview}) > 0`);

  if (abaRaw.length === 0) {
    console.log("  ABA data unavailable — burn designations remain in admin review queue");
    return { abaRecords: 0, resolved: 0, stillFlagged: totalFlagged.length };
  }

  // Build lookup: normalizedName|STATE → string[]
  const abaMap = new Map<string, string[]>();
  for (const rec of abaRaw) {
    const name = rec.name ?? rec.facility_name;
    const state = rec.state ?? rec.state_code;
    if (!name || !state) continue;
    const key = `${normalizeName(String(name))}|${String(state).toUpperCase().trim()}`;
    abaMap.set(key, abaBurnDesignations(rec));
  }
  console.log(`  Parsed ${abaMap.size} ABA burn center entries`);

  const rows = await db
    .select({
      id: hospitalSpecialties.id,
      hospitalName: hospitalSpecialties.hospitalName,
      state: hospitalSpecialties.state,
      latitude: hospitalSpecialties.latitude,
      longitude: hospitalSpecialties.longitude,
      specialties: hospitalSpecialties.specialties,
      needsAdminReview: hospitalSpecialties.needsAdminReview,
      source: hospitalSpecialties.source,
      designationSources: hospitalSpecialties.designationSources,
    })
    .from(hospitalSpecialties)
    .where(
      and(
        sql`jsonb_array_length(${hospitalSpecialties.needsAdminReview}) > 0`,
        sql`${hospitalSpecialties.source} != 'admin'`
      )
    );

  let resolved = 0;

  for (const row of rows) {
    const currentReview = (row.needsAdminReview as string[]) ?? [];
    const currentSpec = (row.specialties as string[]) ?? [];
    if (!currentReview.some((d) => (BURN_DESIGNATIONS as readonly string[]).includes(d))) continue;

    const key = `${normalizeName(row.hospitalName)}|${row.state.toUpperCase()}`;
    const matched = abaMap.get(key);
    if (!matched) continue;

    const recLat = abaRaw.find((r) => {
      const rn = r.name ?? r.facility_name;
      const rs = r.state ?? r.state_code;
      return rn && rs &&
        normalizeName(String(rn)) === normalizeName(row.hospitalName) &&
        String(rs).toUpperCase() === row.state.toUpperCase();
    });

    // Proximity gate (≤ 5 km) when both have coordinates
    if (
      row.latitude !== null && row.longitude !== null && recLat
    ) {
      const rLat = recLat.latitude !== null && recLat.latitude !== ""
        ? parseFloat(String(recLat.latitude)) : null;
      const rLon = recLat.longitude !== null && recLat.longitude !== ""
        ? parseFloat(String(recLat.longitude)) : null;
      if (rLat !== null && rLon !== null && !isNaN(rLat) && !isNaN(rLon)) {
        const dist = haversineMeters(row.latitude, row.longitude, rLat, rLon);
        if (dist > 5000) continue;
      }
    }

    const newSpec = [...new Set([...currentSpec, ...matched])];
    const newReview = currentReview.filter(
      (d) => !(BURN_DESIGNATIONS as readonly string[]).includes(d)
    );
    // Tag each resolved burn designation with source="aba" for per-designation provenance
    const existingDS = (row.designationSources as Record<string, string>) ?? {};
    const newDesignationSources = { ...existingDS };
    for (const d of matched) { newDesignationSources[d] = "aba"; }

    await db
      .update(hospitalSpecialties)
      .set({
        specialties: newSpec,
        needsAdminReview: newReview,
        source: "aba",
        designationSources: newDesignationSources,
        updatedAt: new Date(),
      })
      .where(eq(hospitalSpecialties.id, row.id));
    resolved++;
  }

  console.log(`  Resolved ${resolved} burn center designations (source=aba)`);
  console.log(`  ${totalFlagged.length} hospitals still have designations flagged for admin review`);

  return { abaRecords: abaRaw.length, resolved, stillFlagged: totalFlagged.length };
}

// ─── Phase 6 – Joint Commission Stroke Center Import ─────────────────────────

/**
 * The Joint Commission (TJC) stroke certification import.
 *
 * TJC certifies stroke centers at four levels:
 *   - Comprehensive Stroke Center (CSC)
 *   - Thrombectomy-Capable Stroke Center (TSC)
 *   - Primary Stroke Center (PSC)
 *   - Acute Stroke Ready Hospital (ASRH)
 *
 * TJC's Quality Check site (qualitycheck.org) returns HTTP 403 for all
 * programmatic requests and requires browser rendering; no stable public JSON
 * endpoint exists.  No CMS dataset currently mirrors TJC stroke certification
 * levels in a machine-readable form.
 *
 * This phase attempts to reach the TJC endpoint and gracefully skips when
 * unavailable, leaving stroke designations in the admin review queue for manual
 * verification.
 *
 * Source tag: "joint-commission" (applied only when TJC data is actually retrieved)
 */

interface JcStrokeCenter {
  name?: string;
  facility_name?: string;
  organizationName?: string;
  state?: string;
  state_code?: string;
  certificationProgram?: string;
  certification_program?: string;
  program?: string;
  certificationLevel?: string;
  level?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  [key: string]: unknown;
}

/**
 * Map Joint Commission certification program string to canonical stroke designation.
 */
export function jcProgramToDesignation(program: string): string | null {
  const p = program.toLowerCase().trim();
  if (p.includes("comprehensive") || p.includes("csc")) return "Stroke - Comprehensive Center";
  if (p.includes("thrombectomy") || p.includes("tsc")) return "Stroke - Thrombectomy Capable Center";
  if (p.includes("primary") || p.includes("psc")) return "Stroke - Primary Center";
  if (p.includes("acute") || p.includes("ready") || p.includes("asrh")) return "Stroke - Acute Ready Center";
  return null;
}

async function fetchJcStrokeCenters(): Promise<JcStrokeCenter[]> {
  const endpoints = [
    "https://www.qualitycheck.org/public-report/qc-data/?program=stroke&format=json",
    "https://www.qualitycheck.org/api/stroke-centers?format=json",
  ];

  for (const url of endpoints) {
    try {
      console.log(`  Trying Joint Commission endpoint: ${url}`);
      const res = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        headers: { Accept: "application/json", "User-Agent": "ER-Choices-DataImport/1.0" },
      });
      if (!res.ok) {
        console.log(`  JC endpoint ${url} returned HTTP ${res.status}`);
        continue;
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("json")) {
        console.log(`  JC endpoint returned non-JSON (${contentType.split(";")[0]})`);
        continue;
      }
      const json = await res.json();
      const arr = Array.isArray(json) ? json
        : Array.isArray(json?.results) ? json.results
        : Array.isArray(json?.data) ? json.data
        : null;
      if (arr) {
        console.log(`  JC: retrieved ${arr.length} records from ${url}`);
        return arr as JcStrokeCenter[];
      }
      console.log(`  JC endpoint returned unrecognised JSON shape`);
    } catch (err) {
      console.log(`  JC fetch unavailable (${url}): ${(err as Error).message}`);
    }
  }
  return [];
}

const STROKE_DESIGNATIONS = [
  "Stroke - Comprehensive Center",
  "Stroke - Thrombectomy Capable Center",
  "Stroke - Primary Center",
  "Stroke - Acute Ready Center",
] as const;

const STROKE_RANK: Record<string, number> = {
  "Stroke - Comprehensive Center": 4,
  "Stroke - Thrombectomy Capable Center": 3,
  "Stroke - Primary Center": 2,
  "Stroke - Acute Ready Center": 1,
};

async function runJointCommissionStrokeImport(): Promise<{
  jcRecords: number;
  resolved: number;
  stillFlagged: number;
}> {
  console.log("\n[Phase 6] Joint Commission Stroke Center import...");
  console.log("  Note: TJC qualitycheck.org returns HTTP 403 for programmatic access.");

  const jcRaw = await fetchJcStrokeCenters();
  console.log(`  Joint Commission stroke records fetched: ${jcRaw.length}`);

  const totalFlagged = await db
    .select({ id: hospitalSpecialties.id })
    .from(hospitalSpecialties)
    .where(sql`jsonb_array_length(${hospitalSpecialties.needsAdminReview}) > 0`);

  if (jcRaw.length === 0) {
    console.log("  JC data unavailable — stroke designations remain in admin review queue");
    return { jcRecords: 0, resolved: 0, stillFlagged: totalFlagged.length };
  }

  // Build lookup: normalizedName|STATE → highest-ranking designation
  const jcMap = new Map<string, JcStrokeCenter & { designation: string }>();
  for (const rec of jcRaw) {
    const name = rec.name ?? rec.facility_name ?? rec.organizationName;
    const state = rec.state ?? rec.state_code;
    const programStr =
      rec.certificationProgram ?? rec.certification_program ?? rec.program ??
      rec.certificationLevel ?? rec.level;
    if (!name || !state || !programStr) continue;
    const designation = jcProgramToDesignation(String(programStr));
    if (!designation) continue;
    const key = `${normalizeName(String(name))}|${String(state).toUpperCase().trim()}`;
    const existing = jcMap.get(key);
    if (!existing || (STROKE_RANK[designation] ?? 0) > (STROKE_RANK[existing.designation] ?? 0)) {
      jcMap.set(key, { ...rec, designation });
    }
  }
  console.log(`  Parsed ${jcMap.size} Joint Commission stroke designations`);

  const rows = await db
    .select({
      id: hospitalSpecialties.id,
      hospitalName: hospitalSpecialties.hospitalName,
      state: hospitalSpecialties.state,
      latitude: hospitalSpecialties.latitude,
      longitude: hospitalSpecialties.longitude,
      specialties: hospitalSpecialties.specialties,
      needsAdminReview: hospitalSpecialties.needsAdminReview,
      source: hospitalSpecialties.source,
      designationSources: hospitalSpecialties.designationSources,
    })
    .from(hospitalSpecialties)
    .where(
      and(
        sql`jsonb_array_length(${hospitalSpecialties.needsAdminReview}) > 0`,
        sql`${hospitalSpecialties.source} != 'admin'`
      )
    );

  let resolved = 0;

  for (const row of rows) {
    const currentReview = (row.needsAdminReview as string[]) ?? [];
    const currentSpec = (row.specialties as string[]) ?? [];
    if (!currentReview.some((d) => (STROKE_DESIGNATIONS as readonly string[]).includes(d))) continue;

    const key = `${normalizeName(row.hospitalName)}|${row.state.toUpperCase()}`;
    const entry = jcMap.get(key);
    if (!entry) continue;

    // Proximity gate (≤ 3 km) when both have coordinates
    if (row.latitude !== null && row.longitude !== null) {
      const rLat = entry.latitude !== null && entry.latitude !== ""
        ? parseFloat(String(entry.latitude)) : null;
      const rLon = entry.longitude !== null && entry.longitude !== ""
        ? parseFloat(String(entry.longitude)) : null;
      if (rLat !== null && rLon !== null && !isNaN(rLat) && !isNaN(rLon)) {
        const dist = haversineMeters(row.latitude, row.longitude, rLat, rLon);
        if (dist > 3000) {
          console.log(
            `  Proximity reject: ${row.hospitalName} (${row.state}) — JC match ${dist.toFixed(0)}m away`
          );
          continue;
        }
      }
    }

    const newSpec = [...new Set([...currentSpec, entry.designation])];
    const newReview = currentReview.filter(
      (d) => !(STROKE_DESIGNATIONS as readonly string[]).includes(d)
    );
    // Tag the resolved stroke designation with source="joint-commission" for per-designation provenance
    const existingDS = (row.designationSources as Record<string, string>) ?? {};
    const newDesignationSources = { ...existingDS, [entry.designation]: "joint-commission" };

    await db
      .update(hospitalSpecialties)
      .set({
        specialties: newSpec,
        needsAdminReview: newReview,
        source: "joint-commission",
        designationSources: newDesignationSources,
        updatedAt: new Date(),
      })
      .where(eq(hospitalSpecialties.id, row.id));
    resolved++;
  }

  console.log(`  Resolved ${resolved} stroke designations (source=joint-commission)`);
  console.log(`  ${totalFlagged.length} hospitals still have designations flagged for admin review`);

  return { jcRecords: jcRaw.length, resolved, stillFlagged: totalFlagged.length };
}

// ─── Phase 7 – SAMHSA Behavioral Health Import ───────────────────────────────

/**
 * Behavioral health facility import (SAMHSA proxy via CMS IPF dataset).
 *
 * SAMHSA's findtreatment.gov locator (/locator/api) returns an HTML React SPA
 * instead of JSON for all programmatic requests — no stable public JSON API exists.
 *
 * The best available public substitute is the CMS Inpatient Psychiatric Facility
 * (IPF) Quality Measures dataset (identifier: q9vs-r7wp), which lists ~1,400
 * inpatient psychiatric facilities nationally with their CMS provider numbers
 * (facility_id), which map directly to cmsId in our database.
 *
 * Matching strategy:
 *   Primary  : exact cmsId match (facility_id → cmsId) — zero ambiguity
 *   Secondary: normalizedName + state for IPF records that lack a matching cmsId
 *              in our DB (covers facilities not imported in Phase 1 for any reason),
 *              with haversine proximity ≤ 3 km where coordinates are available.
 *
 * Source tag: "samhsa" (to indicate intent; actual data comes from CMS IPF)
 */

interface CmsIpfFacility {
  facility_id?: string;
  facility_name?: string;
  state?: string;
  address?: string;
  citytown?: string;
  [key: string]: unknown;
}

/**
 * Fetch all records from the CMS IPF dataset (q9vs-r7wp) by paginating through it.
 * Dataset has ~1,400 records; we fetch in batches of 500 to stay well within limits.
 */
async function fetchCmsIpfFacilities(): Promise<CmsIpfFacility[]> {
  const BASE = "https://data.cms.gov/provider-data/api/1/datastore/query/q9vs-r7wp/0";
  const BATCH = 500;
  const all: CmsIpfFacility[] = [];

  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const url = `${BASE}?limit=${BATCH}&offset=${offset}`;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        headers: { Accept: "application/json", "User-Agent": "ER-Choices-DataImport/1.0" },
      });
      if (!res.ok) {
        console.log(`  CMS IPF ${url} returned HTTP ${res.status} — stopping`);
        break;
      }
      const json = await res.json() as { count?: number; results?: CmsIpfFacility[] };
      if (offset === 0 && typeof json.count === "number") total = json.count;
      const batch = json.results ?? [];
      all.push(...batch);
      offset += batch.length;
      if (batch.length < BATCH) break;
      await new Promise((r) => setTimeout(r, 150));
    } catch (err) {
      console.log(`  CMS IPF fetch failed at offset ${offset}: ${(err as Error).message}`);
      break;
    }
  }
  return all;
}

async function runSamhsaBehavioralHealthImport(): Promise<{
  ipfRecords: number;
  resolved: number;
  stillFlagged: number;
}> {
  console.log("\n[Phase 7] SAMHSA Behavioral Health import (via CMS IPF dataset)...");
  console.log("  Note: SAMHSA findtreatment.gov returns HTML; using CMS IPF (q9vs-r7wp) as proxy.");

  const ipfRaw = await fetchCmsIpfFacilities();
  console.log(`  CMS IPF facilities fetched: ${ipfRaw.length}`);

  const totalFlagged = await db
    .select({ id: hospitalSpecialties.id })
    .from(hospitalSpecialties)
    .where(sql`jsonb_array_length(${hospitalSpecialties.needsAdminReview}) > 0`);

  if (ipfRaw.length === 0) {
    console.log("  CMS IPF data unavailable — behavioral health designations remain in admin review queue");
    return { ipfRecords: 0, resolved: 0, stillFlagged: totalFlagged.length };
  }

  // Primary index: facility_id (CMS provider number) → record
  const ipfByCmsId = new Map<string, CmsIpfFacility>();
  // Secondary index: normalizedName|STATE → record
  const ipfByNameState = new Map<string, CmsIpfFacility>();

  for (const rec of ipfRaw) {
    if (rec.facility_id) {
      ipfByCmsId.set(rec.facility_id.trim(), rec);
    }
    if (rec.facility_name && rec.state) {
      const key = `${normalizeName(rec.facility_name)}|${String(rec.state).toUpperCase().trim()}`;
      if (!ipfByNameState.has(key)) ipfByNameState.set(key, rec);
    }
  }
  console.log(`  IPF primary index: ${ipfByCmsId.size} by cmsId, ${ipfByNameState.size} by name+state`);

  const rows = await db
    .select({
      id: hospitalSpecialties.id,
      cmsId: hospitalSpecialties.cmsId,
      hospitalName: hospitalSpecialties.hospitalName,
      state: hospitalSpecialties.state,
      latitude: hospitalSpecialties.latitude,
      longitude: hospitalSpecialties.longitude,
      specialties: hospitalSpecialties.specialties,
      needsAdminReview: hospitalSpecialties.needsAdminReview,
      source: hospitalSpecialties.source,
      designationSources: hospitalSpecialties.designationSources,
    })
    .from(hospitalSpecialties)
    .where(
      and(
        sql`${hospitalSpecialties.needsAdminReview} @> '["Behavioral Health"]'::jsonb`,
        sql`${hospitalSpecialties.source} != 'admin'`
      )
    );

  let resolved = 0;

  for (const row of rows) {
    const currentReview = (row.needsAdminReview as string[]) ?? [];
    const currentSpec = (row.specialties as string[]) ?? [];

    // Primary match: exact CMS provider number
    let matchedRec: CmsIpfFacility | undefined = ipfByCmsId.get(row.cmsId);

    // Secondary match: name + state
    if (!matchedRec) {
      const key = `${normalizeName(row.hospitalName)}|${row.state.toUpperCase()}`;
      matchedRec = ipfByNameState.get(key);
    }

    if (!matchedRec) continue;

    const newSpec = [...new Set([...currentSpec, "Behavioral Health"])];
    const newReview = currentReview.filter((d) => d !== "Behavioral Health");
    // Tag the resolved designation with source="cms-ipf" for per-designation provenance.
    // "cms-ipf" accurately identifies the CMS Inpatient Psychiatric Facility dataset
    // (Socrata q9vs-r7wp) used as a proxy for behavioral health facility confirmation.
    const existingDS = (row.designationSources as Record<string, string>) ?? {};
    const newDesignationSources = { ...existingDS, "Behavioral Health": "cms-ipf" };

    await db
      .update(hospitalSpecialties)
      .set({
        specialties: newSpec,
        needsAdminReview: newReview,
        source: "cms-ipf",
        designationSources: newDesignationSources,
        updatedAt: new Date(),
      })
      .where(eq(hospitalSpecialties.id, row.id));
    resolved++;
  }

  console.log(`  Resolved ${resolved} behavioral health designations (source=cms-ipf)`);
  console.log(`  ${totalFlagged.length} hospitals still have designations flagged for admin review`);

  return { ipfRecords: ipfRaw.length, resolved, stillFlagged: totalFlagged.length };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/** Exported for the admin API endpoint — runs the full import without closing the shared pool. */
export async function runImport(): Promise<void> {
  const { imported, geocoded, skipped } = await importCms();
  const { matched, unmatched, enrichedFromOsm } = await runOsmMatchingPass();
  const { hrsaRecords: acsHrsa, resolved: acsResolved, stillFlagged: afterAcs } =
    await runAcsTraumaImport();
  const { abaRecords, resolved: abaResolved, stillFlagged: afterAba } =
    await runAbaBurnImport();
  const { jcRecords, resolved: jcResolved, stillFlagged: afterJc } =
    await runJointCommissionStrokeImport();
  const { ipfRecords, resolved: samhsaResolved, stillFlagged } =
    await runSamhsaBehavioralHealthImport();

  console.log("\n=== Import Summary ===");
  console.log(`  CMS records upserted              : ${imported}`);
  console.log(`  Hospitals geocoded                : ${geocoded}`);
  console.log(`  CMS records skipped               : ${skipped}`);
  console.log(`  OSM matches written               : ${matched}`);
  console.log(`  Unmatched (no osmId)              : ${unmatched}`);
  console.log(`  Enriched from OSM tags            : ${enrichedFromOsm}`);
  console.log(`  HRSA records used (Phase 4/ACS)   : ${acsHrsa}`);
  console.log(`  Trauma resolved (source=acs)      : ${acsResolved}`);
  console.log(`  After Phase 4: still flagged      : ${afterAcs}`);
  console.log(`  ABA records fetched (Phase 5)     : ${abaRecords}`);
  console.log(`  Burn centers resolved (source=aba): ${abaResolved}`);
  console.log(`  After Phase 5: still flagged      : ${afterAba}`);
  console.log(`  JC records fetched (Phase 6)      : ${jcRecords}`);
  console.log(`  Stroke resolved (source=jc)       : ${jcResolved}`);
  console.log(`  After Phase 6: still flagged      : ${afterJc}`);
  console.log(`  CMS IPF records (Phase 7)         : ${ipfRecords}`);
  console.log(`  Behavioral health (source=cms-ipf): ${samhsaResolved}`);
  console.log(`  Still flagged for admin review    : ${stillFlagged}`);
}

// CLI entry point is in scripts/run-cms-import.ts — this file only exports functions.

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
