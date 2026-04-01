import { Hospital, HospitalCategory, ApiNinjasHospital } from "@/types/hospital";
import { MOCK_HOSPITALS } from "@/data/mockHospitals";

const API_KEY = process.env.EXPO_PUBLIC_API_NINJAS_KEY;
const API_BASE = "https://api.api-ninjas.com/v1/hospitals";

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

function inferCategories(hospital: ApiNinjasHospital): HospitalCategory[] {
  const name = hospital.name?.toLowerCase() ?? "";
  const categories: HospitalCategory[] = [];

  if (
    name.includes("children") ||
    name.includes("pediatric") ||
    name.includes("kids")
  ) {
    categories.push("Pediatric");
  }
  if (name.includes("burn") || name.includes("regional medical")) {
    categories.push("Burn");
  }
  if (
    name.includes("trauma") ||
    name.includes("memorial") ||
    name.includes("regional medical") ||
    name.includes("general")
  ) {
    categories.push("Trauma");
  }
  if (
    name.includes("heart") ||
    name.includes("cardiac") ||
    name.includes("cardiovascular")
  ) {
    categories.push("Cardiac");
  }
  if (name.includes("cancer") || name.includes("oncology")) {
    categories.push("Cancer");
  }
  if (name.includes("maternity") || name.includes("women")) {
    categories.push("Obstetrics");
  }
  if (
    name.includes("psychiatric") ||
    name.includes("behavioral") ||
    name.includes("mental")
  ) {
    categories.push("Psychiatric");
  }
  if (name.includes("stroke") || name.includes("neuro")) {
    categories.push("Stroke");
  }

  if (categories.length === 0) {
    categories.push("Trauma");
    categories.push("Cardiac");
  }

  return categories;
}

function mapApiHospital(apiHosp: ApiNinjasHospital, index: number): Hospital {
  return {
    id: `api-${index}-${apiHosp.latitude}-${apiHosp.longitude}`,
    name: apiHosp.name,
    address: apiHosp.address ?? "",
    city: apiHosp.city ?? "",
    state: apiHosp.state ?? "",
    zip: apiHosp.zip_code ?? "",
    latitude: apiHosp.latitude,
    longitude: apiHosp.longitude,
    phone: apiHosp.phone,
    website: apiHosp.website,
    categories: inferCategories(apiHosp),
    hospitalType: apiHosp.is_emergency_care ? "Emergency Care" : "General Hospital",
  };
}

export async function fetchNearbyHospitals(
  latitude: number,
  longitude: number
): Promise<Hospital[]> {
  if (!API_KEY) {
    return getMockHospitals(latitude, longitude);
  }

  try {
    const url = `${API_BASE}?lat=${latitude}&lon=${longitude}&limit=20`;
    const response = await fetch(url, {
      headers: {
        "X-Api-Key": API_KEY,
      },
    });

    if (!response.ok) {
      console.warn("API Ninjas returned non-OK:", response.status);
      return getMockHospitals(latitude, longitude);
    }

    const data: ApiNinjasHospital[] = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      return getMockHospitals(latitude, longitude);
    }

    const hospitals = data.map(mapApiHospital);
    return addDistances(hospitals, latitude, longitude);
  } catch (error) {
    console.warn("Hospital API fetch failed, using mock data:", error);
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

    if (filtered.length === 0) {
      return [];
    }
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
