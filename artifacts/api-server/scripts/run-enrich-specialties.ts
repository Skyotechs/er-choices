import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { writeFileSync } from "fs";
import { pool } from "@workspace/db";
import { runEnrichment, buildEnrichmentCsv } from "./enrich-specialties.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Write CSV to artifacts/api-server/ (one level up from scripts/)
const CSV_PATH = join(__dirname, "..", "specialty-enrichment-review.csv");

runEnrichment()
  .then(async (result) => {
    const csv = buildEnrichmentCsv(result.matches);
    writeFileSync(CSV_PATH, csv, "utf8");

    console.log("\nSummary:");
    console.log(`  Stroke written to DB (confirmed proximity): ${result.strokeWritten}`);
    console.log(`  Burn written to DB   (confirmed proximity): ${result.burnWritten}`);
    console.log(`  PCI written to DB    (confirmed proximity): ${result.pciWritten}`);
    console.log(`  Total matches (all levels, see CSV):        ${result.total}`);
    console.log(`  Verification CSV written to: ${CSV_PATH}`);

    // Emit structured result for the parent API process to parse
    process.stdout.write(
      "\nENRICHMENT_RESULT:" +
        JSON.stringify({
          strokeWritten: result.strokeWritten,
          burnWritten:   result.burnWritten,
          pciWritten:    result.pciWritten,
          total:         result.total,
        }) +
        "\n",
    );

    await pool.end();
  })
  .catch(async (err) => {
    console.error("Enrichment failed:", err);
    await pool.end();
    process.exit(1);
  });
