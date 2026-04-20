import { Hospital, DesignationFilter, DESIGNATION_FILTERS } from "@/types/hospital";

const ROMAN_TO_ARABIC: Record<string, string> = { iv: "4", iii: "3", ii: "2", i: "1" };

/**
 * Normalises a single designation segment for display.
 */
export function normalizeDesignation(segment: string): string {
  const m = segment.match(/\blevel\s+(iv|iii|ii|i)\b/i);
  if (m) return `Level ${ROMAN_TO_ARABIC[m[1].toLowerCase()]} Trauma Center`;
  return segment;
}

/**
 * Returns true if the hospital matches the given DesignationFilter.
 * Checks the specialties array first (prefix matching), then falls back
 * to legacy fields (categories, actualDesignation, strokeDesignation, etc.).
 */
export function matchesDesignationFilter(
  hospital: Hospital,
  filter: DesignationFilter
): boolean {
  if (filter === "All") return true;
  const d = hospital.actualDesignation ?? "";
  const sl = hospital.serviceLine ?? "";
  const cats = hospital.categories as string[];
  const specs = hospital.specialties ?? [];

  switch (filter) {
    case "Trauma":
      return (
        specs.some((s) => /^trauma\b/i.test(s)) ||
        /\btrauma\b/i.test(d) ||
        /\blevel (iv|iii|ii|i)\b/i.test(d) ||
        cats.includes("Trauma")
      );
    case "Stroke":
      return (
        specs.some((s) => /^stroke\b/i.test(s)) ||
        !!(hospital.strokeDesignation) ||
        cats.includes("Stroke")
      );
    case "Pediatric":
      return (
        specs.some((s) => /^pediatric care$/i.test(s) || /^trauma - pediatric/i.test(s)) ||
        cats.includes("Pediatric")
      );
    case "Obstetrics":
      return (
        specs.some((s) => /^obstetrics$/i.test(s)) ||
        cats.includes("Obstetrics")
      );
    case "Burn":
      return (
        specs.some((s) => /^burn\b/i.test(s)) ||
        !!(hospital.burnDesignation) ||
        cats.includes("Burn")
      );
    case "Critical Access":
      return sl === "Critical Access";
    case "Psychiatric":
      return (
        specs.some((s) => /^behavioral health$/i.test(s) || /\b(psychiatric|behavioral)\b/i.test(s)) ||
        sl === "Psychiatric" ||
        cats.includes("Psychiatric")
      );
    default:
      return false;
  }
}

/** Always returns all filters — chips are always visible regardless of local availability. */
export function computeAvailableFilters(_hospitals: Hospital[]): DesignationFilter[] {
  return DESIGNATION_FILTERS;
}

export interface DesignationGroup {
  label: string;
  subs: string[];
}

/**
 * Builds a consolidated list of designation groups for display in the hospital
 * detail view. Chips are always drawn from the fixed DesignationFilter set by
 * running matchesDesignationFilter for each filter — guaranteeing only known
 * broad categories appear. Sub-lines are extracted from specialties[] first,
 * then fall back to legacy enriched fields.
 */
export function buildDesignationGroups(hospital: Hospital): DesignationGroup[] {
  const specs = hospital.specialties ?? [];
  const groups: DesignationGroup[] = [];

  for (const filter of DESIGNATION_FILTERS) {
    if (filter === "All") continue;
    if (!matchesDesignationFilter(hospital, filter)) continue;

    let subs: string[] = [];

    switch (filter) {
      case "Trauma": {
        const fromSpecs = specs
          .filter((s) => /^trauma - /i.test(s))
          .map((s) => s.replace(/^trauma - /i, "").trim());
        if (fromSpecs.length > 0) {
          subs = fromSpecs;
        } else if (hospital.actualDesignation) {
          hospital.actualDesignation.split(";")
            .map((s) => s.trim())
            .filter((s) => /\btrauma\b/i.test(s) || /\blevel\b/i.test(s))
            .forEach((s) => subs.push(normalizeDesignation(s)));
        }
        break;
      }
      case "Stroke": {
        const fromSpecs = specs
          .filter((s) => /^stroke - /i.test(s))
          .map((s) => s.replace(/^stroke - /i, "").trim());
        subs = fromSpecs.length > 0 ? fromSpecs : hospital.strokeDesignation ? [hospital.strokeDesignation] : [];
        break;
      }
      case "Burn": {
        const fromSpecs = specs
          .filter((s) => /^burn - /i.test(s))
          .map((s) => s.replace(/^burn - /i, "").trim());
        subs = fromSpecs.length > 0 ? fromSpecs : hospital.burnDesignation ? [hospital.burnDesignation] : [];
        break;
      }
      // Pediatric, Obstetrics, Psychiatric, Critical Access: chip only, no sub-lines
      default:
        subs = [];
    }

    groups.push({ label: filter, subs });
  }

  return groups;
}
