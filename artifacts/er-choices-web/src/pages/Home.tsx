import React, { useState, useCallback, useEffect, lazy, Suspense } from "react";
import { useHospital } from "@/context/HospitalContext";
import { Hospital } from "@/types/hospital";
import { CategoryFilter } from "@/components/CategoryFilter";
import { HospitalCard } from "@/components/HospitalCard";
import { HospitalDetailPanel } from "@/components/HospitalDetailPanel";

const HospitalMap = lazy(() => import("@/components/HospitalMap").then(m => ({ default: m.HospitalMap })));

export function Home() {
  const {
    location, locationError, locationPermission,
    serverError, filteredHospitals, selectedCategory,
    availableCategories, isLoading, isRefreshing,
    requestLocationPermission, refresh, setCategory,
  } = useHospital();

  const [selectedHospital, setSelectedHospital] = useState<Hospital | null>(null);
  const [panelVisible, setPanelVisible] = useState(false);

  useEffect(() => {
    if (!isLoading && !location) {
      requestLocationPermission();
    }
  }, []);

  const handleHospitalPress = useCallback((hospital: Hospital) => {
    setSelectedHospital(hospital);
    setPanelVisible(true);
  }, []);

  const handleClosePanel = useCallback(() => {
    setPanelVisible(false);
  }, []);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-[#c0392b] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Finding nearby hospitals...</p>
        </div>
      </div>
    );
  }

  if (serverError) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-xs">
          <div className="text-5xl mb-4">📡</div>
          <h2 className="text-lg font-bold text-foreground mb-2">Navigation Server Down</h2>
          <p className="text-sm text-muted-foreground mb-4">The navigation server is currently unavailable. Please try again later.</p>
          <button
            onClick={refresh}
            className="px-5 py-2.5 bg-[#c0392b] text-white rounded-xl text-sm font-semibold hover:bg-[#a93226] transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (locationError || locationPermission === "denied") {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-xs">
          <div className="text-5xl mb-4">📍</div>
          <h2 className="text-lg font-bold text-foreground mb-2">Location Required</h2>
          <p className="text-sm text-muted-foreground mb-4">
            ER Choices needs your location to find nearby hospitals. Please grant location access to continue.
          </p>
          <button
            onClick={requestLocationPermission}
            className="px-5 py-2.5 bg-[#c0392b] text-white rounded-xl text-sm font-semibold hover:bg-[#a93226] transition-colors"
          >
            Enable Location
          </button>
          {locationError && (
            <p className="text-xs text-red-400 mt-3">{locationError}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-56 relative flex-shrink-0">
        <Suspense fallback={<div className="w-full h-full bg-muted flex items-center justify-center text-sm text-muted-foreground">Loading map...</div>}>
          <HospitalMap
            latitude={location?.latitude ?? null}
            longitude={location?.longitude ?? null}
            hospitals={filteredHospitals}
            onHospitalSelect={handleHospitalPress}
          />
        </Suspense>
        <button
          onClick={refresh}
          disabled={isRefreshing}
          className="absolute top-3 right-3 w-9 h-9 bg-card border border-border rounded-lg flex items-center justify-center shadow-md hover:bg-muted transition-colors z-10"
        >
          <span className={`text-sm ${isRefreshing ? "animate-spin" : ""}`}>🔄</span>
        </button>
      </div>

      {availableCategories.length > 0 && (
        <CategoryFilter
          selected={selectedCategory}
          onSelect={setCategory}
          availableCategories={availableCategories}
        />
      )}

      <div className="flex-1 overflow-y-auto">
        {filteredHospitals.length === 0 && !isLoading && location ? (
          <div className="flex items-center justify-center p-8">
            <div className="text-center max-w-xs">
              <div className="text-5xl mb-4">🏥</div>
              <h2 className="text-lg font-bold text-foreground mb-2">No Hospitals Found</h2>
              <p className="text-sm text-muted-foreground">We couldn't find any emergency rooms near your location.</p>
            </div>
          </div>
        ) : (
          <div className="py-2">
            {filteredHospitals.map((hospital, index) => (
              <HospitalCard
                key={hospital.id}
                hospital={hospital}
                index={index}
                onPress={handleHospitalPress}
              />
            ))}
          </div>
        )}
      </div>

      {panelVisible && (
        <HospitalDetailPanel
          hospital={selectedHospital}
          onClose={handleClosePanel}
        />
      )}
    </div>
  );
}
