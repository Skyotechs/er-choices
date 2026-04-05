import { Hospital, DesignationFilter, DESIGNATION_FILTERS } from "@/types/hospital";

export function matchesDesignationFilter(
  hospital: Hospital,
  filter: DesignationFilter
): boolean {
  if (filter === "All") return true;
  const d = hospital.actualDesignation ?? "";
  const sl = hospital.serviceLine ?? "";
  switch (filter) {
    case "Trauma I":
      return /\blevel i\b/i.test(d);
    case "Trauma II":
      return /\blevel ii\b/i.test(d);
    case "Trauma III":
      return /\blevel iii\b/i.test(d);
    case "Trauma IV":
      return /\blevel iv\b/i.test(d);
    case "Stroke":
      return !!(hospital.strokeDesignation);
    case "Burn":
      return !!(hospital.burnDesignation);
    case "PCI/STEMI":
      return !!(hospital.pciCapability);
    case "Critical Access":
      return sl === "Critical Access";
    case "Psychiatric":
      return sl === "Psychiatric";
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
