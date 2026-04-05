import { pool } from "@workspace/db";
import { runEnrichment, getEnrichmentCsv } from "./enrich-specialties.js";

runEnrichment()
  .then(async (result) => {
    console.log("\nSummary:");
    console.log(`  Stroke matched (HIGH/MEDIUM): ${result.strokeMatched}`);
    console.log(`  Burn matched   (HIGH/MEDIUM): ${result.burnMatched}`);
    console.log(`  PCI matched    (HIGH/MEDIUM): ${result.pciMatched}`);
    console.log(`  Total matches (all levels):   ${result.total}`);

    const { csv } = getEnrichmentCsv();
    if (csv) {
      const { writeFileSync } = await import("fs");
      const { join } = await import("path");
      const outPath = join(process.cwd(), "specialty-enrichment-review.csv");
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
