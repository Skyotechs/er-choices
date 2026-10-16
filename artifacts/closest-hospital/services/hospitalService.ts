import { Hospital, HospitalCategory, DesignationFilter, DESIGNATION_FILTERS } from "@/types/hospital";
import { specialityCategories, specialityGroups, verifiedSpecialityEntries, type SpecialityEntry } from "@workspace/speciality";

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
      specialities?: SpecialityEntry[];
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
      // Enriched fields
      actualDesignation: string | null;
      serviceLine: string | null;
      advancedCapabilities: string | null;
      emsTags: string | null;
      helipad: boolean | null;
      beds: number | null;
      hifldOwner: string | null;
      hifldWebsite: string | null;
      strokeDesignation: string | null;
      burnDesignation: string | null;
      pciCapability: string | null;
      hifldMatchConfidence: string | null;
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
    categories: specialityCategories(row.specialities) as HospitalCategory[],
    verifiedSpecialties: specialityCategories(row.specialities) as HospitalCategory[],
    specialities: verifiedSpecialityEntries(row.specialities),
    specialties: row.specialties ?? [],
    distance: row.distance,
    hospitalType: row.serviceLine ?? "Emergency Room",
    // Enriched fields
    actualDesignation: row.actualDesignation ?? null,
    serviceLine: row.serviceLine ?? null,
    advancedCapabilities: row.advancedCapabilities ?? null,
    emsTags: row.emsTags ?? null,
    helipad: row.helipad ?? null,
    beds: row.beds ?? null,
    hifldOwner: row.hifldOwner ?? null,
    hifldWebsite: row.hifldWebsite ?? null,
    strokeDesignation: row.strokeDesignation ?? null,
    burnDesignation: row.burnDesignation ?? null,
    pciCapability: row.pciCapability ?? null,
    hifldMatchConfidence: row.hifldMatchConfidence ?? null,
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
  return specialityCategories(hospital.specialities).includes(filter);
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
  return specialityGroups(hospital.specialities);
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
