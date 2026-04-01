import { Hospital, HospitalCategory } from "@/types/hospital";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const SEARCH_RADIUS_METERS = 80000;

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

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Names containing any of these phrases are excluded from results entirely
const EXCLUDE_NAME_PHRASES = [
  // Urgent / non-ER care
  "urgent care",
  "primary care",
  "walk-in",
  "walk in clinic",
  "immediate care",
  "express care",
  "minute clinic",
  "retail clinic",
  // Access / community health centres (not full ERs)
  "access center",
  "access centre",
  "health access",
  "community health center",
  "community health centre",
  "federally qualified health",
  "fqhc",
  "neighborhood health",
  // Wellness / elective
  "wellness",
  "fertility center",
  "fertility clinic",
  "outpatient surgery center",
  "surgery center",
  // Non-medical
  "acupuncture",
  "chiropractic",
  "dialysis",
  "pharmacy",
  "dental",
  "dentistry",
  "optical",
  "veterinary",
  "vet clinic",
  "animal hospital",
  // Rehab / non-emergency facilities
  "rehab",
  "rehabilitation",
  "substance abuse",
  "detox",
  "recovery center",
  "addiction",
  "behavioral health",
  "mental health center",
  "nursing home",
  "assisted living",
  "long term care",
  "skilled nursing",
  "hospice",
  "gastroenterology",
  "endoscopy",
  "imaging center",
  "radiology",
  "infusion center",
];

function isExcluded(name: string, tags: Record<string, string>): boolean {
  const n = name.toLowerCase();
  if (EXCLUDE_NAME_PHRASES.some((phrase) => n.includes(phrase))) return true;

  // OSM tag-based exclusions — non-ER specialities
  const speciality = (tags["healthcare:speciality"] ?? "").toLowerCase();
  const nonErSpecialities = [
    "acupuncture", "dentistry", "chiropractic", "gastroenterology",
    "ophthalmology", "dermatology", "radiology", "rehabilitation",
  ];
  if (nonErSpecialities.some((s) => speciality === s)) return true;

  return false;
}

// Map OSM healthcare:speciality values to our HospitalCategory
const OSM_SPECIALITY_MAP: Array<{ keywords: string[]; category: HospitalCategory }> = [
  { keywords: ["cardio", "cardiovascular", "heart"], category: "Cardiac" },
  { keywords: ["neurology", "neurosurgery", "stroke", "neuro"], category: "Stroke" },
  { keywords: ["paediatric", "pediatric", "child", "children"], category: "Pediatric" },
  { keywords: ["psychiatry", "psychology", "mental_health", "behavioral"], category: "Psychiatric" },
  { keywords: ["oncology", "cancer"], category: "Cancer" },
  { keywords: ["obstetric", "gynaecology", "gynecology", "maternity", "women"], category: "Obstetrics" },
  { keywords: ["burns", "burn"], category: "Burn" },
  { keywords: ["trauma", "emergency"], category: "Trauma" },
];

function inferCategories(name: string, tags: Record<string, string>): HospitalCategory[] {
  const n = name.toLowerCase();
  // OSM structured tag — can be semicolon-separated list
  const osmSpecialities = (tags["healthcare:speciality"] ?? "")
    .toLowerCase()
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  const categories = new Set<HospitalCategory>();

  // 1. Match against OSM speciality tags (most reliable)
  for (const spec of osmSpecialities) {
    for (const { keywords, category } of OSM_SPECIALITY_MAP) {
      if (keywords.some((kw) => spec.includes(kw))) {
        categories.add(category);
      }
    }
  }

  // 2. Name-based keyword matching as fallback / supplement
  if (n.includes("child") || n.includes("pediatric") || n.includes("kids")) categories.add("Pediatric");
  if (n.includes("burn")) categories.add("Burn");
  if (n.includes("heart") || n.includes("cardiac") || n.includes("cardio")) categories.add("Cardiac");
  if (n.includes("cancer") || n.includes("oncology")) categories.add("Cancer");
  if (n.includes("matern") || n.includes("obstetric")) categories.add("Obstetrics");
  if (n.includes("psychiatric") || n.includes("behavioral") || n.includes("mental")) categories.add("Psychiatric");
  if (n.includes("stroke") || n.includes("neuro")) categories.add("Stroke");
  if (
    n.includes("trauma") ||
    n.includes("regional") ||
    n.includes("memorial") ||
    n.includes("general") ||
    tags["trauma"] === "yes"
  ) {
    categories.add("Trauma");
  }

  // 3. Default: a general hospital covers Trauma + Cardiac
  if (categories.size === 0) {
    categories.add("Trauma");
    categories.add("Cardiac");
  }

  return Array.from(categories);
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function mapOverpassElement(el: OverpassElement): Hospital | null {
  const tags = el.tags ?? {};
  const name = tags["name"] ?? tags["official_name"] ?? "";
  if (!name) return null;

  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat === undefined || lon === undefined) return null;

  if (isExcluded(name, tags)) return null;

  const street = tags["addr:street"] ?? "";
  const housenumber = tags["addr:housenumber"] ?? "";
  const address = housenumber ? `${housenumber} ${street}` : street;

  return {
    id: `osm-${el.type}-${el.id}`,
    name,
    address,
    city: tags["addr:city"] ?? "",
    state: tags["addr:state"] ?? "",
    zip: tags["addr:postcode"] ?? "",
    latitude: lat,
    longitude: lon,
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

export async function fetchNearbyHospitals(
  latitude: number,
  longitude: number,
  verifiedSpecialtyMap: Record<string, HospitalCategory[]> = {},
  hospitalOverrideMap: Record<string, HospitalOverride> = {}
): Promise<Hospital[]> {
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
    console.log("Querying Overpass API for nearby hospitals...");
    response = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });
  } catch {
    throw new NavigationServerError();
  }

  if (!response.ok) {
    console.warn("Overpass API returned status:", response.status);
    throw new NavigationServerError();
  }

  let json: { elements?: OverpassElement[] };
  try {
    json = await response.json();
  } catch {
    throw new NavigationServerError();
  }

  const seen = new Set<number>();
  const hospitals = (json.elements ?? [])
    .filter((el) => {
      if (seen.has(el.id)) return false;
      seen.add(el.id);
      return true;
    })
    .map(mapOverpassElement)
    .filter((h): h is Hospital => h !== null);

  console.log(`Loaded ${hospitals.length} hospitals from OpenStreetMap`);

  return hospitals.map((h) => {
    // Key presence is authoritative — an empty verified array means "admin cleared
    // specialties" and must not fall back to OSM inference for filtering purposes.
    const hasVerified = h.id in verifiedSpecialtyMap;
    const verifiedCategories: HospitalCategory[] = verifiedSpecialtyMap[h.id] ?? [];

    // Apply admin-set overrides for phone and GPS coordinates.
    const override = hospitalOverrideMap[h.id];
    const finalLat = override?.latitude ?? h.latitude;
    const finalLon = override?.longitude ?? h.longitude;
    const finalPhone = override !== undefined ? (override.phone ?? h.phone) : h.phone;

    return {
      ...h,
      phone: finalPhone,
      latitude: finalLat,
      longitude: finalLon,
      categories: hasVerified ? verifiedCategories : h.categories,
      verifiedSpecialties: hasVerified ? verifiedCategories : undefined,
      distance: haversineDistance(latitude, longitude, finalLat, finalLon),
    };
  });
}

export function filterAndSortHospitals(
  hospitals: Hospital[],
  category: HospitalCategory,
  limit = 10
): Hospital[] {
  const filtered =
    category === "All"
      ? hospitals
      : // Only include hospitals with verified specialty data that matches the filter.
        // OSM-inferred categories are intentionally excluded from specialty-filtered results.
        hospitals.filter((h) => h.verifiedSpecialties?.includes(category));

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
