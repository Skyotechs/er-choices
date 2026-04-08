/**
 * geocode-census-batch.ts
 *
 * Full geocoding pass over ALL 5,400+ hospitals using the US Census Bureau
 * Batch Geocoder (TIGER/Line street-level data).
 *
 * Strategy:
 *   1. Query EVERY hospital that has a street address (both emergency and
 *      non-emergency, both OSM-linked and CMS-only).
 *   2. Split into batches of 1,000 and POST to the Census batch endpoint.
 *   3. For each Census match: update lat/lon if the result differs > 10 m
 *      from what is currently stored (or if coordinates are NULL).
 *   4. After all batches: query every hospital still lacking coordinates and
 *      write a CSV report to missing-hospital-coords.csv for admin review.
 *   5. Emit GEOCODE_RESULT:{json} for the admin status parser.
 *
 * Uses only built-in Node.js 18+ APIs (fetch, FormData, Blob, fs).
 *
 * Usage:
 *   DATABASE_URL="$RAILWAY_DATABASE_URL" pnpm tsx scripts/geocode-census-batch.ts
 */

import fs from "fs";
import path from "path";
import { db, hospitalSpecialties } from "@workspace/db";
import { isNotNull, ne, or, isNull, eq } from "drizzle-orm";

// ─── Config ───────────────────────────────────────────────────────────────────

const CENSUS_BATCH_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/addressbatch";
const BATCH_SIZE = 1000;
const UPDATE_THRESHOLD_METERS = 10;

// Output report written next to this script
const REPORT_PATH = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "missing-hospital-coords.csv"
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function haversineMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6_371_000;
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(lat2 - lat1);
  const dLon = r(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function cleanAddress(raw: string): string {
  let s = raw.trim();
  s = s.replace(/[,\s]+(suite|ste\.?)\s*#?\s*[\w\d-]+.*/i, "");
  s = s.replace(/[,\s]+(p\.?\s*o\.?\s*box|po\s*box|post\s+office\s+box|box)\s+[\w\d]+.*/i, "");
  s = s.replace(/\s+box\s+\d+\s*$/i, "");
  s = s.replace(/[,\s]+(floor|fl\.?)\s*\d+.*/i, "");
  s = s.replace(/[,\s]+(unit|room|rm\.?)\s*[\w\d-]+.*/i, "");
  s = s.replace(/\s{2,}/g, " ").trim().replace(/,\s*$/, "").trim();
  return s;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === "," && !inQ) { result.push(cur.trim()); cur = ""; }
    else { cur += ch; }
  }
  result.push(cur.trim());
  return result;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface HospRow {
  id: number;
  hospitalName: string;
  address: string | null;
  city: string | null;
  state: string;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  osmId: string | null;
  emergencyServices: boolean | null;
}

interface NoAddrRow {
  id: number;
  hospitalName: string;
  address: string | null;
  city: string | null;
  state: string;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface MissingRow {
  id: number;
  hospitalName: string;
  address: string | null;
  city: string | null;
  state: string;
  zip: string | null;
  phone: string | null;
  emergencyServices: boolean | null;
  osmId: string | null;
}

interface CensusResult {
  id: number;
  lat: number;
  lon: number;
  matchType: string;
  matchedAddress: string;
}

// ─── Census batch request ─────────────────────────────────────────────────────

async function geocodeBatch(
  rows: HospRow[]
): Promise<Map<number, CensusResult>> {
  const csvLines = rows.map((r) => {
    const addr = cleanAddress(r.address ?? "").replace(/"/g, "'");
    const city = (r.city ?? "").replace(/"/g, "'").replace(/,/g, " ");
    const zip  = (r.zip  ?? "").replace(/[^0-9]/g, "").slice(0, 5);
    return `${r.id},"${addr}","${city}",${r.state},${zip}`;
  });

  const form = new FormData();
  form.append(
    "addressFile",
    new Blob([csvLines.join("\n")], { type: "text/csv" }),
    "addresses.csv"
  );
  form.append("benchmark", "Public_AR_Current");
  form.append("returntype", "locations");

  const response = await fetch(CENSUS_BATCH_URL, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(180_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Census HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  const text = await response.text();
  const results = new Map<number, CensusResult>();

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = parseCSVLine(line);
    if (parts.length < 6) continue;

    const id = parseInt(parts[0], 10);
    if (isNaN(id)) continue;

    const matchStatus = parts[2]; // "Match" | "No_Match" | "Tie"
    if (matchStatus !== "Match" && matchStatus !== "Tie") continue;

    const coordStr = parts[5]; // "lon,lat" — Census x=lon, y=lat
    if (!coordStr) continue;

    const [lonStr, latStr] = coordStr.split(",");
    const lon = parseFloat(lonStr);
    const lat = parseFloat(latStr);
    if (isNaN(lat) || isNaN(lon)) continue;

    // Sanity: must be within US + territories bounding box
    if (lat < 17 || lat > 72 || lon < -180 || lon > -60) continue;

    results.set(id, {
      id, lat, lon,
      matchType: parts[3] ?? "",
      matchedAddress: parts[4] ?? "",
    });
  }

  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n===== Census Full-Pass Geocoder — All 5,400+ Hospitals =====");
  const startedAt = Date.now();

  // Fetch every hospital that has an address (regardless of OSM link or type)
  const rows = (await db
    .select({
      id: hospitalSpecialties.id,
      hospitalName: hospitalSpecialties.hospitalName,
      address: hospitalSpecialties.address,
      city: hospitalSpecialties.city,
      state: hospitalSpecialties.state,
      zip: hospitalSpecialties.zip,
      latitude: hospitalSpecialties.latitude,
      longitude: hospitalSpecialties.longitude,
      osmId: hospitalSpecialties.osmId,
      emergencyServices: hospitalSpecialties.emergencyServices,
    })
    .from(hospitalSpecialties)
    .where(
      isNotNull(hospitalSpecialties.address),
    )) as HospRow[];

  const noAddressRows = (await db
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
      or(isNull(hospitalSpecialties.address), eq(hospitalSpecialties.address, ""))
    )) as NoAddrRow[];

  console.log(`Hospitals with an address   : ${rows.length}`);
  console.log(`Hospitals with no address   : ${noAddressRows.length}`);
  console.log(`Total                       : ${rows.length + noAddressRows.length}`);

  const batches: HospRow[][] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    batches.push(rows.slice(i, i + BATCH_SIZE));
  }
  console.log(`\nBatches of ≤${BATCH_SIZE}: ${batches.length} — est. ${Math.ceil(batches.length * 1.5)} min\n`);

  let totalUpdated  = 0;
  let totalSkipped  = 0;
  let totalNoMatch  = 0;
  let totalFailed   = 0;

  for (let bIdx = 0; bIdx < batches.length; bIdx++) {
    const batch = batches[bIdx];
    console.log(`[Batch ${bIdx + 1}/${batches.length}] Submitting ${batch.length} addresses...`);

    let censusResults: Map<number, CensusResult>;
    try {
      censusResults = await geocodeBatch(batch);
    } catch (err) {
      console.error(`  Batch ${bIdx + 1} request FAILED: ${(err as Error).message}`);
      totalFailed += batch.length;
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    console.log(`  → ${censusResults.size} Census matches out of ${batch.length}`);

    let bUpdated = 0, bSkipped = 0, bNoMatch = 0, bFailed = 0;

    for (const row of batch) {
      const result = censusResults.get(row.id);
      if (!result) { bNoMatch++; continue; }

      const distMeters =
        row.latitude !== null && row.longitude !== null
          ? haversineMeters(row.latitude, row.longitude, result.lat, result.lon)
          : null;

      if (distMeters !== null && distMeters < UPDATE_THRESHOLD_METERS) {
        bSkipped++;
        continue;
      }

      try {
        await db
          .update(hospitalSpecialties)
          .set({ latitude: result.lat, longitude: result.lon, updatedAt: new Date() })
          .where(eq(hospitalSpecialties.id, row.id));
        bUpdated++;

        if (bUpdated <= 3 || bUpdated % 250 === 0) {
          const shift = distMeters != null ? `${Math.round(distMeters)}m shift` : "was NULL";
          console.log(
            `    [${result.matchType}] ${row.hospitalName}, ${row.state} ` +
            `→ (${result.lat.toFixed(5)},${result.lon.toFixed(5)}) — ${shift}`
          );
        }
      } catch (err) {
        console.error(`    DB update failed: ${(err as Error).message}`);
        bFailed++;
      }
    }

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `  Batch ${bIdx + 1} done — updated=${bUpdated} skipped=${bSkipped} ` +
      `no-match=${bNoMatch} failed=${bFailed} [${elapsed}s elapsed]\n`
    );

    totalUpdated += bUpdated;
    totalSkipped += bSkipped;
    totalNoMatch += bNoMatch;
    totalFailed  += bFailed;

    if (bIdx < batches.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // ─── Build missing-coordinates report ──────────────────────────────────────

  console.log("Querying hospitals still missing coordinates for the report...");

  const missingCoords = (await db
    .select({
      id: hospitalSpecialties.id,
      hospitalName: hospitalSpecialties.hospitalName,
      address: hospitalSpecialties.address,
      city: hospitalSpecialties.city,
      state: hospitalSpecialties.state,
      zip: hospitalSpecialties.zip,
      phone: hospitalSpecialties.phone,
      emergencyServices: hospitalSpecialties.emergencyServices,
      osmId: hospitalSpecialties.osmId,
    })
    .from(hospitalSpecialties)
    .where(
      or(
        isNull(hospitalSpecialties.latitude),
        isNull(hospitalSpecialties.longitude)
      )
    )) as MissingRow[];

  // Convert noAddressRows that still lack coords into MissingRow shape for unified reporting
  const noAddrMissing: MissingRow[] = noAddressRows
    .filter((r) => r.latitude == null || r.longitude == null)
    .map((r) => ({
      id: r.id,
      hospitalName: r.hospitalName,
      address: r.address,
      city: r.city,
      state: r.state,
      zip: r.zip,
      phone: null,
      emergencyServices: null,
      osmId: null,
    }));

  // Deduplicate by id (missingCoords already covers hospitals with no address but has coords=NULL too)
  const seenIds = new Set(missingCoords.map((r) => r.id));
  const allMissing: MissingRow[] = [
    ...missingCoords,
    ...noAddrMissing.filter((r) => !seenIds.has(r.id)),
  ];

  const csvHeader =
    "id,hospital_name,address,city,state,zip,phone,emergency_services,osm_id,reason";
  const csvRows = allMissing.map((r) => {
    const reason = (!r.address || r.address === "") ? "no_address" : "no_census_match";
    const fields = [
      r.id,
      `"${(r.hospitalName ?? "").replace(/"/g, "'")}"`,
      `"${(r.address ?? "").replace(/"/g, "'")}"`,
      `"${(r.city ?? "").replace(/"/g, "'")}"`,
      r.state ?? "",
      r.zip ?? "",
      `"${(r.phone ?? "").replace(/"/g, "'")}"`,
      r.emergencyServices ? "YES" : "NO",
      r.osmId ?? "",
      reason,
    ];
    return fields.join(",");
  });

  const csvContent = [csvHeader, ...csvRows].join("\n");
  fs.writeFileSync(REPORT_PATH, csvContent, "utf8");
  console.log(`\nMissing-coordinates report → ${REPORT_PATH}`);
  console.log(`  ${allMissing.length} hospitals listed (${allMissing.filter((r) => r.emergencyServices).length} emergency)`);

  // ─── Summary ───────────────────────────────────────────────────────────────

  const totalSecs = Math.round((Date.now() - startedAt) / 1000);
  console.log("\n===== Summary =====");
  console.log(`Runtime         : ${Math.floor(totalSecs / 60)}m ${totalSecs % 60}s`);
  console.log(`Total submitted : ${rows.length}`);
  console.log(`Updated         : ${totalUpdated}`);
  console.log(`Skipped (≤10m)  : ${totalSkipped}  (already accurate)`);
  console.log(`No Census match : ${totalNoMatch}`);
  console.log(`Failed          : ${totalFailed}`);
  console.log(`Still missing   : ${allMissing.length}`);
  console.log("\nDone.");

  const resultObj = {
    total: rows.length + noAddressRows.length,
    submitted: rows.length,
    updated: totalUpdated,
    skipped: totalSkipped,
    noMatch: totalNoMatch,
    failed: totalFailed,
    stillMissing: allMissing.length,
    reportPath: REPORT_PATH,
  };
  console.log(`GEOCODE_RESULT:${JSON.stringify(resultObj)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
