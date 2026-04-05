/**
 * Specialty Enrichment Script
 *
 * Populates strokeDesignation, burnDesignation, and pciCapability from multiple sources:
 *
 * Phase 1 – Internal mining:
 *   Reads actualDesignation text for stroke/burn/PCI keywords (always runs).
 *   Same-record update → confidence = HIGH, distanceKm = 0 (confirmed, no proxy needed).
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
 * DB write eligibility:
 *   Only HIGH or MEDIUM confidence matches where distanceKm >= 0 (proximity confirmed,
 *   or internal mining where distanceKm = 0 by convention).
 *   Name-only matches with no source coordinates (distanceKm = -1) are CSV-only.
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
  /** Matches written to DB (HIGH/MEDIUM + confirmed proximity) */
  strokeWritten: number;
  burnWritten: number;
  pciWritten: number;
  /** All matches including LOW confidence and unconfirmed proximity — for CSV export */
  total: number;
  /** Raw match list — available for callers that need to build a CSV */
  matches: EnrichmentMatch[];
}

// ─── Confidence scoring ───────────────────────────────────────────────────────

/**
 * Compute confidence for a source record matching a DB hospital.
 *
 * With coordinates:  HIGH = nameScore ≥ 0.70 && dist ≤ 3 km
 *                    MEDIUM = nameScore ≥ 0.50 && dist ≤ 3 km
 *                    LOW = nameScore ≥ 0.50 && dist ≤ 8 km
 *
 * Without coords:    distanceKm = -1 (sentinel for "not confirmed")
 *                    MEDIUM = nameScore ≥ 0.70  (name-state match, no proximity gate)
 *                    LOW = nameScore ≥ 0.50
 *                    → neither is written to DB (isEligibleForDb gates on distanceKm ≥ 0)
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

  // No proximity data — use -1 as sentinel so isEligibleForDb skips these
  const distKm = -1;
  if (ns >= 0.70) return { confidence: "MEDIUM", distanceKm: distKm };
  return { confidence: "LOW", distanceKm: distKm };
}

// ─── Phase 1 – Internal mining ────────────────────────────────────────────────

const STROKE_KEYWORD_MAP: Array<[RegExp, string]> = [
  [/comprehensive\s+stroke/i,   "Comprehensive Stroke Center"],
  [/thrombectomy.?capable/i,    "Thrombectomy-Capable Stroke Center"],
  [/primary\s+stroke/i,         "Primary Stroke Center"],
  [/acute\s+stroke\s+ready/i,   "Acute Stroke Ready Hospital"],
  [/stroke\s+center/i,          "Primary Stroke Center"],
  [/stroke/i,                   "Stroke Center"],
];

const BURN_KEYWORD_MAP: Array<[RegExp, string]> = [
  [/pediatric\s+burn/i, "Verified Pediatric Burn Center"],
  [/burn\s+center/i,    "Verified Burn Center"],
  [/burn\s+unit/i,      "Verified Burn Center"],
  [/burn/i,             "Verified Burn Center"],
];

const PCI_KEYWORD_MAP: Array<[RegExp, string]> = [
  [/pci[- ]capable/i,   "PCI Capable"],
  [/stemi\s+receiv/i,   "STEMI Receiving Center"],
  [/stemi/i,            "STEMI Receiving Center"],
  [/cardiac\s+cath/i,   "Cardiac Catheterization Lab"],
  [/pci/i,              "PCI Capable"],
];

function extractStroke(text: string): string | null {
  for (const [re, val] of STROKE_KEYWORD_MAP) if (re.test(text)) return val;
  return null;
}
function extractBurn(text: string): string | null {
  for (const [re, val] of BURN_KEYWORD_MAP) if (re.test(text)) return val;
  return null;
}
function extractPci(text: string): string | null {
  for (const [re, val] of PCI_KEYWORD_MAP) if (re.test(text)) return val;
  return null;
}

async function mineInternalDesignations(
  rows: DbHospital[],
  matches: EnrichmentMatch[],
): Promise<void> {
  console.log("\n[Phase 1] Mining existing actualDesignation field...");
  let stroke = 0, burn = 0, pci = 0;

  for (const row of rows) {
    if (!row.actualDesignation) continue;
    const text = row.actualDesignation;

    if (!row.strokeDesignation) {
      const val = extractStroke(text);
      if (val) {
        matches.push({
          cmsId: row.cmsId, hospitalName: row.hospitalName, state: row.state,
          field: "strokeDesignation", matchedValue: val,
          confidence: "HIGH",
          distanceKm: 0,  // same hospital — proximity confirmed by definition
          source: "internal",
        });
        stroke++;
      }
    }
    if (!row.burnDesignation) {
      const val = extractBurn(text);
      if (val) {
        matches.push({
          cmsId: row.cmsId, hospitalName: row.hospitalName, state: row.state,
          field: "burnDesignation", matchedValue: val,
          confidence: "HIGH", distanceKm: 0, source: "internal",
        });
        burn++;
      }
    }
    if (!row.pciCapability) {
      const val = extractPci(text);
      if (val) {
        matches.push({
          cmsId: row.cmsId, hospitalName: row.hospitalName, state: row.state,
          field: "pciCapability", matchedValue: val,
          confidence: "HIGH", distanceKm: 0, source: "internal",
        });
        pci++;
      }
    }
  }

  console.log(`  Extracted: ${stroke} stroke, ${burn} burn, ${pci} PCI from actualDesignation`);
}

// ─── Helpers shared by Phases 2-4 ────────────────────────────────────────────

function confidenceRank(c: Confidence): number {
  return c === "HIGH" ? 3 : c === "MEDIUM" ? 2 : 1;
}

/** Narrow unknown JSON response to an array of items or null. */
function toArray(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (raw !== null && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj["results"])) return obj["results"] as unknown[];
    if (Array.isArray(obj["data"]))    return obj["data"]    as unknown[];
    if (Array.isArray(obj["organizations"])) return obj["organizations"] as unknown[];
    if (Array.isArray(obj["centers"])) return obj["centers"] as unknown[];
  }
  return null;
}

function safeStr(val: unknown): string {
  return val != null ? String(val).trim() : "";
}

function safeFloat(val: unknown): number | null {
  if (val == null) return null;
  const n = parseFloat(String(val));
  return isNaN(n) ? null : n;
}

// ─── Phase 2 – CMS Cardiac dataset ───────────────────────────────────────────

async function runCmsCardiacPhase(
  dbRows: DbHospital[],
  matches: EnrichmentMatch[],
): Promise<void> {
  console.log("\n[Phase 2] CMS Cardiac dataset...");

  const datasets = ["bzsr-4my4", "77k9-qc49"];
  let records: unknown[] | null = null;

  for (const id of datasets) {
    const url = `https://data.cms.gov/provider-data/api/1/datastore/query/${id}/0?limit=5000`;
    try {
      console.log(`  Trying CMS cardiac dataset: ${id}`);
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        headers: { Accept: "application/json" },
      });
      if (!res.ok) { console.log(`  Dataset ${id} → HTTP ${res.status}`); continue; }
      const raw: unknown = await res.json();
      const arr = toArray(raw);
      if (arr && arr.length > 0) {
        console.log(`  CMS cardiac dataset ${id}: ${arr.length} records`);
        records = arr;
        break;
      }
      console.log(`  Dataset ${id} → 0 records`);
    } catch (err) {
      console.log(`  CMS cardiac dataset ${id} unavailable: ${(err as Error).message}`);
    }
  }

  if (!records) { console.log("  CMS cardiac data unavailable — skipping"); return; }

  const byState = new Map<string, DbHospital[]>();
  for (const row of dbRows) {
    if (row.pciCapability) continue;
    const st = row.state.toUpperCase();
    if (!byState.has(st)) byState.set(st, []);
    byState.get(st)!.push(row);
  }

  let matched = 0;
  const seen = new Set<string>();

  for (const rec of records) {
    if (rec === null || typeof rec !== "object") continue;
    const obj = rec as Record<string, unknown>;
    const srcName  = safeStr(obj["facility_name"] ?? obj["name"]);
    const srcState = safeStr(obj["state"]).toUpperCase();
    if (!srcName || !srcState) continue;

    const lat = safeFloat(obj["lat"] ?? obj["latitude"]);
    const lon = safeFloat(obj["lon"] ?? obj["longitude"]);

    const candidates = byState.get(srcState) ?? [];
    let best: { score: { confidence: Confidence; distanceKm: number }; hosp: DbHospital } | null = null;

    for (const hosp of candidates) {
      const score = scoreMatch(hosp, srcName, lat, lon);
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
        field: "pciCapability",
        matchedValue: "PCI Capable - Cardiac Catheterization Lab",
        confidence: best.score.confidence,
        distanceKm: best.score.distanceKm,
        source: "cms-cardiac",
      });
      matched++;
    }
  }

  console.log(`  Matched ${matched} hospitals for PCI capability`);
}

// ─── Phase 3 – TJC Stroke Centers ────────────────────────────────────────────

function tjcProgramToValue(obj: Record<string, unknown>): string | null {
  const prog = safeStr(obj["certificationProgram"] ?? obj["program"] ?? obj["level"]).toLowerCase();
  if (prog.includes("comprehensive") || prog.includes("csc")) return "Comprehensive Stroke Center";
  if (prog.includes("thrombectomy") || prog.includes("tsc")) return "Thrombectomy-Capable Stroke Center";
  if (prog.includes("primary") || prog.includes("psc")) return "Primary Stroke Center";
  if (prog.includes("acute") || prog.includes("ready") || prog.includes("asrh")) return "Acute Stroke Ready Hospital";
  if (prog) return "Primary Stroke Center";
  return null;
}

async function fetchTjcStrokeCenters(): Promise<unknown[] | null> {
  const attempts: Array<{ url: string; headers: Record<string, string> }> = [
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
      const raw: unknown = await res.json();
      const arr = toArray(raw);
      if (arr && arr.length > 0) { console.log(`  TJC: ${arr.length} records`); return arr; }
      console.log(`  TJC → unrecognised JSON shape`);
    } catch (err) {
      console.log(`  TJC unavailable: ${(err as Error).message}`);
    }
  }
  console.log("  TJC: all endpoints unavailable — stroke designations require manual CSV entry");
  return null;
}

async function runTjcStrokePhase(
  dbRows: DbHospital[],
  matches: EnrichmentMatch[],
): Promise<void> {
  console.log("\n[Phase 3] TJC Stroke Centers...");
  const records = await fetchTjcStrokeCenters();
  if (!records) return;

  const byState = new Map<string, DbHospital[]>();
  for (const row of dbRows) {
    if (row.strokeDesignation) continue;
    const st = row.state.toUpperCase();
    if (!byState.has(st)) byState.set(st, []);
    byState.get(st)!.push(row);
  }

  let matched = 0;
  const seen = new Set<string>();

  for (const rec of records) {
    if (rec === null || typeof rec !== "object") continue;
    const obj = rec as Record<string, unknown>;
    const srcName  = safeStr(obj["organizationName"] ?? obj["facilityName"] ?? obj["name"]);
    const srcState = safeStr(obj["state"]).toUpperCase();
    if (!srcName || !srcState) continue;

    const lat = safeFloat(obj["latitude"]);
    const lon = safeFloat(obj["longitude"]);
    const val = tjcProgramToValue(obj);
    if (!val) continue;

    const candidates = byState.get(srcState) ?? [];
    let best: { score: { confidence: Confidence; distanceKm: number }; hosp: DbHospital } | null = null;

    for (const hosp of candidates) {
      const score = scoreMatch(hosp, srcName, lat, lon);
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
}

// ─── Phase 4 – ABA Burn Centers ───────────────────────────────────────────────

async function fetchAbaBurnCenters(): Promise<unknown[] | null> {
  const urls = [
    "https://ameriburn.org/wp-json/wp/v2/posts?per_page=100&categories=burn-center",
    "https://ameriburn.org/wp-json/wp/v2/burn_center?per_page=200",
    "https://ameriburn.org/wp-json/wp/v2/locations?per_page=200",
    "https://findaburncenter.ameriburn.org/api/centers",
    "https://findaburncenter.ameriburn.org/api/locations",
    "https://ameriburn.org/api/burn-centers",
  ];

  for (const url of urls) {
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
      const raw: unknown = await res.json();
      const arr = toArray(raw);
      if (arr && arr.length > 0) { console.log(`  ABA: ${arr.length} records from ${url}`); return arr; }
    } catch (err) {
      console.log(`  ABA unavailable (${url}): ${(err as Error).message}`);
    }
  }
  console.log("  ABA: all endpoints unavailable — burn designations require manual CSV entry");
  return null;
}

function abaBurnValue(obj: Record<string, unknown>): string {
  const type = safeStr(obj["type"] ?? obj["center_type"]).toLowerCase();
  if (type.includes("pediatric") || type.includes("children")) return "Verified Pediatric Burn Center";
  return "Verified Burn Center";
}

function abaState(obj: Record<string, unknown>): string {
  const acf = obj["acf"];
  if (acf !== null && typeof acf === "object") {
    const acfObj = acf as Record<string, unknown>;
    const direct = safeStr(acfObj["state"]);
    if (direct) return direct.toUpperCase();
    const addr = acfObj["address"];
    if (addr !== null && typeof addr === "object") {
      const st = safeStr((addr as Record<string, unknown>)["state"]);
      if (st) return st.toUpperCase();
    }
  }
  return safeStr(obj["state"]).toUpperCase();
}

async function runAbaBurnPhase(
  dbRows: DbHospital[],
  matches: EnrichmentMatch[],
): Promise<void> {
  console.log("\n[Phase 4] ABA Burn Centers...");
  const records = await fetchAbaBurnCenters();
  if (!records) return;

  const byState = new Map<string, DbHospital[]>();
  for (const row of dbRows) {
    if (row.burnDesignation) continue;
    const st = row.state.toUpperCase();
    if (!byState.has(st)) byState.set(st, []);
    byState.get(st)!.push(row);
  }

  let matched = 0;
  const seen = new Set<string>();

  for (const rec of records) {
    if (rec === null || typeof rec !== "object") continue;
    const obj = rec as Record<string, unknown>;
    const srcName  = safeStr(obj["name"] ?? obj["title"] ?? obj["post_title"]);
    const srcState = abaState(obj);
    if (!srcName || !srcState) continue;

    const lat = safeFloat(obj["latitude"]);
    const lon = safeFloat(obj["longitude"]);
    const val = abaBurnValue(obj);

    const candidates = byState.get(srcState) ?? [];
    let best: { score: { confidence: Confidence; distanceKm: number }; hosp: DbHospital } | null = null;

    for (const hosp of candidates) {
      const score = scoreMatch(hosp, srcName, lat, lon);
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
}

// ─── CSV builder ─────────────────────────────────────────────────────────────

function escapeCsv(val: unknown): string {
  if (val == null) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildEnrichmentCsv(matches: EnrichmentMatch[]): string {
  const headers = [
    "Hospital Name", "CMS ID", "State", "Field",
    "Matched Value", "Confidence", "Distance KM", "Source", "Written To DB",
  ];
  const lines = [headers.join(",")];
  for (const m of matches) {
    const writtenToDb = isEligibleForDb(m) ? "YES" : "NO";
    lines.push([
      escapeCsv(m.hospitalName),
      escapeCsv(m.cmsId),
      escapeCsv(m.state),
      escapeCsv(m.field),
      escapeCsv(m.matchedValue),
      escapeCsv(m.confidence),
      escapeCsv(m.distanceKm >= 0 ? m.distanceKm.toFixed(2) : "N/A"),
      escapeCsv(m.source),
      escapeCsv(writtenToDb),
    ].join(","));
  }
  return lines.join("\r\n");
}

// ─── DB write ─────────────────────────────────────────────────────────────────

/**
 * DB-write eligibility rules:
 *   - HIGH or MEDIUM confidence
 *   - AND distance was actually confirmed:
 *       distanceKm === 0  → internal mining (same hospital record, no proximity gate needed)
 *       distanceKm  >  0  → external source with coordinates confirmed ≤ 3 km
 *       distanceKm === -1 → no coordinates available → CSV-only, do NOT write to DB
 */
export function isEligibleForDb(m: EnrichmentMatch): boolean {
  if (m.confidence !== "HIGH" && m.confidence !== "MEDIUM") return false;
  return m.distanceKm >= 0;
}

async function writeMatchesToDb(matches: EnrichmentMatch[]): Promise<number> {
  const eligible = matches.filter(isEligibleForDb);

  const byHosp = new Map<string, Partial<{
    strokeDesignation: string;
    burnDesignation: string;
    pciCapability: string;
  }>>();

  for (const m of eligible) {
    if (!byHosp.has(m.cmsId)) byHosp.set(m.cmsId, {});
    const entry = byHosp.get(m.cmsId)!;
    if (!entry[m.field]) entry[m.field] = m.matchedValue;
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

    if (fields.strokeDesignation || fields.burnDesignation || fields.pciCapability) {
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

  await mineInternalDesignations(dbRows as DbHospital[], allMatches);
  await runCmsCardiacPhase(dbRows as DbHospital[], allMatches);
  await runTjcStrokePhase(dbRows as DbHospital[], allMatches);
  await runAbaBurnPhase(dbRows as DbHospital[], allMatches);

  console.log("\nWriting eligible (HIGH/MEDIUM + confirmed proximity) matches to DB...");
  const written = await writeMatchesToDb(allMatches);
  console.log(`Wrote ${written} hospital records`);

  // Counts: only matches that were actually written (eligible for DB)
  const eligible = allMatches.filter(isEligibleForDb);
  const strokeWritten = eligible.filter((m) => m.field === "strokeDesignation").length;
  const burnWritten   = eligible.filter((m) => m.field === "burnDesignation").length;
  const pciWritten    = eligible.filter((m) => m.field === "pciCapability").length;

  console.log(`\n===== Enrichment complete =====`);
  console.log(`Written to DB — Stroke: ${strokeWritten} | Burn: ${burnWritten} | PCI: ${pciWritten}`);
  console.log(`Total matches (all confidence levels, exported to CSV): ${allMatches.length}`);

  return {
    strokeWritten,
    burnWritten,
    pciWritten,
    total: allMatches.length,
    matches: allMatches,
  };
}
