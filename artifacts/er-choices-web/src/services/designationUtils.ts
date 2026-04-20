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
    case "PCI/STEMI":
      return (
        specs.some((s) => /^cardiac\b/i.test(s)) ||
        !!(hospital.pciCapability) ||
        cats.includes("Cardiac")
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

const PREFIX_TO_LABEL: Record<string, string> = {
  trauma: "Trauma",
  stroke: "Stroke",
  burn: "Burn",
  cardiac: "PCI/STEMI",
};

const STANDALONE_TO_LABEL: Record<string, string> = {
  "pediatric care": "Pediatric",
  obstetrics: "Obstetrics",
  "behavioral health": "Psychiatric",
};

/**
 * Builds a consolidated list of designation groups for display in the
 * hospital detail view. Each group has a broad chip label and a list
 * of specific sub-designations (e.g. "Adult Level 1 & 2").
 *
 * Prefers the specialties array; falls back to legacy fields.
 */
export function buildDesignationGroups(hospital: Hospital): DesignationGroup[] {
  const specs = hospital.specialties ?? [];

  if (specs.length > 0) {
    const groupMap = new Map<string, string[]>();

    for (const s of specs) {
      const dashIdx = s.indexOf(" - ");
      if (dashIdx !== -1) {
        const prefix = s.slice(0, dashIdx).trim().toLowerCase();
        const suffix = s.slice(dashIdx + 3).trim();
        const label = PREFIX_TO_LABEL[prefix] ?? s.slice(0, dashIdx).trim();
        if (!groupMap.has(label)) groupMap.set(label, []);
        if (suffix) groupMap.get(label)!.push(suffix);
      } else {
        const label = STANDALONE_TO_LABEL[s.toLowerCase()] ?? s;
        if (!groupMap.has(label)) groupMap.set(label, []);
      }
    }

    return Array.from(groupMap.entries()).map(([label, subs]) => ({ label, subs }));
  }

  // Fallback: derive from categories + enriched fields
  const groups: DesignationGroup[] = [];
  const cats = (hospital.categories as string[]).filter((c) => c !== "All");

  for (const cat of cats) {
    const subs: string[] = [];
    if (cat === "Trauma" && hospital.actualDesignation) {
      hospital.actualDesignation.split(";")
        .map((s) => s.trim())
        .filter((s) => /\btrauma\b/i.test(s) || /\blevel\b/i.test(s))
        .forEach((s) => subs.push(normalizeDesignation(s)));
    } else if (cat === "Stroke" && hospital.strokeDesignation) {
      subs.push(hospital.strokeDesignation);
    } else if (cat === "Burn" && hospital.burnDesignation) {
      subs.push(hospital.burnDesignation);
    } else if (cat === "Cardiac" && hospital.pciCapability) {
      subs.push(hospital.pciCapability);
    }
    groups.push({ label: cat === "Cardiac" ? "PCI/STEMI" : cat, subs });
  }

  if (cats.length === 0) {
    if (hospital.strokeDesignation) groups.push({ label: "Stroke", subs: [hospital.strokeDesignation] });
    if (hospital.burnDesignation) groups.push({ label: "Burn", subs: [hospital.burnDesignation] });
    if (hospital.pciCapability) groups.push({ label: "PCI/STEMI", subs: [hospital.pciCapability] });
  }

  return groups;
}
