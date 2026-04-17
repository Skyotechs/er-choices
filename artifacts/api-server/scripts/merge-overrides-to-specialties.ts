/**
 * One-time migration: merge hospital_overrides into hospital_specialties.
 *
 * The old admin system stored phone/lat/lon corrections in a separate
 * `hospital_overrides` table.  The new admin dashboard reads and writes
 * directly to `hospital_specialties`, so any hospital with an old override
 * record will show the original (wrong) values in the edit form, and a save
 * through the new UI will silently lose the override.
 *
 * This script copies every non-null override value back into the matching
 * `hospital_specialties` row so the edit form pre-fills correctly.
 *
 * After the migration:
 *  - hospital_overrides is kept in place for backward-compat reads by the
 *    nearby-hospitals API (which still LEFT JOINs it), but the override
 *    fields are nulled out so they no longer shadow the freshly-written
 *    hospital_specialties values.
 *  - No new writes go to hospital_overrides (the PATCH endpoints already
 *    clear override fields after writing to hospital_specialties).
 *
 * Safe to re-run: each hospital is processed independently; rows that have
 * already been cleared will simply produce a no-op update.
 */

import { db, hospitalOverrides, hospitalSpecialties } from "@workspace/db";
import { asc, eq, or } from "drizzle-orm";

function normaliseOsmId(rawId: string): string {
  if (rawId.startsWith("osm-")) return rawId;
  return "osm-" + rawId.replace("/", "-");
}

/**
 * hospital_overrides always uses the app format (osm-*).
 * hospital_specialties may store raw format (node/...) or app format.
 * Build both candidate strings so we can match either way.
 */
function buildOsmIdVariants(appFormatId: string): string[] {
  const variants: string[] = [appFormatId];
  // "osm-node-12345" → "node/12345"
  const rawVariant = appFormatId.replace(/^osm-/, "").replace(/-/, "/");
  if (rawVariant !== appFormatId) variants.push(rawVariant);
  return variants;
}

async function main() {
  console.log("Fetching all rows from hospital_overrides …");
  const overrides = await db.select().from(hospitalOverrides);
  console.log(`Found ${overrides.length} override row(s).`);

  let matched = 0;
  let skipped = 0;
  let notFound = 0;

  for (const ov of overrides) {
    const appId = normaliseOsmId(ov.osmId);
    const idVariants = buildOsmIdVariants(appId);

    // Find the hospital_specialties row(s) by any osmId variant.
    // Ordered by id ascending so the lowest-id row is always selected first,
    // giving deterministic behavior in the unlikely event of duplicates.
    const whereClause =
      idVariants.length === 1
        ? eq(hospitalSpecialties.osmId, idVariants[0])
        : or(...idVariants.map((v) => eq(hospitalSpecialties.osmId, v)));

    const matches = await db
      .select({ id: hospitalSpecialties.id, osmId: hospitalSpecialties.osmId })
      .from(hospitalSpecialties)
      .where(whereClause)
      .orderBy(asc(hospitalSpecialties.id))
      .limit(5); // grab a few to detect duplicates

    if (matches.length === 0) {
      console.warn(`  [WARN] No hospital_specialties row found for osmId "${ov.osmId}" (tried: ${idVariants.join(", ")})`);
      notFound++;
      continue;
    }

    // Warn if multiple rows share the same osmId (schema has no unique constraint on osmId).
    // The lowest-id row (first in the ordered result) is used; the others are left untouched.
    if (matches.length > 1) {
      const allIds = matches.map((m) => m.id).join(", ");
      console.warn(
        `  [WARN] ${matches.length} hospital_specialties rows found for osmId "${ov.osmId}" (ids: ${allIds}). ` +
          `Applying override to id=${matches[0].id} only.`
      );
    }

    const existing = matches[0];

    // Only update fields that have non-null override values
    const patch: { phone?: string; latitude?: number; longitude?: number; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (ov.phone !== null && ov.phone !== undefined) patch.phone = ov.phone;
    if (ov.latitude !== null && ov.latitude !== undefined) patch.latitude = ov.latitude;
    if (ov.longitude !== null && ov.longitude !== undefined) patch.longitude = ov.longitude;

    if (Object.keys(patch).length === 1) {
      // Only updatedAt — nothing to migrate
      console.log(`  [SKIP] osmId "${ov.osmId}" — all override fields are null, nothing to migrate.`);
      skipped++;
      continue;
    }

    console.log(
      `  [UPDATE] hospital id=${existing.id} osmId="${existing.osmId}" ←` +
        (ov.phone !== null ? ` phone="${ov.phone}"` : "") +
        (ov.latitude !== null ? ` lat=${ov.latitude}` : "") +
        (ov.longitude !== null ? ` lon=${ov.longitude}` : "")
    );

    await db
      .update(hospitalSpecialties)
      .set(patch)
      .where(eq(hospitalSpecialties.id, existing.id));

    // Null-out the override fields so hospital_overrides no longer shadows
    // the freshly-written hospital_specialties values during the LEFT JOIN
    // in the nearby-hospitals API.
    const clearPatch: { phone?: null; latitude?: null; longitude?: null } = {};
    if (ov.phone !== null && ov.phone !== undefined) clearPatch.phone = null;
    if (ov.latitude !== null && ov.latitude !== undefined) clearPatch.latitude = null;
    if (ov.longitude !== null && ov.longitude !== undefined) clearPatch.longitude = null;

    if (Object.keys(clearPatch).length > 0) {
      await db
        .update(hospitalOverrides)
        .set(clearPatch)
        .where(eq(hospitalOverrides.id, ov.id));
    }

    matched++;
  }

  console.log("\n── Migration complete ──────────────────────────────────────────");
  console.log(`  Updated : ${matched}`);
  console.log(`  Skipped : ${skipped}  (all override fields were null)`);
  console.log(`  Not found: ${notFound}  (no matching hospital_specialties row)`);
  console.log("hospital_overrides rows are kept; override fields have been nulled");
  console.log("out so hospital_specialties values take effect immediately.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
