import { Hospital, DesignationFilter, DESIGNATION_FILTERS } from "@/types/hospital";

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
        /\btrauma\b/i.test(d) ||
        /\blevel (iv|iii|ii|i)\b/i.test(d) ||
        cats.includes("Trauma")
      );
    case "Stroke":
      return !!(hospital.strokeDesignation) || cats.includes("Stroke");
    case "Burn":
      return !!(hospital.burnDesignation) || cats.includes("Burn");
    case "PCI/STEMI":
      return !!(hospital.pciCapability) || cats.includes("Cardiac");
    case "Critical Access":
      return sl === "Critical Access";
    case "Psychiatric":
      return (
        sl === "Psychiatric" ||
        cats.includes("Psychiatric") ||
        specs.some((s) => /\b(psychiatric|behavioral)\b/i.test(s))
      );
    default:
      return false;
  }
}

export function computeAvailableFilters(hospitals: Hospital[]): DesignationFilter[] {
  const available: DesignationFilter[] = ["All"];
  for (const f of DESIGNATION_FILTERS) {
    if (f !== "All" && hospitals.some((h) => matchesDesignationFilter(h, f))) {
      available.push(f);
    }
  }
  return available;
}
