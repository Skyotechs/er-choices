import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { pool } from "@workspace/db";
import { runEnrichment, getEnrichmentCsv } from "./enrich-specialties.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

runEnrichment()
  .then(async (result) => {
    console.log("\nSummary:");
    console.log(`  Stroke matched (HIGH/MEDIUM, confirmed proximity): ${result.strokeMatched}`);
    console.log(`  Burn matched   (HIGH/MEDIUM, confirmed proximity): ${result.burnMatched}`);
    console.log(`  PCI matched    (HIGH/MEDIUM, confirmed proximity): ${result.pciMatched}`);
    console.log(`  Total matches (all levels):                        ${result.total}`);

    const { csv } = getEnrichmentCsv();
    if (csv) {
      const { writeFileSync } = await import("fs");
      // Write to artifacts/api-server/ (one level up from scripts/)
      const outPath = join(__dirname, "..", "specialty-enrichment-review.csv");
      writeFileSync(outPath, csv, "utf8");
      console.log(`\nVerification CSV written to: ${outPath}`);
    }

    await pool.end();
  })
  .catch(async (err) => {
    console.error("Enrichment failed:", err);
    await pool.end();
    process.exit(1);
  });
