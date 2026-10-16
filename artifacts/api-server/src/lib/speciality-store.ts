import { sql } from "drizzle-orm";
import { hospitalSpecialties } from "@workspace/db";
import { SPECIALITY_KEY, readSpecialityState, specialityCategories, verifiedSpecialityEntries } from "@workspace/speciality";

/**
 * Namespaced in existing per-classification provenance JSON, not in legacy
 * specialty strings. No schema change, backfill, or startup migration needed.
 */
export function specialityProvenanceUpdate(state: unknown) {
  return sql`jsonb_set(COALESCE(${hospitalSpecialties.designationSources}, '{}'::jsonb),
    ARRAY[${SPECIALITY_KEY}]::text[], ${JSON.stringify(state)}::jsonb, true)`;
}

/** Imports may replace legacy source tags, but never the reviewed namespace.
 * Read the namespace in the UPDATE itself, not from a stale import snapshot.
 */
export function preserveSpecialityReview(legacySources: unknown) {
  const sources = legacySources && typeof legacySources === "object"
    ? { ...legacySources as Record<string, unknown> } : {};
  delete sources[SPECIALITY_KEY];
  return sql`${JSON.stringify(sources)}::jsonb ||
    CASE WHEN ${hospitalSpecialties.designationSources} ? ${SPECIALITY_KEY}
      THEN jsonb_build_object(${SPECIALITY_KEY}::text, ${hospitalSpecialties.designationSources}->${SPECIALITY_KEY})
      ELSE '{}'::jsonb END`;
}

export function publicSpeciality(sources: unknown) {
  const state = readSpecialityState(sources);
  const specialities = verifiedSpecialityEntries(state.entries);
  return {
    specialities,
    categories: specialityCategories(specialities),
    // Shape-compatible projection for old clients. Raw legacy classifications
    // stay in the admin review, never masquerade as verified public labels.
    specialties: specialities.map(e => e.category && e.classification !== e.category
      ? `${e.category} - ${e.population === "All" ? "" : `${e.population} `}${e.classification}`
      : `${e.population === "All" ? "" : `${e.population} `}${e.classification}`),
    actualDesignation: specialities.filter(e => e.category === "Trauma").map(e => e.classification).join("; ") || null,
    strokeDesignation: specialities.find(e => e.category === "Stroke")?.classification ?? null,
    burnDesignation: specialities.find(e => e.category === "Burn")?.classification ?? null,
  };
}
