import { Hospital, HospitalCategory, DesignationFilter } from "@/types/hospital";

/** Fetch the verified specialty map from the API server. Never throws. */
export async function fetchVerifiedSpecialtyMap(
  apiBase: string
): Promise<Record<string, HospitalCategory[]>> {
  try {
    const res = await fetch(`${apiBase}/specialties`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return {};
    const data = await res.json();
    if (typeof data !== "object" || Array.isArray(data)) return {};
    return data as Record<string, HospitalCategory[]>;
  } catch {
    return {};
  }
}

export interface HospitalOverride {
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Fetch admin-set overrides for hospital phone/GPS. Never throws. */
export async function fetchHospitalOverrides(
  apiBase: string
): Promise<Record<string, HospitalOverride>> {
  try {
    const res = await fetch(`${apiBase}/hospital-overrides`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return {};
    const data = await res.json();
    if (typeof data !== "object" || Array.isArray(data)) return {};
    return data as Record<string, HospitalOverride>;
  } catch {
    return {};
  }
}


export class NavigationServerError extends Error {
  constructor() {
    super("Navigation server is currently down");
    this.name = "NavigationServerError";
  }
}

export async function fetchNearbyHospitals(
  apiBase: string,
  latitude: number,
  longitude: number,
): Promise<Hospital[]> {
  let response: Response;
  try {
    console.log("Querying hospital database for nearby hospitals...");
    response = await fetch(
      `${apiBase}/hospitals/nearby?lat=${latitude}&lon=${longitude}&radius=50`,
      { signal: AbortSignal.timeout(15000) }
    );
  } catch {
    throw new NavigationServerError();
  }

  if (!response.ok) {
    console.warn("Hospital API returned status:", response.status);
    throw new NavigationServerError();
  }

  let json: {
    hospitals: Array<{
      id: string;
      name: string;
      address: string | null;
      city: string | null;
      state: string;
      zip: string | null;
      latitude: number;
      longitude: number;
      distance: number;
      categories: HospitalCategory[];
      specialties: string[];
      phone: string | null;
    }>;
  };
  try {
    json = await response.json();
  } catch {
    throw new NavigationServerError();
  }

  const hospitals = (json.hospitals ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    address: row.address ?? undefined,
    city: row.city ?? undefined,
    state: row.state ?? "",
    zip: row.zip ?? undefined,
    latitude: row.latitude,
    longitude: row.longitude,
    phone: row.phone ?? undefined,
    categories: row.categories ?? [],
    verifiedSpecialties: row.categories ?? [],
    distance: row.distance,
    hospitalType: "Emergency Room",
  }));

  console.log(`Loaded ${hospitals.length} hospitals from CMS database`);
  return hospitals;
}

/**
 * Returns true if the hospital matches the given DesignationFilter.
 * Uses word-boundary regex so "Trauma I" never accidentally matches "Trauma II".
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

export function filterAndSortHospitals(
  hospitals: Hospital[],
  filter: DesignationFilter,
  limit = 10
): Hospital[] {
  const filtered =
    filter === "All"
      ? hospitals
      : hospitals.filter((h) => matchesDesignationFilter(h, filter));

  return filtered
    .slice()
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))
    .slice(0, limit);
}

export function formatDistance(miles: number): string {
  if (miles < 0.1) return "< 0.1 mi";
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}
