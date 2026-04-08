/**
 * geocode-census-batch.ts
 *
 * Geocodes ALL non-OSM emergency hospitals using the US Census Bureau Batch
 * Geocoder (TIGER/Line street-level data).  Much more accurate than Nominatim
 * for US street addresses, completely free, and handles 1,000 rows per POST.
 *
 * Strategy:
 *   1. Query all emergency hospitals where osm_id IS NULL (OSM hospitals
 *      already have building-level coordinates — leave them alone).
 *   2. Split into batches of 1,000 and POST to the Census batch endpoint.
 *   3. For each match: if the result differs > UPDATE_THRESHOLD_METERS from
 *      the current stored value, update the DB.
 *   4. Emit GEOCODE_RESULT:{json} for the admin endpoint parser.
 *
 * Uses only Node.js built-in fetch, FormData, and Blob (Node 18+).
 *
 * Usage:
 *   DATABASE_URL="$RAILWAY_DATABASE_URL" pnpm tsx scripts/geocode-census-batch.ts
 */

import { db, hospitalSpecialties } from "@workspace/db";
import { and, isNull, isNotNull, eq } from "drizzle-orm";

const CENSUS_BATCH_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/addressbatch";
const BATCH_SIZE = 1000;
const UPDATE_THRESHOLD_METERS = 10;

// ─── Haversine distance ───────────────────────────────────────────────────────

function haversineMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Address cleaning ─────────────────────────────────────────────────────────

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

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface HospitalRow {
  id: number;
  hospitalName: string;
  address: string | null;
  city: string | null;
  state: string;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
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
  rows: HospitalRow[]
): Promise<Map<number, CensusResult>> {
  const csvLines = rows.map((r) => {
    const addr = cleanAddress(r.address ?? "").replace(/"/g, "'");
    const city = (r.city ?? "").replace(/"/g, "'").replace(/,/g, " ");
    const zip  = (r.zip  ?? "").replace(/[^0-9]/g, "").slice(0, 5);
    return `${r.id},"${addr}","${city}",${r.state},${zip}`;
  });
  const csvContent = csvLines.join("\n");

  const form = new FormData();
  form.append(
    "addressFile",
    new Blob([csvContent], { type: "text/csv" }),
    "addresses.csv"
  );
  form.append("benchmark", "Public_AR_Current");
  form.append("returntype", "locations");

  const response = await fetch(CENSUS_BATCH_URL, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(180_000), // 3-min timeout
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Census HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const text = await response.text();
  const results = new Map<number, CensusResult>();

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;

    // Response CSV columns (Census):
    //   0: ID  1: Input Address  2: Match (Match/No_Match/Tie)
    //   3: Match Type (Exact/Non_Exact)  4: Matched Address
    //   5: Coordinates (lon,lat)  6: Tiger Line ID  7: Tiger Line Side
    const parts = parseCSVLine(line);
    if (parts.length < 6) continue;

    const id = parseInt(parts[0], 10);
    if (isNaN(id)) continue;

    const matchStatus = parts[2]; // "Match" | "No_Match" | "Tie"
    if (matchStatus !== "Match" && matchStatus !== "Tie") continue;

    const coordStr = parts[5]; // "lon,lat" — Census uses x=lon, y=lat
    if (!coordStr) continue;

    const [lonStr, latStr] = coordStr.split(",");
    const lon = parseFloat(lonStr);
    const lat = parseFloat(latStr);
    if (isNaN(lat) || isNaN(lon)) continue;

    // Sanity check: coordinates should be within the US bounding box
    if (lat < 17 || lat > 72 || lon < -180 || lon > -60) continue;

    results.set(id, {
      id,
      lat,
      lon,
      matchType: parts[3] ?? "",
      matchedAddress: parts[4] ?? "",
    });
  }

  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n===== Census Batch Geocoder — Non-OSM Emergency Hospitals =====");

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
    })
    .from(hospitalSpecialties)
    .where(
      and(
        isNull(hospitalSpecialties.osmId),
        isNotNull(hospitalSpecialties.address),
        eq(hospitalSpecialties.emergencyServices, true)
      )
    )) as HospitalRow[];

  console.log(`Found ${rows.length} non-OSM emergency hospitals to geocode`);

  const batches: HospitalRow[][] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    batches.push(rows.slice(i, i + BATCH_SIZE));
  }
  console.log(`Split into ${batches.length} batch(es) of ≤${BATCH_SIZE}\n`);

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalNoMatch = 0;
  let totalFailed  = 0;

  for (let bIdx = 0; bIdx < batches.length; bIdx++) {
    const batch = batches[bIdx];
    console.log(`[Batch ${bIdx + 1}/${batches.length}] Submitting ${batch.length} addresses...`);

    let censusResults: Map<number, CensusResult>;
    try {
      censusResults = await geocodeBatch(batch);
    } catch (err) {
      console.error(`  Batch ${bIdx + 1} request failed: ${(err as Error).message}`);
      totalFailed += batch.length;
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    console.log(`  Census returned ${censusResults.size} matches out of ${batch.length}`);

    let bUpdated = 0;
    let bSkipped = 0;
    let bNoMatch = 0;
    let bFailed  = 0;

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

        if (bUpdated <= 5 || bUpdated % 200 === 0) {
          const shift = distMeters != null ? `${Math.round(distMeters)}m shift` : "new coord";
          console.log(
            `    [${result.matchType}] ${row.hospitalName}, ${row.state} ` +
            `→ (${result.lat.toFixed(5)},${result.lon.toFixed(5)}) — ${shift}`
          );
        }
      } catch (err) {
        console.error(`    DB update failed for ${row.hospitalName}: ${(err as Error).message}`);
        bFailed++;
      }
    }

    console.log(
      `  → updated=${bUpdated} skipped=${bSkipped} no-match=${bNoMatch} failed=${bFailed}\n`
    );

    totalUpdated += bUpdated;
    totalSkipped += bSkipped;
    totalNoMatch += bNoMatch;
    totalFailed  += bFailed;

    if (bIdx < batches.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log("===== Summary =====");
  console.log(`Total     : ${rows.length}`);
  console.log(`Updated   : ${totalUpdated}`);
  console.log(`Skipped   : ${totalSkipped}  (already accurate ≤10 m)`);
  console.log(`No match  : ${totalNoMatch}  (not in Census TIGER data)`);
  console.log(`Failed    : ${totalFailed}`);
  console.log("\nDone.");

  const resultObj = {
    total: rows.length, updated: totalUpdated,
    skipped: totalSkipped, noMatch: totalNoMatch, failed: totalFailed,
  };
  console.log(`GEOCODE_RESULT:${JSON.stringify(resultObj)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
