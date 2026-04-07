/**
 * update-coords-from-osm.ts
 *
 * Re-geocodes hospital coordinates from OpenStreetMap element data.
 *
 * Background: the original CMS import placed every hospital at its ZIP code
 * centroid (via zippopotam.us). A later OSM matching pass linked 1,225+
 * hospitals to precise OSM building elements (nodes/ways) and stored the
 * osm_id — but never updated the lat/lon in the database.
 *
 * This script closes that gap:
 *   1. Queries all hospital_specialties rows with a non-null osm_id.
 *   2. Parses each osm_id to determine element type and numeric ID.
 *   3. Batches lookups to the Overpass API (≤500 per batch, 1-2 s delay).
 *   4. Updates latitude/longitude only when the new value differs by >10 m.
 *
 * Idempotent — re-running is safe. Admin overrides in hospital_overrides
 * are unaffected (they override at query time, not in hospital_specialties).
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run update-coords
 */

import { db, hospitalSpecialties } from "@workspace/db";
import { and, isNotNull, eq } from "drizzle-orm";

// ─── Haversine helper ─────────────────────────────────────────────────────────

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── OSM ID parsing ───────────────────────────────────────────────────────────

type OsmElementType = "node" | "way" | "relation";

interface ParsedOsmId {
  type: OsmElementType;
  id: number;
}

/**
 * Parse osm_id strings stored in the database.
 *
 * The DB stores ids in two formats (from the import pipeline):
 *   - Canonical:  "node/12368853874",  "way/209879623",  "relation/123"
 *   - Legacy:     "osm-node-12345",    "osm-way-678"
 *
 * Returns null for unrecognised formats (e.g., "cms-12345").
 */
function parseOsmId(raw: string): ParsedOsmId | null {
  // Canonical format: "node/12345", "way/12345", "relation/12345"
  const canonical = raw.match(/^(node|way|relation)\/(\d+)$/);
  if (canonical) {
    return { type: canonical[1] as OsmElementType, id: parseInt(canonical[2], 10) };
  }

  // Legacy format: "osm-node-12345", "osm-way-12345", "osm-relation-12345"
  const legacy = raw.match(/^osm-(node|way|relation)-(\d+)$/);
  if (legacy) {
    return { type: legacy[1] as OsmElementType, id: parseInt(legacy[2], 10) };
  }

  return null;
}

// ─── Overpass API ─────────────────────────────────────────────────────────────

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/cgi/interpreter",
];

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
}

interface OverpassResponse {
  elements: OverpassElement[];
}

async function queryOverpass(
  endpoint: string,
  query: string,
  timeoutSecs = 60
): Promise<OverpassElement[]> {
  const body = `[out:json][timeout:${timeoutSecs}];\n${query}\nout center;`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(body)}`,
    signal: AbortSignal.timeout(timeoutSecs * 1000 + 5000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${endpoint}`);
  const json = (await res.json()) as OverpassResponse;
  return json.elements ?? [];
}

async function fetchOsmElements(parsed: ParsedOsmId[]): Promise<Map<string, { lat: number; lon: number }>> {
  const nodeIds = parsed.filter((p) => p.type === "node").map((p) => p.id);
  const wayIds  = parsed.filter((p) => p.type === "way").map((p) => p.id);
  const relIds  = parsed.filter((p) => p.type === "relation").map((p) => p.id);

  const parts: string[] = [];
  if (nodeIds.length) parts.push(`node(id:${nodeIds.join(",")});`);
  if (wayIds.length)  parts.push(`way(id:${wayIds.join(",")});`);
  if (relIds.length)  parts.push(`relation(id:${relIds.join(",")});`);

  if (!parts.length) return new Map();

  const query = `(\n  ${parts.join("\n  ")}\n);`;

  let elements: OverpassElement[] = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      elements = await queryOverpass(endpoint, query);
      break;
    } catch (err) {
      console.warn(`  Overpass endpoint failed (${endpoint}): ${(err as Error).message}`);
    }
  }

  const result = new Map<string, { lat: number; lon: number }>();
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat === undefined || lon === undefined) continue;
    const key = `${el.type}/${el.id}`;
    result.set(key, { lat, lon });
  }
  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const BATCH_SIZE = 500;
const BATCH_DELAY_MS = 1500;
const UPDATE_THRESHOLD_METERS = 10;

async function main() {
  console.log("\n===== Update Hospital Coordinates from OSM =====");

  // 1. Load all hospitals with an osm_id (whether or not they already have lat/lon)
  //    Hospitals with osmId + null lat/lon are invisible to the API (filtered out);
  //    fetching their real OSM coords makes them appear on the map for the first time.
  const rows = await db
    .select({
      id: hospitalSpecialties.id,
      osmId: hospitalSpecialties.osmId,
      hospitalName: hospitalSpecialties.hospitalName,
      state: hospitalSpecialties.state,
      latitude: hospitalSpecialties.latitude,
      longitude: hospitalSpecialties.longitude,
    })
    .from(hospitalSpecialties)
    .where(isNotNull(hospitalSpecialties.osmId));

  const withCoords = rows.filter((r) => r.latitude !== null && r.longitude !== null);
  const missingCoords = rows.filter((r) => r.latitude === null || r.longitude === null);
  console.log(`Loaded ${rows.length} hospitals with OSM IDs`);
  console.log(`  ${withCoords.length} have coordinates (will update if OSM differs >10m)`);
  console.log(`  ${missingCoords.length} have NO coordinates (will add from OSM)`);

  // 2. Parse all OSM IDs
  const parseable: Array<{
    id: number;
    osmId: string;
    parsed: ParsedOsmId;
    lat: number | null;
    lon: number | null;
    name: string;
    state: string;
  }> = [];

  let unparseable = 0;
  for (const row of rows) {
    if (!row.osmId) continue;
    const parsed = parseOsmId(row.osmId);
    if (!parsed) { unparseable++; continue; }
    parseable.push({
      id: row.id,
      osmId: row.osmId,
      parsed,
      lat: row.latitude ?? null,
      lon: row.longitude ?? null,
      name: row.hospitalName,
      state: row.state,
    });
  }

  console.log(`Parseable: ${parseable.length} | Unparseable format: ${unparseable}`);

  // 3. Process in batches
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  const batchCount = Math.ceil(parseable.length / BATCH_SIZE);

  for (let bIdx = 0; bIdx < batchCount; bIdx++) {
    const batchItems = parseable.slice(bIdx * BATCH_SIZE, (bIdx + 1) * BATCH_SIZE);
    const batchParsed = batchItems.map((b) => b.parsed);

    console.log(`\nBatch ${bIdx + 1}/${batchCount} (${batchItems.length} hospitals)...`);

    let osmCoords: Map<string, { lat: number; lon: number }>;
    try {
      osmCoords = await fetchOsmElements(batchParsed);
    } catch (err) {
      console.error(`  Batch ${bIdx + 1} failed: ${(err as Error).message}`);
      totalFailed += batchItems.length;
      continue;
    }

    console.log(`  OSM returned ${osmCoords.size} elements`);

    // 4. Update coordinates where they differ meaningfully
    for (const item of batchItems) {
      const key = `${item.parsed.type}/${item.parsed.id}`;
      const coords = osmCoords.get(key);
      if (!coords) { totalFailed++; continue; }

      // Always update if stored lat/lon is null; otherwise only update if
      // the new OSM position differs by more than the threshold.
      const distMeters =
        item.lat !== null && item.lon !== null
          ? haversineMeters(item.lat, item.lon, coords.lat, coords.lon)
          : null;

      if (distMeters !== null && distMeters < UPDATE_THRESHOLD_METERS) {
        totalSkipped++;
        continue;
      }

      try {
        await db
          .update(hospitalSpecialties)
          .set({
            latitude: coords.lat,
            longitude: coords.lon,
            updatedAt: new Date(),
          })
          .where(eq(hospitalSpecialties.id, item.id));
        totalUpdated++;
        if (totalUpdated <= 20 || totalUpdated % 100 === 0) {
          const fromStr =
            item.lat !== null && item.lon !== null
              ? `(${item.lat.toFixed(5)},${item.lon.toFixed(5)})`
              : "(null,null)";
          const distStr = distMeters !== null ? ` — ${distMeters.toFixed(0)}m` : " — new";
          console.log(
            `  [updated] ${item.name}, ${item.state}: ${fromStr} → ` +
            `(${coords.lat.toFixed(5)},${coords.lon.toFixed(5)})${distStr}`
          );
        }
      } catch (err) {
        console.error(`  DB update failed for ${item.name}: ${(err as Error).message}`);
        totalFailed++;
      }
    }

    if (bIdx < batchCount - 1) {
      console.log(`  Waiting ${BATCH_DELAY_MS}ms before next batch...`);
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log("\n===== Summary =====");
  console.log(`Total with OSM IDs : ${rows.length}`);
  console.log(`Updated            : ${totalUpdated}`);
  console.log(`Skipped (≤10 m)    : ${totalSkipped}`);
  console.log(`Failed / Not found : ${totalFailed}`);
  console.log(`Unparseable IDs    : ${unparseable}`);
  console.log("\nDone.");

  // Emit machine-readable result line for the admin endpoint to parse
  const result = { updated: totalUpdated, skipped: totalSkipped, failed: totalFailed, unparseable, total: rows.length };
  console.log(`COORD_UPDATE_RESULT:${JSON.stringify(result)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
