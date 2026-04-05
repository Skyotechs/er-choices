import { Hospital, HospitalCategory, DesignationFilter } from "@/types/hospital";
import { matchesDesignationFilter } from "@/services/designationUtils";

const SEARCH_RADIUS_MILES = 50;

const API_BASE = import.meta.env.VITE_API_BASE
  ? (import.meta.env.VITE_API_BASE as string).replace(/\/$/, "")
  : `${window.location.origin}/api`;

function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

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

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class NavigationServerError extends Error {
  constructor() {
    super("Navigation server is currently down");
    this.name = "NavigationServerError";
  }
}

interface CmsHospitalRow {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string;
  zip: string | null;
  latitude: number;
  longitude: number;
  distance: number;
  categories: string[];
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
}

export async function fetchNearbyHospitals(
  latitude: number,
  longitude: number,
  verifiedSpecialtyMap: Record<string, HospitalCategory[]> = {}
): Promise<Hospital[]> {
  let data: { hospitals: CmsHospitalRow[] };

  try {
    const url = `${API_BASE}/hospitals/nearby?lat=${latitude}&lon=${longitude}&radius=${SEARCH_RADIUS_MILES}`;
    const res = await fetchWithTimeout(url, 12000);
    if (!res.ok) throw new NavigationServerError();
    data = await res.json();
    if (!data.hospitals || !Array.isArray(data.hospitals)) throw new NavigationServerError();
  } catch (err) {
    if (err instanceof NavigationServerError) throw err;
    throw new NavigationServerError();
  }

  return data.hospitals.map((h) => {
    // Admin specialty map takes priority over CMS specialties
    const hasAdminOverride = h.id in verifiedSpecialtyMap;
    const adminCategories: HospitalCategory[] = verifiedSpecialtyMap[h.id] ?? [];
    const cmsCategories = h.categories as HospitalCategory[];

    return {
      id: h.id,
      name: h.name,
      address: h.address ?? "",
      city: h.city ?? "",
      state: h.state,
      zip: h.zip ?? "",
      latitude: h.latitude,
      longitude: h.longitude,
      phone: h.phone ?? undefined,
      website: h.hifldWebsite ?? undefined,
      categories: hasAdminOverride ? adminCategories : cmsCategories,
      hospitalType: h.serviceLine ?? "Emergency Room",
      verifiedSpecialties: hasAdminOverride ? adminCategories : cmsCategories,
      specialties: h.specialties ?? [],
      distance: h.distance ?? haversineDistance(latitude, longitude, h.latitude, h.longitude),
      // Enriched fields
      actualDesignation: h.actualDesignation,
      serviceLine: h.serviceLine,
      advancedCapabilities: h.advancedCapabilities,
      emsTags: h.emsTags,
      helipad: h.helipad,
      beds: h.beds,
      hifldOwner: h.hifldOwner,
      hifldWebsite: h.hifldWebsite,
      strokeDesignation: h.strokeDesignation,
      burnDesignation: h.burnDesignation,
      pciCapability: h.pciCapability,
      hifldMatchConfidence: h.hifldMatchConfidence,
    };
  });
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
