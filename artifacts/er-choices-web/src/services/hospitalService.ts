import { Hospital, HospitalCategory } from "@/types/hospital";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const SEARCH_RADIUS_METERS = 80000;
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

interface OverpassElement {
  id: number;
  type: "node" | "way" | "relation";
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function inferCategories(name: string, tags: Record<string, string>): HospitalCategory[] {
  const cats: HospitalCategory[] = [];
  const lower = name.toLowerCase();
  const healthcare = tags["healthcare:speciality"] ?? tags["healthcare"] ?? "";
  if (
    lower.includes("trauma") ||
    tags["trauma"] === "yes" ||
    tags["trauma:level"] !== undefined
  )
    cats.push("Trauma");
  if (
    lower.includes("stroke") ||
    healthcare.includes("neurology") ||
    healthcare.includes("stroke")
  )
    cats.push("Stroke");
  if (lower.includes("burn")) cats.push("Burn");
  if (
    lower.includes("children") ||
    lower.includes("pediatric") ||
    lower.includes("kids") ||
    healthcare.includes("paediatric") ||
    healthcare.includes("pediatric")
  )
    cats.push("Pediatric");
  if (
    lower.includes("cardiac") ||
    lower.includes("heart") ||
    healthcare.includes("cardiology")
  )
    cats.push("Cardiac");
  if (
    lower.includes("maternity") ||
    lower.includes("obstetric") ||
    lower.includes("women") ||
    healthcare.includes("obstetrics") ||
    healthcare.includes("gynaecology")
  )
    cats.push("Obstetrics");
  if (
    lower.includes("psychiatric") ||
    lower.includes("behavioral") ||
    lower.includes("mental")
  )
    cats.push("Psychiatric");
  if (lower.includes("cancer") || lower.includes("oncol")) cats.push("Cancer");
  return cats;
}

function mapOverpassElement(el: OverpassElement): Hospital | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (!lat || !lon) return null;

  const tags = el.tags ?? {};
  const name = tags["name"] ?? tags["official_name"] ?? "Hospital";
  const street = tags["addr:street"] ?? "";
  const housenumber = tags["addr:housenumber"] ?? "";
  const address = housenumber ? `${housenumber} ${street}` : street;
  return {
    id: `osm-${el.type}-${el.id}`,
    name, address,
    city: tags["addr:city"] ?? "",
    state: tags["addr:state"] ?? "",
    zip: tags["addr:postcode"] ?? "",
    latitude: lat, longitude: lon,
    phone: tags["phone"] ?? tags["contact:phone"],
    website: tags["website"] ?? tags["contact:website"],
    categories: inferCategories(name, tags),
    hospitalType: "Emergency Room",
  };
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
  state: string;
  latitude: number;
  longitude: number;
  distance: number;
  categories: string[];
  phone: string | null;
}

async function fetchNearbyHospitalsCms(
  latitude: number,
  longitude: number
): Promise<Hospital[] | null> {
  try {
    const url = `${API_BASE}/hospitals/nearby?lat=${latitude}&lon=${longitude}&radius=${SEARCH_RADIUS_MILES}`;
    const res = await fetchWithTimeout(url, 10000);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.hospitals || !Array.isArray(data.hospitals)) return null;
    if (data.hospitals.length === 0) return null;

    return (data.hospitals as CmsHospitalRow[]).map((h) => ({
      id: h.id,
      name: h.name,
      address: "",
      city: "",
      state: h.state,
      zip: "",
      latitude: h.latitude,
      longitude: h.longitude,
      phone: h.phone ?? undefined,
      website: undefined,
      categories: (h.categories as HospitalCategory[]).length > 0
        ? (h.categories as HospitalCategory[])
        : ([] as HospitalCategory[]),
      hospitalType: "Emergency Room",
      verifiedSpecialties: h.categories.length > 0
        ? (h.categories as HospitalCategory[])
        : undefined,
      distance: h.distance,
    }));
  } catch {
    return null;
  }
}

export async function fetchNearbyHospitals(
  latitude: number,
  longitude: number,
  verifiedSpecialtyMap: Record<string, HospitalCategory[]> = {}
): Promise<Hospital[]> {
  // Try the CMS database on Railway first — fast, reliable, verified data
  const cmsHospitals = await fetchNearbyHospitalsCms(latitude, longitude);

  if (cmsHospitals && cmsHospitals.length > 0) {
    return cmsHospitals.map((h) => {
      const hasVerified = h.id in verifiedSpecialtyMap;
      const verifiedCategories: HospitalCategory[] = verifiedSpecialtyMap[h.id] ?? [];
      return {
        ...h,
        categories: hasVerified ? verifiedCategories : h.categories,
        verifiedSpecialties: hasVerified ? verifiedCategories : h.verifiedSpecialties,
        distance: h.distance ?? haversineDistance(latitude, longitude, h.latitude, h.longitude),
      };
    });
  }

  // Fall back to OpenStreetMap Overpass API
  const query = `
[out:json][timeout:30];
(
  node["amenity"="hospital"]["emergency"="yes"](around:${SEARCH_RADIUS_METERS},${latitude},${longitude});
  way["amenity"="hospital"]["emergency"="yes"](around:${SEARCH_RADIUS_METERS},${latitude},${longitude});
  relation["amenity"="hospital"]["emergency"="yes"](around:${SEARCH_RADIUS_METERS},${latitude},${longitude});
  node["amenity"="hospital"]["emergency"!="no"]["healthcare"!="clinic"]["healthcare"!="doctor"](around:${SEARCH_RADIUS_METERS},${latitude},${longitude});
  way["amenity"="hospital"]["emergency"!="no"]["healthcare"!="clinic"]["healthcare"!="doctor"](around:${SEARCH_RADIUS_METERS},${latitude},${longitude});
  relation["amenity"="hospital"]["emergency"!="no"]["healthcare"!="clinic"]["healthcare"!="doctor"](around:${SEARCH_RADIUS_METERS},${latitude},${longitude});
);
out center tags;
`.trim();

  let response: Response;
  try {
    response = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });
  } catch {
    throw new NavigationServerError();
  }

  if (!response.ok) throw new NavigationServerError();

  let json: { elements?: OverpassElement[] };
  try {
    json = await response.json();
  } catch {
    throw new NavigationServerError();
  }

  const seen = new Set<number>();
  const hospitals = (json.elements ?? [])
    .filter((el) => { if (seen.has(el.id)) return false; seen.add(el.id); return true; })
    .map(mapOverpassElement)
    .filter((h): h is Hospital => h !== null);

  return hospitals.map((h) => {
    const hasVerified = h.id in verifiedSpecialtyMap;
    const verifiedCategories: HospitalCategory[] = verifiedSpecialtyMap[h.id] ?? [];
    return {
      ...h,
      categories: hasVerified ? verifiedCategories : h.categories,
      verifiedSpecialties: hasVerified ? verifiedCategories : undefined,
      distance: haversineDistance(latitude, longitude, h.latitude, h.longitude),
    };
  });
}

export function filterAndSortHospitals(
  hospitals: Hospital[],
  category: HospitalCategory,
  limit = 10
): Hospital[] {
  const filtered = category === "All"
    ? hospitals
    : hospitals.filter((h) => {
        const specialties = h.verifiedSpecialties ?? h.categories;
        return specialties.includes(category);
      });
  return filtered.slice().sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0)).slice(0, limit);
}

export function formatDistance(miles: number): string {
  if (miles < 0.1) return "< 0.1 mi";
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}
