import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
} from "react";
import { Platform } from "react-native";
import { Hospital, HospitalCategory } from "@/types/hospital";
import {
  fetchNearbyHospitals,
  filterAndSortHospitals,
} from "@/services/hospitalService";

interface LocationCoords {
  latitude: number;
  longitude: number;
}

type PermStatus = "granted" | "denied" | "undetermined" | null;

interface HospitalContextValue {
  location: LocationCoords | null;
  locationError: string | null;
  locationPermission: PermStatus;
  allHospitals: Hospital[];
  filteredHospitals: Hospital[];
  selectedCategory: HospitalCategory;
  isLoading: boolean;
  isRefreshing: boolean;
  requestLocationPermission: () => Promise<void>;
  refresh: () => Promise<void>;
  setCategory: (category: HospitalCategory) => void;
}

const HospitalContext = createContext<HospitalContextValue | null>(null);

async function getLocationNative(): Promise<LocationCoords> {
  const Location = require("expo-location");
  const loc = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return {
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
  };
}

async function getLocationWeb(): Promise<LocationCoords> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

async function requestPermissionNative(): Promise<PermStatus> {
  const Location = require("expo-location");
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status as PermStatus;
}

export function HospitalProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useState<LocationCoords | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationPermission, setLocationPermission] = useState<PermStatus>(null);
  const [allHospitals, setAllHospitals] = useState<Hospital[]>([]);
  const [selectedCategory, setSelectedCategory] =
    useState<HospitalCategory>("All");
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const filteredHospitals = filterAndSortHospitals(allHospitals, selectedCategory, 10);

  const loadHospitals = useCallback(async (coords: LocationCoords) => {
    try {
      const hospitals = await fetchNearbyHospitals(
        coords.latitude,
        coords.longitude
      );
      setAllHospitals(hospitals);
    } catch (err) {
      console.error("Failed to fetch hospitals:", err);
    }
  }, []);

  const requestLocationPermission = useCallback(async () => {
    setIsLoading(true);
    setLocationError(null);
    try {
      let coords: LocationCoords;

      if (Platform.OS === "web") {
        try {
          coords = await getLocationWeb();
          setLocationPermission("granted");
        } catch (err: any) {
          if (err?.code === 1) {
            setLocationPermission("denied");
            setLocationError("Location permission denied. Please allow location access in your browser.");
          } else {
            setLocationError("Unable to get your location. Please try again.");
          }
          setIsLoading(false);
          return;
        }
      } else {
        const status = await requestPermissionNative();
        setLocationPermission(status);
        if (status !== "granted") {
          setLocationError("Location permission is required to find nearby hospitals.");
          setIsLoading(false);
          return;
        }
        coords = await getLocationNative();
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
      let coords: LocationCoords;
      if (Platform.OS === "web") {
        coords = await getLocationWeb();
      } else {
        coords = await getLocationNative();
      }
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
        location,
        locationError,
        locationPermission,
        allHospitals,
        filteredHospitals,
        selectedCategory,
        isLoading,
        isRefreshing,
        requestLocationPermission,
        refresh,
        setCategory,
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
