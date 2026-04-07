/**
 * geocode-addresses.ts
 *
 * Geocodes hospital coordinates from their stored street addresses using the
 * Nominatim API (OpenStreetMap's free geocoder — no API key required).
 *
 * Background: hospitals without an OSM element link still have ZIP code
 * centroid coordinates (0.5–2+ miles from the real building). Their CMS
 * street addresses are stored in the database and can be used to get
 * building-level precision via address geocoding.
 *
 * What this script does:
 *   1. Queries hospital_specialties where osm_id IS NULL and a street address
 *      is present (the OSM-linked hospitals were fixed by update-coords-from-osm).
 *   2. Calls Nominatim's structured search for each hospital, 1 per second
 *      (Nominatim's fair-use rate limit).
 *   3. Updates latitude/longitude when the geocoded result differs from the
 *      stored value by more than 10 m (idempotent).
 *   4. Emits a GEOCODE_RESULT:{json} summary line for the admin endpoint.
 *
 * Idempotent — safe to re-run. Admin overrides in hospital_overrides are
 * unaffected (they take precedence at query time, not stored here).
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run geocode-addresses
 *
 * Estimated runtime: ~1 second per hospital (~55 min for 3,276 hospitals).
 * Run via the admin endpoint on the Railway server for production updates.
 */

import { db, hospitalSpecialties } from "@workspace/db";
import { and, isNull, isNotNull, ne, eq, or, sql } from "drizzle-orm";

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

// ─── Nominatim geocoding ──────────────────────────────────────────────────────

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "ERChoices/1.0 (er-choices hospital locator; contact@erchoices.com)";

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  importance?: number;
}

/**
 * Geocode a US hospital address using Nominatim's structured search.
 * Returns null if no result was found or the API request failed.
 *
 * Nominatim structured search is preferred over free-form because it avoids
 * false matches in other countries and gives better precision for hospital
 * street addresses.
 */
async function geocodeAddress(
  address: string,
  city: string | null,
  state: string,
  zip: string | null
): Promise<{ lat: number; lon: number } | null> {
  const params = new URLSearchParams({
    format: "json",
    limit: "1",
    countrycodes: "us",
    addressdetails: "0",
  });

  // Use structured search fields when available
  params.set("street", address);
  if (city) params.set("city", city);
  params.set("state", state);
  if (zip) params.set("postalcode", zip);

  const url = `${NOMINATIM_BASE}?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const results = (await res.json()) as NominatimResult[];
    if (!results.length) return null;

    const best = results[0];
    const lat = parseFloat(best.lat);
    const lon = parseFloat(best.lon);
    if (isNaN(lat) || isNaN(lon)) return null;

    return { lat, lon };
  } catch (err) {
    throw new Error(`Nominatim request failed: ${(err as Error).message}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const REQUEST_DELAY_MS = 1100; // 1.1 s — slightly above Nominatim's 1 req/s limit
const UPDATE_THRESHOLD_METERS = 10;

async function main() {
  console.log("\n===== Geocode Hospital Addresses (Nominatim) =====");

  // Query hospitals with NO osm_id but WITH a street address.
  // OSM-matched hospitals were handled by update-coords-from-osm.
  const rows = await db
    .select({
      id: hospitalSpecialties.id,
      hospitalName: hospitalSpecialties.hospitalName,
      address: hospitalSpecialties.address,
      city: hospitalSpecialties.city,
      state: hospitalSpecialties.state,
      zip: hospitalSpecialties.zip,
      latitude: hospitalSpecialties.latitude,
      longitude: hospitalSpecialties.longitude,
    })
    .from(hospitalSpecialties)
    .where(
      and(
        isNull(hospitalSpecialties.osmId),
        isNotNull(hospitalSpecialties.address),
        ne(hospitalSpecialties.address, "")
      )
    );

  const withCoords = rows.filter((r) => r.latitude !== null && r.longitude !== null).length;
  const missingCoords = rows.filter((r) => r.latitude === null || r.longitude === null).length;

  console.log(`Loaded ${rows.length} hospitals without OSM links but with a stored address`);
  console.log(`  ${withCoords} have coordinates (ZIP centroid — will update if geocode differs >10m)`);
  console.log(`  ${missingCoords} have NO coordinates (will add from geocoding)`);
  console.log(`Estimated time: ~${Math.ceil(rows.length / 60)} minutes at 1 req/s\n`);

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let totalNoResult = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Progress log every 50 hospitals and at the start
    if (i % 50 === 0) {
      console.log(`Progress: ${i}/${rows.length} | updated=${totalUpdated} skipped=${totalSkipped} failed=${totalFailed} no-result=${totalNoResult}`);
    }

    if (!row.address) { totalFailed++; continue; }

    let coords: { lat: number; lon: number } | null = null;
    try {
      coords = await geocodeAddress(row.address, row.city, row.state, row.zip);
    } catch (err) {
      console.warn(`  [${i + 1}] FAIL ${row.hospitalName}, ${row.state}: ${(err as Error).message}`);
      totalFailed++;
      // Still delay to respect rate limit even on error
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
      continue;
    }

    if (!coords) {
      if (i < 20 || (i + 1) % 200 === 0) {
        console.log(`  [${i + 1}] NO RESULT: ${row.hospitalName}, ${row.state} — ${row.address}`);
      }
      totalNoResult++;
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
      continue;
    }

    // Idempotency check: skip if stored coords already match geocoded result
    const distMeters =
      row.latitude !== null && row.longitude !== null
        ? haversineMeters(row.latitude, row.longitude, coords.lat, coords.lon)
        : null;

    if (distMeters !== null && distMeters < UPDATE_THRESHOLD_METERS) {
      totalSkipped++;
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
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
        .where(eq(hospitalSpecialties.id, row.id));

      totalUpdated++;

      if (totalUpdated <= 20 || totalUpdated % 100 === 0) {
        const fromStr =
          row.latitude !== null && row.longitude !== null
            ? `(${row.latitude.toFixed(5)},${row.longitude.toFixed(5)})`
            : "(null,null)";
        const distStr = distMeters !== null ? ` — ${distMeters.toFixed(0)}m shift` : " — new";
        console.log(
          `  [updated] ${row.hospitalName}, ${row.state}: ${fromStr} → ` +
          `(${coords.lat.toFixed(5)},${coords.lon.toFixed(5)})${distStr}`
        );
      }
    } catch (err) {
      console.error(`  DB update failed for ${row.hospitalName}: ${(err as Error).message}`);
      totalFailed++;
    }

    // Rate limit: 1 request per second
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  console.log("\n===== Summary =====");
  console.log(`Total processed  : ${rows.length}`);
  console.log(`Updated          : ${totalUpdated}`);
  console.log(`Skipped (≤10 m)  : ${totalSkipped}`);
  console.log(`No geocode result: ${totalNoResult}`);
  console.log(`Failed           : ${totalFailed}`);
  console.log("\nDone.");

  const result = {
    total: rows.length,
    updated: totalUpdated,
    skipped: totalSkipped,
    noResult: totalNoResult,
    failed: totalFailed,
  };
  console.log(`GEOCODE_RESULT:${JSON.stringify(result)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
