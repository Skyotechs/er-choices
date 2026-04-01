import { Hospital, HospitalCategory } from "@/types/hospital";
import { MOCK_HOSPITALS } from "@/data/mockHospitals";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const SEARCH_RADIUS_METERS = 80000;

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

function inferCategories(name: string, tags: Record<string, string>): HospitalCategory[] {
  const n = name.toLowerCase();
  const specialty = (tags["healthcare:speciality"] ?? tags["speciality"] ?? "").toLowerCase();
  const combined = `${n} ${specialty}`;
  const categories: HospitalCategory[] = [];

  if (combined.includes("child") || combined.includes("pediatric") || combined.includes("kids")) {
    categories.push("Pediatric");
  }
  if (combined.includes("burn")) {
    categories.push("Burn");
  }
  if (
    combined.includes("trauma") ||
    combined.includes("memorial") ||
    combined.includes("regional") ||
    combined.includes("general") ||
    tags["trauma"] === "yes"
  ) {
    categories.push("Trauma");
  }
  if (
    combined.includes("heart") ||
    combined.includes("cardiac") ||
    combined.includes("cardiovascular") ||
    combined.includes("cardio")
  ) {
    categories.push("Cardiac");
  }
  if (combined.includes("cancer") || combined.includes("oncology")) {
    categories.push("Cancer");
  }
  if (
    combined.includes("matern") ||
    combined.includes("women") ||
    combined.includes("obstetric") ||
    combined.includes("birth")
  ) {
    categories.push("Obstetrics");
  }
  if (
    combined.includes("psychiatric") ||
    combined.includes("behavioral") ||
    combined.includes("mental") ||
    combined.includes("psych")
  ) {
    categories.push("Psychiatric");
  }
  if (combined.includes("stroke") || combined.includes("neuro")) {
    categories.push("Stroke");
  }

  if (categories.length === 0) {
    categories.push("Trauma");
    categories.push("Cardiac");
  }

  return categories;
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function mapOverpassElement(el: OverpassElement, index: number): Hospital | null {
  const tags = el.tags ?? {};
  const name = tags["name"] ?? tags["official_name"] ?? "";
  if (!name) return null;

  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat === undefined || lon === undefined) return null;

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
    hospitalType: tags["emergency"] === "yes" ? "Emergency Care" : "General Hospital",
  };
}

export async function fetchNearbyHospitals(
  latitude: number,
  longitude: number
): Promise<Hospital[]> {
  try {
    const query = `
[out:json][timeout:30];
(
  node["amenity"="hospital"](around:${SEARCH_RADIUS_METERS},${latitude},${longitude});
  way["amenity"="hospital"](around:${SEARCH_RADIUS_METERS},${latitude},${longitude});
  relation["amenity"="hospital"](around:${SEARCH_RADIUS_METERS},${latitude},${longitude});
);
out center tags;
`.trim();

    console.log("Querying Overpass API for nearby hospitals...");
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!response.ok) {
      console.warn("Overpass API error:", response.status);
      return getMockHospitals(latitude, longitude);
    }

    const json = await response.json();
    const elements: OverpassElement[] = json.elements ?? [];

    const hospitals = elements
      .map((el, i) => mapOverpassElement(el, i))
      .filter((h): h is Hospital => h !== null);

    if (hospitals.length === 0) {
      console.warn("No hospitals found via Overpass, using demo data");
      return getMockHospitals(latitude, longitude);
    }

    console.log(`Loaded ${hospitals.length} hospitals from OpenStreetMap`);
    return addDistances(hospitals, latitude, longitude);
  } catch (error) {
    console.warn("Overpass fetch failed, using demo data:", error);
    return getMockHospitals(latitude, longitude);
  }
}

function getMockHospitals(latitude: number, longitude: number): Hospital[] {
  return addDistances([...MOCK_HOSPITALS], latitude, longitude);
}

function addDistances(
  hospitals: Hospital[],
  latitude: number,
  longitude: number
): Hospital[] {
  return hospitals.map((h) => ({
    ...h,
    distance: haversineDistance(latitude, longitude, h.latitude, h.longitude),
  }));
}

export function filterAndSortHospitals(
  hospitals: Hospital[],
  category: HospitalCategory,
  limit = 10
): Hospital[] {
  let filtered: Hospital[];

  if (category === "All") {
    filtered = hospitals;
  } else {
    filtered = hospitals.filter((h) => h.categories.includes(category));
    if (filtered.length === 0) return [];
  }

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
