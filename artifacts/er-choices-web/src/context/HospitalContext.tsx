import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { Hospital, HospitalCategory, DesignationFilter } from "@/types/hospital";
import {
  fetchNearbyHospitals,
  fetchVerifiedSpecialtyMap,
  filterAndSortHospitals,
  NavigationServerError,
} from "@/services/hospitalService";
import { computeAvailableFilters } from "@/services/designationUtils";

const API_BASE = import.meta.env.VITE_API_BASE
  ? import.meta.env.VITE_API_BASE.replace(/\/$/, "")
  : `${window.location.origin}/api`;

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
  selectedFilter: DesignationFilter;
  availableFilters: DesignationFilter[];
  isLoading: boolean;
  isRefreshing: boolean;
  requestLocationPermission: () => Promise<void>;
  refresh: () => Promise<void>;
  setFilter: (filter: DesignationFilter) => void;
}

const HospitalContext = createContext<HospitalContextValue | null>(null);

async function getLocationWeb(): Promise<LocationCoords> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported"));
      return;
    }

    let watchId: number | undefined;
    let settled = false;
    let bestCoords: GeolocationCoordinates | null = null;

    const cleanup = () => {
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
    };

    const accept = (coords: GeolocationCoordinates) => {
      if (settled) return;
      settled = true;
      cleanup();
      clearTimeout(maxWaitTimer);
      resolve({ latitude: coords.latitude, longitude: coords.longitude });
    };

    const maxWaitTimer = setTimeout(() => {
      if (bestCoords) {
        accept(bestCoords);
      } else if (!settled) {
        settled = true;
        cleanup();
        reject(new Error("Location timeout"));
      }
    }, 15000);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        bestCoords = pos.coords;
        if (pos.coords.accuracy <= 150) {
          accept(pos.coords);
        }
      },
      (err) => {
        clearTimeout(maxWaitTimer);
        if (!settled) {
          settled = true;
          cleanup();
          reject(err);
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

export function HospitalProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useState<LocationCoords | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationPermission, setLocationPermission] = useState<PermStatus>(null);
  const [allHospitals, setAllHospitals] = useState<Hospital[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<DesignationFilter>("All");
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [serverError, setServerError] = useState(false);
  const [verifiedSpecialtyMap, setVerifiedSpecialtyMap] = useState<Record<string, HospitalCategory[]>>({});
  const verifiedMapRef = useRef<Record<string, HospitalCategory[]>>({});

  const filteredHospitals = filterAndSortHospitals(allHospitals, selectedFilter, 10);
  const availableFilters = computeAvailableFilters(allHospitals);

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

  const setFilter = useCallback((filter: DesignationFilter) => {
    setSelectedFilter(filter);
  }, []);

  return (
    <HospitalContext.Provider
      value={{
        location, locationError, locationPermission, serverError,
        allHospitals, filteredHospitals, selectedFilter,
        availableFilters, isLoading, isRefreshing,
        requestLocationPermission, refresh, setFilter,
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
