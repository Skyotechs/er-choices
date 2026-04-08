/**
 * geocode-addresses-pass2.ts
 *
 * Second geocoding pass targeting the ~765 hospitals that were NOT updated by
 * the first Nominatim pass (geocode-addresses.ts).  The primary failure cause
 * is address strings containing Suite/Ste, P.O. Box, Floor, Unit, etc.
 * that confuse Nominatim's structured search.
 *
 * This script:
 *   1. Queries hospitals where osm_id IS NULL AND address IS NOT NULL and
 *      updated_at < '2026-04-08 02:05:57' (before the first geocoding run).
 *   2. Cleans addresses: strips Suite/Box/Floor/Unit suffixes.
 *   3. Geocodes via Nominatim structured search (1 req/s).
 *   4. Falls back to free-form search (just city+state+zip) if structured fails.
 *   5. Updates lat/lon only when the result differs > 10 m from current stored coords.
 *   6. Emits GEOCODE_RESULT:{json} for the admin endpoint parser.
 *
 * Idempotent — safe to re-run. Operates only on hospitals with old timestamps.
 *
 * Usage (from api-server root):
 *   pnpm tsx scripts/geocode-addresses-pass2.ts
 *
 * DATABASE_URL should point to the target DB (set RAILWAY_DATABASE_URL in env to
 * target production when running via the admin endpoint).
 */

import { db, hospitalSpecialties } from "@workspace/db";
import { and, isNull, isNotNull, ne, eq, lt, sql } from "drizzle-orm";

// ─── Address cleaning ─────────────────────────────────────────────────────────

/**
 * Strip common non-address suffixes that confuse geocoders:
 *   Suite / Ste / Ste. / Ste #
 *   P.O. Box / Po Box / Post Office Box / Box NNNNN
 *   Floor / Fl / Fl.
 *   Unit / Rm / Room
 *   "Box NNNNN" at end (not preceded by P.O.)
 *   Double spaces collapse to single
 */
function cleanAddress(raw: string): string {
  let s = raw.trim();

  // Strip Suite/Ste suffix (with or without leading comma)
  s = s.replace(/[,\s]+(suite|ste\.?)\s*#?\s*[\w\d-]+.*/i, "");

  // Strip P.O. Box / Po Box / Post Office Box / Box NNNNN
  s = s.replace(/[,\s]+(p\.?\s*o\.?\s*box|po\s*box|post\s+office\s+box|box)\s+[\w\d]+.*/i, "");
  // Also strip "Box NNNNN" at end of address (space-separated, not comma)
  s = s.replace(/\s+box\s+\d+\s*$/i, "");

  // Strip Floor / Fl suffix
  s = s.replace(/[,\s]+(floor|fl\.?)\s*\d+.*/i, "");

  // Strip Unit / Room / Rm suffix
  s = s.replace(/[,\s]+(unit|room|rm\.?)\s*[\w\d-]+.*/i, "");

  // Collapse double+ spaces
  s = s.replace(/\s{2,}/g, " ").trim();

  // Strip trailing comma
  s = s.replace(/,\s*$/, "").trim();

  return s;
}

// ─── Haversine ─────────────────────────────────────────────────────────────────

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

// ─── Nominatim ────────────────────────────────────────────────────────────────

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "ERChoices/1.0 (er-choices hospital locator; contact@erchoices.com)";

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  importance?: number;
}

async function geocodeStructured(
  street: string,
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
  params.set("street", street);
  if (city) params.set("city", city);
  params.set("state", state);
  if (zip) params.set("postalcode", zip);

  const res = await fetch(`${NOMINATIM_BASE}?${params}`, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en", Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const results = (await res.json()) as NominatimResult[];
  if (!results.length) return null;
  const lat = parseFloat(results[0].lat);
  const lon = parseFloat(results[0].lon);
  return isNaN(lat) || isNaN(lon) ? null : { lat, lon };
}

/** Fallback: free-form query using zip+state to at least improve over stale ZIP centroid */
async function geocodeFreeform(
  city: string | null,
  state: string,
  zip: string | null
): Promise<{ lat: number; lon: number } | null> {
  const q = [zip, city, state, "US"].filter(Boolean).join(", ");
  const params = new URLSearchParams({
    format: "json",
    limit: "1",
    countrycodes: "us",
    addressdetails: "0",
    q,
  });
  const res = await fetch(`${NOMINATIM_BASE}?${params}`, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en", Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const results = (await res.json()) as NominatimResult[];
  if (!results.length) return null;
  const lat = parseFloat(results[0].lat);
  const lon = parseFloat(results[0].lon);
  return isNaN(lat) || isNaN(lon) ? null : { lat, lon };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const REQUEST_DELAY_MS = 1100;
const UPDATE_THRESHOLD_METERS = 10;

// Only touch hospitals that were not updated by the first geocoding run
const FIRST_PASS_START = new Date("2026-04-08T02:05:57.000Z");

async function main() {
  console.log("\n===== Geocode Hospital Addresses — Pass 2 (Address Cleaning) =====");

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
      updatedAt: hospitalSpecialties.updatedAt,
    })
    .from(hospitalSpecialties)
    .where(
      and(
        isNull(hospitalSpecialties.osmId),
        isNotNull(hospitalSpecialties.address),
        ne(hospitalSpecialties.address, ""),
        lt(hospitalSpecialties.updatedAt, FIRST_PASS_START)
      )
    );

  console.log(`Found ${rows.length} hospitals not updated by the first geocoding pass`);
  console.log(`Estimated time: ~${Math.ceil((rows.length * REQUEST_DELAY_MS) / 60000)} minutes\n`);

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let totalNoResult = 0;
  let totalCleaned = 0;
  let totalFallback = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    if (i % 50 === 0) {
      console.log(
        `Progress: ${i}/${rows.length} | updated=${totalUpdated} skipped=${totalSkipped} ` +
        `failed=${totalFailed} no-result=${totalNoResult} cleaned=${totalCleaned} fallback=${totalFallback}`
      );
    }

    if (!row.address) { totalFailed++; await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS)); continue; }

    const rawAddress = row.address;
    const cleanedAddress = cleanAddress(rawAddress);
    const addressChanged = cleanedAddress !== rawAddress;

    let coords: { lat: number; lon: number } | null = null;
    let usedFallback = false;

    try {
      // Try cleaned address first
      coords = await geocodeStructured(cleanedAddress, row.city, row.state, row.zip);
      if (addressChanged && coords) totalCleaned++;

      // If still no result, try fallback (city/state/zip only)
      if (!coords) {
        await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
        coords = await geocodeFreeform(row.city, row.state, row.zip);
        if (coords) { usedFallback = true; totalFallback++; }
      }
    } catch (err) {
      console.warn(`  [${i + 1}] FAIL ${row.hospitalName}, ${row.state}: ${(err as Error).message}`);
      totalFailed++;
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
      continue;
    }

    if (!coords) {
      if (i < 20 || (i + 1) % 100 === 0) {
        console.log(
          `  [${i + 1}] NO RESULT (even after cleaning): ${row.hospitalName}, ${row.state}` +
          (addressChanged ? ` | cleaned: "${cleanedAddress}"` : "")
        );
      }
      totalNoResult++;
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
      continue;
    }

    // Skip if already within threshold
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
        .set({ latitude: coords.lat, longitude: coords.lon, updatedAt: new Date() })
        .where(eq(hospitalSpecialties.id, row.id));
      totalUpdated++;

      if (totalUpdated <= 20 || totalUpdated % 50 === 0) {
        const method = usedFallback ? "fallback" : addressChanged ? "cleaned" : "original";
        const distStr = distMeters !== null ? ` — ${distMeters.toFixed(0)}m shift` : " — new coord";
        console.log(
          `  [updated/${method}] ${row.hospitalName}, ${row.state}` +
          (addressChanged ? ` | "${cleanedAddress}"` : "") +
          ` → (${coords.lat.toFixed(5)},${coords.lon.toFixed(5)})${distStr}`
        );
      }
    } catch (err) {
      console.error(`  DB update failed for ${row.hospitalName}: ${(err as Error).message}`);
      totalFailed++;
    }

    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  console.log("\n===== Pass 2 Summary =====");
  console.log(`Total processed  : ${rows.length}`);
  console.log(`Updated          : ${totalUpdated}`);
  console.log(`  Via cleaning   : ${totalCleaned}`);
  console.log(`  Via fallback   : ${totalFallback}`);
  console.log(`Skipped (≤10 m)  : ${totalSkipped}`);
  console.log(`No result        : ${totalNoResult}`);
  console.log(`Failed           : ${totalFailed}`);
  console.log("\nDone.");

  const result = { total: rows.length, updated: totalUpdated, skipped: totalSkipped, noResult: totalNoResult, failed: totalFailed };
  console.log(`GEOCODE_RESULT:${JSON.stringify(result)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
