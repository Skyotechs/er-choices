import { pool } from "@workspace/db";
import { runImport } from "./import-cms-hospitals.js";

runImport()
  .then(async () => {
    await pool.end();
    console.log("\nSource tags applied (per-designation in designationSources JSONB):");
    console.log("  acs              → Trauma (HRSA dataset, ACS-intent tag, proximity-gated)");
    console.log("  aba              → Burn centers (applied only if ABA API becomes available)");
    console.log("  joint-commission → Stroke (applied only if TJC API becomes available)");
    console.log("  cms-ipf          → Behavioral Health (CMS Inpatient Psychiatric Facility dataset q9vs-r7wp)");
    console.log("  hrsa             → Trauma (legacy Phase 3, superseded by Phase 4/acs)");
    console.log("  osm              → Heuristic enrichment from OpenStreetMap tags");
    console.log("Note: Phase 3 (hrsa) is intentionally skipped; Phase 4 (acs) supersedes it.");
    console.log("Note: Burn/Stroke remain in admin review until ABA/TJC publish public APIs.");
  })
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  });
