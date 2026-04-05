/**
 * Specialty Enrichment Script
 *
 * Populates strokeDesignation, burnDesignation, and pciCapability from multiple sources:
 *
 * Phase 1 – Internal mining:
 *   Reads actualDesignation text for stroke/burn/PCI keywords (always runs).
 *   These are the same records an admin already edited, so confidence = HIGH.
 *   Source tag: "internal"
 *
 * Phase 2 – CMS Cardiac dataset (bzsr-4my4):
 *   CMS cardiac catheterization / PCI participation data.
 *   Matched by name + state + ≤3 km proximity.
 *   Source tag: "cms-cardiac"
 *
 * Phase 3 – TJC Stroke certifications (qualitycheck.org):
 *   Joint Commission certified stroke center list.
 *   Tries several alternate endpoints with browser-like headers.
 *   Gracefully skips when unavailable.
 *   Source tag: "tjc"
 *
 * Phase 4 – ABA Burn center list (ameriburn.org):
 *   American Burn Association verified burn centers.
 *   Tries WordPress REST API endpoints.
 *   Gracefully skips when unavailable.
 *   Source tag: "aba"
 *
 * Writes HIGH/MEDIUM confidence matches to the DB.
 * Exports ALL matches (including LOW) to specialty-enrichment-review.csv for admin review.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run enrich-specialties
 */

import { db, hospitalSpecialties } from "@workspace/db";
import { eq } from "drizzle-orm";
import { haversineMeters, nameScore } from "./import-cms-hospitals.js";

// ─── Types ───────────────────────────────────────────────────────────────────

type Confidence = "HIGH" | "MEDIUM" | "LOW";
type EnrichField = "strokeDesignation" | "burnDesignation" | "pciCapability";

interface EnrichmentMatch {
  cmsId: string;
  hospitalName: string;
  state: string;
  field: EnrichField;
  matchedValue: string;
  confidence: Confidence;
  distanceKm: number;
  source: string;
}

interface DbHospital {
  cmsId: string;
  hospitalName: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
  actualDesignation: string | null;
  strokeDesignation: string | null;
  burnDesignation: string | null;
  pciCapability: string | null;
}

export interface EnrichmentResult {
  strokeMatched: number;
  burnMatched: number;
  pciMatched: number;
  total: number;
  csvRows: EnrichmentMatch[];
}

// In-memory CSV cache — populated by runEnrichment(), served by GET /api/admin/enrichment-csv
let lastEnrichmentCsv = "";
let lastEnrichmentRunAt: string | null = null;

export function getEnrichmentCsv(): { csv: string; runAt: string | null } {
  return { csv: lastEnrichmentCsv, runAt: lastEnrichmentRunAt };
}

// ─── Confidence scoring ───────────────────────────────────────────────────────

/**
 * Compute confidence for a source record matching a DB hospital.
 *
 * With coordinates:  HIGH = nameScore ≥ 0.70 && dist ≤ 3 km
 *                    MEDIUM = nameScore ≥ 0.50 && dist ≤ 3 km
 *                    LOW = nameScore ≥ 0.50 && dist ≤ 8 km
 *
 * Without coords:    HIGH = never (can't confirm proximity)
 *                    MEDIUM = nameScore ≥ 0.70 (name alone)
 *                    LOW = nameScore ≥ 0.50
 *
 * Returns null when no match qualifies.
 */
function scoreMatch(
  dbHosp: DbHospital,
  sourceName: string,
  sourceLat: number | null,
  sourceLon: number | null,
): { confidence: Confidence; distanceKm: number } | null {
  const ns = nameScore(dbHosp.hospitalName, sourceName);
  if (ns < 0.50) return null;

  const hasBothCoords =
    dbHosp.latitude != null && dbHosp.longitude != null &&
    sourceLat != null && sourceLon != null;

  if (hasBothCoords) {
    const distM = haversineMeters(
      dbHosp.latitude!, dbHosp.longitude!,
      sourceLat!, sourceLon!,
    );
    const distKm = distM / 1000;
    if (distM > 8000) return null;
    if (distM <= 3000 && ns >= 0.70) return { confidence: "HIGH", distanceKm: distKm };
    if (distM <= 3000 && ns >= 0.50) return { confidence: "MEDIUM", distanceKm: distKm };
    return { confidence: "LOW", distanceKm: distKm };
  }

  // No proximity data available
  const distKm = -1;
  if (ns >= 0.70) return { confidence: "MEDIUM", distanceKm: distKm };
  return { confidence: "LOW", distanceKm: distKm };
}

// ─── Phase 1 – Internal mining ────────────────────────────────────────────────

/**
 * Stroke keywords mapped to canonical designation strings.
 * Checked in order — first match wins.
 */
const STROKE_KEYWORD_MAP: Array<[RegExp, string]> = [
  [/comprehensive\s+stroke/i,       "Comprehensive Stroke Center"],
  [/thrombectomy.?capable/i,        "Thrombectomy-Capable Stroke Center"],
  [/primary\s+stroke/i,             "Primary Stroke Center"],
  [/acute\s+stroke\s+ready/i,       "Acute Stroke Ready Hospital"],
  [/stroke\s+center/i,              "Primary Stroke Center"],
  [/stroke/i,                       "Stroke Center"],
];

const BURN_KEYWORD_MAP: Array<[RegExp, string]> = [
  [/pediatric\s+burn/i,  "Verified Pediatric Burn Center"],
  [/burn\s+center/i,     "Verified Burn Center"],
  [/burn\s+unit/i,       "Verified Burn Center"],
  [/burn/i,              "Verified Burn Center"],
];

const PCI_KEYWORD_MAP: Array<[RegExp, string]> = [
  [/pci[- ]capable/i,       "PCI Capable"],
  [/stemi\s+receiv/i,       "STEMI Receiving Center"],
  [/stemi/i,                "STEMI Receiving Center"],
  [/cardiac\s+cath/i,       "Cardiac Catheterization Lab"],
  [/pci/i,                  "PCI Capable"],
];

function extractStroke(text: string): string | null {
  for (const [re, val] of STROKE_KEYWORD_MAP) {
    if (re.test(text)) return val;
  }
  return null;
}
function extractBurn(text: string): string | null {
  for (const [re, val] of BURN_KEYWORD_MAP) {
    if (re.test(text)) return val;
  }
  return null;
}
function extractPci(text: string): string | null {
  for (const [re, val] of PCI_KEYWORD_MAP) {
    if (re.test(text)) return val;
  }
  return null;
}

async function mineInternalDesignations(
  rows: DbHospital[],
  matches: EnrichmentMatch[],
): Promise<{ stroke: number; burn: number; pci: number }> {
  console.log("\n[Phase 1] Mining existing actualDesignation field...");
  let stroke = 0, burn = 0, pci = 0;

  for (const row of rows) {
    if (!row.actualDesignation) continue;
    const text = row.actualDesignation;

    // Only populate if field is currently empty
    if (!row.strokeDesignation) {
      const val = extractStroke(text);
      if (val) {
        matches.push({
          cmsId: row.cmsId,
          hospitalName: row.hospitalName,
          state: row.state,
          field: "strokeDesignation",
          matchedValue: val,
          confidence: "HIGH",
          distanceKm: 0,
          source: "internal",
        });
        stroke++;
      }
    }
    if (!row.burnDesignation) {
      const val = extractBurn(text);
      if (val) {
        matches.push({
          cmsId: row.cmsId,
          hospitalName: row.hospitalName,
          state: row.state,
          field: "burnDesignation",
          matchedValue: val,
          confidence: "HIGH",
          distanceKm: 0,
          source: "internal",
        });
        burn++;
      }
    }
    if (!row.pciCapability) {
      const val = extractPci(text);
      if (val) {
        matches.push({
          cmsId: row.cmsId,
          hospitalName: row.hospitalName,
          state: row.state,
          field: "pciCapability",
          matchedValue: val,
          confidence: "HIGH",
          distanceKm: 0,
          source: "internal",
        });
        pci++;
      }
    }
  }

  console.log(`  Extracted: ${stroke} stroke, ${burn} burn, ${pci} PCI from actualDesignation`);
  return { stroke, burn, pci };
}

// ─── Phase 2 – CMS Cardiac dataset ───────────────────────────────────────────

interface CmsCardiacRecord {
  facility_id?: string;
  provider_id?: string;
  facility_name?: string;
  name?: string;
  state?: string;
  lat?: number | string | null;
  lon?: number | string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  [key: string]: unknown;
}

async function fetchCmsCardiacHospitals(): Promise<CmsCardiacRecord[]> {
  const datasets = [
    "bzsr-4my4",  // Suggested in task — try first
    "77k9-qc49",  // Alternative cardiac dataset
  ];

  for (const id of datasets) {
    const url = `https://data.cms.gov/provider-data/api/1/datastore/query/${id}/0?limit=5000`;
    try {
      console.log(`  Trying CMS cardiac dataset: ${id}`);
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        headers: { Accept: "application/json" },
      });
      if (!res.ok) { console.log(`  Dataset ${id} → HTTP ${res.status}`); continue; }
      const json = (await res.json()) as { results?: CmsCardiacRecord[]; count?: number };
      const rows = json.results ?? [];
      if (rows.length > 0) {
        console.log(`  CMS cardiac dataset ${id}: ${rows.length} records (total: ${json.count ?? "?"})`);
        return rows;
      }
      console.log(`  Dataset ${id} returned 0 records`);
    } catch (err) {
      console.log(`  CMS cardiac dataset ${id} unavailable: ${(err as Error).message}`);
    }
  }
  return [];
}

async function runCmsCardiacPhase(
  dbRows: DbHospital[],
  matches: EnrichmentMatch[],
): Promise<number> {
  console.log("\n[Phase 2] CMS Cardiac dataset...");

  const cardiacRecords = await fetchCmsCardiacHospitals();
  if (cardiacRecords.length === 0) {
    console.log("  CMS cardiac data unavailable — skipping");
    return 0;
  }

  // Build a state-bucketed lookup for efficient matching
  const byState = new Map<string, typeof dbRows>();
  for (const row of dbRows) {
    if (row.pciCapability) continue; // Already has data
    const st = row.state.toUpperCase();
    if (!byState.has(st)) byState.set(st, []);
    byState.get(st)!.push(row);
  }

  let matched = 0;
  const seen = new Set<string>();

  for (const rec of cardiacRecords) {
    const srcName = String(rec.facility_name ?? rec.name ?? "").trim();
    const srcState = String(rec.state ?? "").toUpperCase().trim();
    if (!srcName || !srcState) continue;

    const srcLat = rec.lat ?? rec.latitude;
    const srcLon = rec.lon ?? rec.longitude;
    const lat = srcLat != null ? parseFloat(String(srcLat)) : null;
    const lon = srcLon != null ? parseFloat(String(srcLon)) : null;

    const candidates = byState.get(srcState) ?? [];
    let bestScore: { confidence: Confidence; distanceKm: number } | null = null;
    let bestHosp: DbHospital | null = null;

    for (const hosp of candidates) {
      const score = scoreMatch(hosp, srcName, lat, lon);
      if (!score) continue;
      if (!bestScore || confidenceRank(score.confidence) > confidenceRank(bestScore.confidence)) {
        bestScore = score;
        bestHosp = hosp;
      }
    }

    if (bestHosp && bestScore && !seen.has(bestHosp.cmsId)) {
      seen.add(bestHosp.cmsId);
      matches.push({
        cmsId: bestHosp.cmsId,
        hospitalName: bestHosp.hospitalName,
        state: bestHosp.state,
        field: "pciCapability",
        matchedValue: "PCI Capable - Cardiac Catheterization Lab",
        confidence: bestScore.confidence,
        distanceKm: bestScore.distanceKm,
        source: "cms-cardiac",
      });
      matched++;
    }
  }

  console.log(`  Matched ${matched} hospitals for PCI capability`);
  return matched;
}

// ─── Phase 3 – TJC Stroke Centers ────────────────────────────────────────────

interface TjcRecord {
  name?: string;
  organizationName?: string;
  facilityName?: string;
  state?: string;
  certificationProgram?: string;
  program?: string;
  level?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  [key: string]: unknown;
}

function tjcProgramToValue(rec: TjcRecord): string | null {
  const prog = String(
    rec.certificationProgram ?? rec.program ?? rec.level ?? ""
  ).toLowerCase();
  if (prog.includes("comprehensive") || prog.includes("csc")) return "Comprehensive Stroke Center";
  if (prog.includes("thrombectomy") || prog.includes("tsc")) return "Thrombectomy-Capable Stroke Center";
  if (prog.includes("primary") || prog.includes("psc")) return "Primary Stroke Center";
  if (prog.includes("acute") || prog.includes("ready") || prog.includes("asrh")) return "Acute Stroke Ready Hospital";
  // If we got a record with no recognisable level, treat as Primary
  return "Primary Stroke Center";
}

async function fetchTjcStrokeCenters(): Promise<TjcRecord[]> {
  const attempts = [
    // Try JSON API variations with browser-like User-Agent
    {
      url: "https://www.qualitycheck.org/certifiedorganizations/?qtype=DiseaseConditions&dccType=Advanced+Certification+in+Comprehensive+Stroke+Centers&format=json",
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Referer: "https://www.qualitycheck.org/",
      },
    },
    {
      url: "https://www.qualitycheck.org/api/certifiedorganizations/search?program=stroke",
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://www.qualitycheck.org/certifiedorganizations/",
      },
    },
    {
      url: "https://www.qualitycheck.org/certifiedorganizations/?qtype=DiseaseConditions&state=All&search=name",
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        Referer: "https://www.qualitycheck.org/",
      },
    },
  ];

  for (const { url, headers } of attempts) {
    try {
      console.log(`  Trying TJC endpoint: ${url.substring(0, 80)}...`);
      const res = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        headers,
        redirect: "follow",
      });
      if (!res.ok) { console.log(`  TJC → HTTP ${res.status}`); continue; }
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("json")) { console.log(`  TJC → non-JSON (${ct.split(";")[0]})`); continue; }
      const json = await res.json();
      const arr = Array.isArray(json) ? json
        : Array.isArray((json as any)?.data) ? (json as any).data
        : Array.isArray((json as any)?.results) ? (json as any).results
        : Array.isArray((json as any)?.organizations) ? (json as any).organizations
        : null;
      if (arr && arr.length > 0) {
        console.log(`  TJC: ${arr.length} records`);
        return arr as TjcRecord[];
      }
      console.log(`  TJC → unrecognised JSON shape`);
    } catch (err) {
      console.log(`  TJC unavailable: ${(err as Error).message}`);
    }
  }

  console.log("  TJC: all endpoints unavailable — stroke designations require manual CSV entry");
  return [];
}

async function runTjcStrokePhase(
  dbRows: DbHospital[],
  matches: EnrichmentMatch[],
): Promise<number> {
  console.log("\n[Phase 3] TJC Stroke Centers...");
  const tjcRecords = await fetchTjcStrokeCenters();
  if (tjcRecords.length === 0) return 0;

  const byState = new Map<string, DbHospital[]>();
  for (const row of dbRows) {
    if (row.strokeDesignation) continue;
    const st = row.state.toUpperCase();
    if (!byState.has(st)) byState.set(st, []);
    byState.get(st)!.push(row);
  }

  let matched = 0;
  const seen = new Set<string>();

  for (const rec of tjcRecords) {
    const srcName = String(rec.organizationName ?? rec.facilityName ?? rec.name ?? "").trim();
    const srcState = String(rec.state ?? "").toUpperCase().trim();
    if (!srcName || !srcState) continue;

    const lat = rec.latitude != null ? parseFloat(String(rec.latitude)) : null;
    const lon = rec.longitude != null ? parseFloat(String(rec.longitude)) : null;
    const val = tjcProgramToValue(rec);
    if (!val) continue;

    const candidates = byState.get(srcState) ?? [];
    let best: { score: { confidence: Confidence; distanceKm: number }; hosp: DbHospital } | null = null;

    for (const hosp of candidates) {
      const score = scoreMatch(hosp, srcName, isNaN(lat!) ? null : lat, isNaN(lon!) ? null : lon);
      if (!score) continue;
      if (!best || confidenceRank(score.confidence) > confidenceRank(best.score.confidence)) {
        best = { score, hosp };
      }
    }

    if (best && !seen.has(best.hosp.cmsId)) {
      seen.add(best.hosp.cmsId);
      matches.push({
        cmsId: best.hosp.cmsId,
        hospitalName: best.hosp.hospitalName,
        state: best.hosp.state,
        field: "strokeDesignation",
        matchedValue: val,
        confidence: best.score.confidence,
        distanceKm: best.score.distanceKm,
        source: "tjc",
      });
      matched++;
    }
  }

  console.log(`  Matched ${matched} hospitals for stroke designation`);
  return matched;
}

// ─── Phase 4 – ABA Burn Centers ───────────────────────────────────────────────

interface AbaRecord {
  name?: string;
  title?: string;
  post_title?: string;
  state?: string;
  acf?: { state?: string; address?: { state?: string } };
  latitude?: number | string | null;
  longitude?: number | string | null;
  type?: string;
  center_type?: string;
  [key: string]: unknown;
}

async function fetchAbaBurnCenters(): Promise<AbaRecord[]> {
  const attempts = [
    // WordPress REST API — ameriburn.org is a WP site
    "https://ameriburn.org/wp-json/wp/v2/posts?per_page=100&categories=burn-center",
    "https://ameriburn.org/wp-json/wp/v2/burn_center?per_page=200",
    "https://ameriburn.org/wp-json/wp/v2/locations?per_page=200",
    "https://findaburncenter.ameriburn.org/api/centers",
    "https://findaburncenter.ameriburn.org/api/locations",
    // Generic JSON fallback
    "https://ameriburn.org/api/burn-centers",
  ];

  for (const url of attempts) {
    try {
      console.log(`  Trying ABA endpoint: ${url}`);
      const res = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        redirect: "follow",
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
      });
      if (!res.ok) { console.log(`  ABA → HTTP ${res.status}`); continue; }
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("json")) { console.log(`  ABA → non-JSON (${ct.split(";")[0]})`); continue; }
      const json = await res.json();
      const arr = Array.isArray(json) ? json
        : Array.isArray((json as any)?.data) ? (json as any).data
        : Array.isArray((json as any)?.results) ? (json as any).results
        : null;
      if (arr && arr.length > 0) {
        console.log(`  ABA: ${arr.length} records from ${url}`);
        return arr as AbaRecord[];
      }
    } catch (err) {
      console.log(`  ABA unavailable (${url}): ${(err as Error).message}`);
    }
  }

  console.log("  ABA: all endpoints unavailable — burn designations require manual CSV entry");
  return [];
}

function abaRecordState(rec: AbaRecord): string {
  return String(
    rec.state ?? rec.acf?.state ?? rec.acf?.address?.state ?? ""
  ).toUpperCase().trim();
}

function abaRecordName(rec: AbaRecord): string {
  return String(rec.name ?? rec.title ?? rec.post_title ?? "").trim();
}

function abaBurnValue(rec: AbaRecord): string {
  const type = String(rec.type ?? rec.center_type ?? "").toLowerCase();
  if (type.includes("pediatric") || type.includes("children")) return "Verified Pediatric Burn Center";
  return "Verified Burn Center";
}

async function runAbaBurnPhase(
  dbRows: DbHospital[],
  matches: EnrichmentMatch[],
): Promise<number> {
  console.log("\n[Phase 4] ABA Burn Centers...");
  const abaRecords = await fetchAbaBurnCenters();
  if (abaRecords.length === 0) return 0;

  const byState = new Map<string, DbHospital[]>();
  for (const row of dbRows) {
    if (row.burnDesignation) continue;
    const st = row.state.toUpperCase();
    if (!byState.has(st)) byState.set(st, []);
    byState.get(st)!.push(row);
  }

  let matched = 0;
  const seen = new Set<string>();

  for (const rec of abaRecords) {
    const srcName = abaRecordName(rec);
    const srcState = abaRecordState(rec);
    if (!srcName || !srcState) continue;

    const lat = rec.latitude != null ? parseFloat(String(rec.latitude)) : null;
    const lon = rec.longitude != null ? parseFloat(String(rec.longitude)) : null;
    const val = abaBurnValue(rec);

    const candidates = byState.get(srcState) ?? [];
    let best: { score: { confidence: Confidence; distanceKm: number }; hosp: DbHospital } | null = null;

    for (const hosp of candidates) {
      const score = scoreMatch(hosp, srcName, lat != null && !isNaN(lat) ? lat : null, lon != null && !isNaN(lon) ? lon : null);
      if (!score) continue;
      if (!best || confidenceRank(score.confidence) > confidenceRank(best.score.confidence)) {
        best = { score, hosp };
      }
    }

    if (best && !seen.has(best.hosp.cmsId)) {
      seen.add(best.hosp.cmsId);
      matches.push({
        cmsId: best.hosp.cmsId,
        hospitalName: best.hosp.hospitalName,
        state: best.hosp.state,
        field: "burnDesignation",
        matchedValue: val,
        confidence: best.score.confidence,
        distanceKm: best.score.distanceKm,
        source: "aba",
      });
      matched++;
    }
  }

  console.log(`  Matched ${matched} hospitals for burn designation`);
  return matched;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function confidenceRank(c: Confidence): number {
  return c === "HIGH" ? 3 : c === "MEDIUM" ? 2 : 1;
}

function escapeCsv(val: unknown): string {
  if (val == null) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(matches: EnrichmentMatch[]): string {
  const headers = [
    "Hospital Name", "CMS ID", "State", "Field",
    "Matched Value", "Confidence", "Distance KM", "Source",
  ];
  const lines = [headers.join(",")];
  for (const m of matches) {
    lines.push([
      escapeCsv(m.hospitalName),
      escapeCsv(m.cmsId),
      escapeCsv(m.state),
      escapeCsv(m.field),
      escapeCsv(m.matchedValue),
      escapeCsv(m.confidence),
      escapeCsv(m.distanceKm >= 0 ? m.distanceKm.toFixed(2) : "N/A"),
      escapeCsv(m.source),
    ].join(","));
  }
  return lines.join("\r\n");
}

// ─── DB write ─────────────────────────────────────────────────────────────────

/**
 * DB-write eligibility rules:
 *   - HIGH or MEDIUM confidence
 *   - AND distance was actually confirmed:
 *       distanceKm === 0  → internal mining (same hospital record, no proximity needed)
 *       distanceKm  >  0  → external source with coordinates confirmed ≤ 3 km
 *       distanceKm === -1 → no coordinates available → CSV-only, do NOT write to DB
 */
function isEligibleForDb(m: EnrichmentMatch): boolean {
  if (m.confidence !== "HIGH" && m.confidence !== "MEDIUM") return false;
  // distanceKm < 0 means no coordinate data was available — never write
  return m.distanceKm >= 0;
}

async function writeMatchesToDb(matches: EnrichmentMatch[]): Promise<number> {
  const eligible = matches.filter(isEligibleForDb);

  // Group by cmsId so we emit one update per hospital
  const byHosp = new Map<string, Partial<{
    strokeDesignation: string;
    burnDesignation: string;
    pciCapability: string;
  }>>();

  for (const m of eligible) {
    if (!byHosp.has(m.cmsId)) byHosp.set(m.cmsId, {});
    const entry = byHosp.get(m.cmsId)!;
    // Only set if not already set by a higher-confidence match in this run
    if (!entry[m.field]) {
      entry[m.field] = m.matchedValue;
    }
  }

  let written = 0;
  for (const [cmsId, fields] of byHosp) {
    const patch: Partial<{
      strokeDesignation: string | null;
      burnDesignation: string | null;
      pciCapability: string | null;
      updatedAt: Date;
    }> = { updatedAt: new Date() };

    if (fields.strokeDesignation) patch.strokeDesignation = fields.strokeDesignation;
    if (fields.burnDesignation)   patch.burnDesignation   = fields.burnDesignation;
    if (fields.pciCapability)     patch.pciCapability     = fields.pciCapability;

    // Only update if we actually have at least one field to set
    const hasField = fields.strokeDesignation || fields.burnDesignation || fields.pciCapability;
    if (hasField) {
      await db
        .update(hospitalSpecialties)
        .set(patch)
        .where(eq(hospitalSpecialties.cmsId, cmsId));
      written++;
    }
  }

  return written;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runEnrichment(): Promise<EnrichmentResult> {
  console.log("\n===== Specialty Enrichment =====");
  console.log("Loading all hospitals from DB...");

  const dbRows = await db
    .select({
      cmsId: hospitalSpecialties.cmsId,
      hospitalName: hospitalSpecialties.hospitalName,
      state: hospitalSpecialties.state,
      latitude: hospitalSpecialties.latitude,
      longitude: hospitalSpecialties.longitude,
      actualDesignation: hospitalSpecialties.actualDesignation,
      strokeDesignation: hospitalSpecialties.strokeDesignation,
      burnDesignation: hospitalSpecialties.burnDesignation,
      pciCapability: hospitalSpecialties.pciCapability,
    })
    .from(hospitalSpecialties);

  console.log(`Loaded ${dbRows.length} hospitals`);

  const allMatches: EnrichmentMatch[] = [];

  // Run all phases
  await mineInternalDesignations(dbRows as DbHospital[], allMatches);
  await runCmsCardiacPhase(dbRows as DbHospital[], allMatches);
  await runTjcStrokePhase(dbRows as DbHospital[], allMatches);
  await runAbaBurnPhase(dbRows as DbHospital[], allMatches);

  // Write HIGH/MEDIUM matches to DB
  console.log("\nWriting HIGH/MEDIUM confidence matches to DB...");
  const written = await writeMatchesToDb(allMatches);
  console.log(`Wrote ${written} hospital records`);

  // Build result counts
  const strokeMatched = allMatches.filter(
    (m) => m.field === "strokeDesignation" && (m.confidence === "HIGH" || m.confidence === "MEDIUM")
  ).length;
  const burnMatched = allMatches.filter(
    (m) => m.field === "burnDesignation" && (m.confidence === "HIGH" || m.confidence === "MEDIUM")
  ).length;
  const pciMatched = allMatches.filter(
    (m) => m.field === "pciCapability" && (m.confidence === "HIGH" || m.confidence === "MEDIUM")
  ).length;

  // Build and cache CSV
  const csv = buildCsv(allMatches);
  lastEnrichmentCsv = csv;
  lastEnrichmentRunAt = new Date().toISOString();

  console.log(`\n===== Enrichment complete =====`);
  console.log(`Stroke: ${strokeMatched} | Burn: ${burnMatched} | PCI: ${pciMatched}`);
  console.log(`Total matches (all confidence levels): ${allMatches.length}`);
  console.log(`CSV rows exported: ${allMatches.length}`);

  return {
    strokeMatched,
    burnMatched,
    pciMatched,
    total: allMatches.length,
    csvRows: allMatches,
  };
}
