import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { Hospital, HospitalCategory, CATEGORIES } from "@/types/hospital";
import {
  fetchNearbyHospitals,
  fetchVerifiedSpecialtyMap,
  filterAndSortHospitals,
  NavigationServerError,
} from "@/services/hospitalService";

const API_BASE = `${window.location.origin}/api`;

interface LocationCoords {
  latitude: number;
  longitude: number;
}

type PermStatus = "granted" | "denied" | "undetermined" | null;

interface HospitalContextValue {
  location: LocationCoords | null;
  locationError: string | null;
  locationPermission: PermStatus;
  serverError: boolean;
  allHospitals: Hospital[];
  filteredHospitals: Hospital[];
  selectedCategory: HospitalCategory;
  availableCategories: HospitalCategory[];
  isLoading: boolean;
  isRefreshing: boolean;
  requestLocationPermission: () => Promise<void>;
  refresh: () => Promise<void>;
  setCategory: (category: HospitalCategory) => void;
}

const HospitalContext = createContext<HospitalContextValue | null>(null);

async function getLocationWeb(): Promise<LocationCoords> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

function computeAvailableCategories(hospitals: Hospital[]): HospitalCategory[] {
  const catSet = new Set<HospitalCategory>();
  for (const h of hospitals) {
    const specialties = h.verifiedSpecialties ?? h.categories;
    for (const cat of specialties) {
      if (cat !== "All") catSet.add(cat);
    }
  }
  const available: HospitalCategory[] = ["All"];
  for (const cat of CATEGORIES) {
    if (cat !== "All" && catSet.has(cat)) available.push(cat);
  }
  return available;
}

export function HospitalProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useState<LocationCoords | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationPermission, setLocationPermission] = useState<PermStatus>(null);
  const [allHospitals, setAllHospitals] = useState<Hospital[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<HospitalCategory>("All");
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [serverError, setServerError] = useState(false);
  const [verifiedSpecialtyMap, setVerifiedSpecialtyMap] = useState<Record<string, HospitalCategory[]>>({});
  const verifiedMapRef = useRef<Record<string, HospitalCategory[]>>({});

  const filteredHospitals = filterAndSortHospitals(allHospitals, selectedCategory, 10);
  const availableCategories = computeAvailableCategories(allHospitals);

  useEffect(() => {
    fetchVerifiedSpecialtyMap(API_BASE).then((map) => {
      verifiedMapRef.current = map;
      setVerifiedSpecialtyMap(map);
    });
  }, []);

  useEffect(() => {
    if (Object.keys(verifiedSpecialtyMap).length === 0) return;
    setAllHospitals((prev) => {
      if (prev.length === 0) return prev;
      return prev.map((h) => {
        const hasVerified = h.id in verifiedSpecialtyMap;
        const verified: HospitalCategory[] = verifiedSpecialtyMap[h.id] ?? [];
        return hasVerified ? { ...h, categories: verified, verifiedSpecialties: verified } : h;
      });
    });
  }, [verifiedSpecialtyMap]);

  const loadHospitals = useCallback(async (coords: LocationCoords) => {
    setServerError(false);
    try {
      const hospitals = await fetchNearbyHospitals(coords.latitude, coords.longitude, verifiedMapRef.current);
      setAllHospitals(hospitals);
    } catch (err) {
      if (err instanceof NavigationServerError) {
        setServerError(true);
        setAllHospitals([]);
      } else {
        console.error("Unexpected hospital fetch error:", err);
        setServerError(true);
        setAllHospitals([]);
      }
    }
  }, []);

  const requestLocationPermission = useCallback(async () => {
    setIsLoading(true);
    setLocationError(null);
    try {
      let coords: LocationCoords;
      try {
        coords = await getLocationWeb();
        setLocationPermission("granted");
      } catch (err: unknown) {
        const geolocationError = err as GeolocationPositionError;
        if (geolocationError?.code === 1) {
          setLocationPermission("denied");
          setLocationError("Location permission denied. Please allow location access in your browser.");
        } else {
          setLocationError("Unable to get your location. Please try again.");
        }
        setIsLoading(false);
        return;
      }
      setLocation(coords);
      await loadHospitals(coords);
    } catch (err) {
      setLocationError("Unable to get your location. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [loadHospitals]);

  const refresh = useCallback(async () => {
    if (!location) {
      await requestLocationPermission();
      return;
    }
    setIsRefreshing(true);
    try {
      const coords = await getLocationWeb();
      setLocation(coords);
      await loadHospitals(coords);
    } catch (err) {
      console.error("Refresh failed:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, [location, loadHospitals, requestLocationPermission]);

  const setCategory = useCallback((category: HospitalCategory) => {
    setSelectedCategory(category);
  }, []);

  return (
    <HospitalContext.Provider
      value={{
        location, locationError, locationPermission, serverError,
        allHospitals, filteredHospitals, selectedCategory,
        availableCategories, isLoading, isRefreshing,
        requestLocationPermission, refresh, setCategory,
      }}
    >
      {children}
    </HospitalContext.Provider>
  );
}

export function useHospital(): HospitalContextValue {
  const ctx = useContext(HospitalContext);
  if (!ctx) throw new Error("useHospital must be used inside HospitalProvider");
  return ctx;
}
