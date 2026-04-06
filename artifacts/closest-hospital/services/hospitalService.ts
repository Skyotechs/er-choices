import { Hospital, HospitalCategory, DesignationFilter } from "@/types/hospital";

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return response;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/** Fetch the verified specialty map from the API server. Never throws. */
export async function fetchVerifiedSpecialtyMap(
  apiBase: string
): Promise<Record<string, HospitalCategory[]>> {
  try {
    const res = await fetchWithTimeout(`${apiBase}/specialties`, 8000);
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
    const res = await fetchWithTimeout(`${apiBase}/hospital-overrides`, 8000);
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
  const url = `${apiBase}/hospitals/nearby?lat=${latitude}&lon=${longitude}&radius=50`;
  let response: Response;
  try {
    console.log("Querying hospital database for nearby hospitals...");
    response = await fetchWithTimeout(url, 60000);
  } catch {
    // First attempt failed — wait 3 s then try once more before giving up.
    console.warn("Hospital fetch failed, retrying in 3 s...");
    await new Promise((r) => setTimeout(r, 3000));
    try {
      response = await fetchWithTimeout(url, 60000);
    } catch {
      throw new NavigationServerError();
    }
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

const ROMAN_TO_ARABIC: Record<string, string> = { iv: "4", iii: "3", ii: "2", i: "1" };

/**
 * Normalises a single designation segment for display.
 * Any "Level I/II/III/IV …" string collapses to "Level N Trauma Center".
 * Non-trauma segments are returned unchanged.
 */
export function normalizeDesignation(segment: string): string {
  const m = segment.match(/\blevel\s+(iv|iii|ii|i)\b/i);
  if (m) return `Level ${ROMAN_TO_ARABIC[m[1].toLowerCase()]} Trauma Center`;
  return segment;
}

/**
 * Returns true if the hospital matches the given DesignationFilter.
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
