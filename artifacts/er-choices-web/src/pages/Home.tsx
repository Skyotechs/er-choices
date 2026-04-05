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
    serverError, filteredHospitals, selectedFilter,
    availableFilters, isLoading, isRefreshing,
    requestLocationPermission, refresh, setFilter,
  } = useHospital();

  const [selectedHospital, setSelectedHospital] = useState<Hospital | null>(null);
  const [panelVisible, setPanelVisible] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(30);

  useEffect(() => {
    if (!isLoading && !location) {
      requestLocationPermission();
    }
  }, []);

  useEffect(() => {
    if (!serverError) {
      setRetryCountdown(30);
      return;
    }
    setRetryCountdown(30);
    const interval = setInterval(() => {
      setRetryCountdown((c) => {
        if (c <= 1) {
          refresh();
          return 30;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [serverError, refresh]);

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
          <h2 className="text-lg font-bold text-foreground mb-2">Server Updating</h2>
          <p className="text-sm text-muted-foreground mb-4">The server is being updated. Retrying in {retryCountdown}s...</p>
          <button
            onClick={() => { setRetryCountdown(30); refresh(); }}
            className="px-5 py-2.5 bg-[#c0392b] text-white rounded-xl text-sm font-semibold hover:bg-[#a93226] transition-colors"
          >
            Retry Now
          </button>
        </div>
      </div>
    );
  }

  if (locationError || locationPermission === "denied") {
    const isDenied = locationPermission === "denied";
    const ua = navigator.userAgent;
    const isIosSafari =
      /iPad|iPhone|iPod/.test(ua) &&
      /Safari/.test(ua) &&
      !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua);

    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-xs">
          <div className="text-5xl mb-4">📍</div>
          <h2 className="text-lg font-bold text-foreground mb-2">Location Required</h2>

          {isDenied ? (
            <>
              <p className="text-sm text-muted-foreground mb-4">
                Location access was blocked for this site. Follow these steps to re-enable it:
              </p>
              {isIosSafari ? (
                <ol className="text-left text-sm text-muted-foreground space-y-2 mb-5 bg-muted/40 rounded-xl p-4">
                  <li><span className="font-semibold text-foreground">1.</span> Tap the <span className="font-semibold text-foreground">aA</span> icon in the Safari address bar</li>
                  <li><span className="font-semibold text-foreground">2.</span> Tap <span className="font-semibold text-foreground">Website Settings</span></li>
                  <li><span className="font-semibold text-foreground">3.</span> Set <span className="font-semibold text-foreground">Location</span> to <span className="font-semibold text-foreground">Allow</span></li>
                  <li><span className="font-semibold text-foreground">4.</span> Tap <span className="font-semibold text-foreground">Done</span>, then come back here</li>
                </ol>
              ) : (
                <ol className="text-left text-sm text-muted-foreground space-y-2 mb-5 bg-muted/40 rounded-xl p-4">
                  <li><span className="font-semibold text-foreground">1.</span> Click the <span className="font-semibold text-foreground">lock icon</span> in your browser's address bar</li>
                  <li><span className="font-semibold text-foreground">2.</span> Set <span className="font-semibold text-foreground">Location</span> to <span className="font-semibold text-foreground">Allow</span></li>
                  <li><span className="font-semibold text-foreground">3.</span> Reload the page</li>
                </ol>
              )}
              <button
                onClick={requestLocationPermission}
                className="px-5 py-2.5 bg-[#c0392b] text-white rounded-xl text-sm font-semibold hover:bg-[#a93226] transition-colors"
              >
                I've Enabled It — Try Again
              </button>
            </>
          ) : (
            <>
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
            </>
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

      {availableFilters.length > 0 && (
        <CategoryFilter
          selected={selectedFilter}
          onSelect={setFilter}
          availableFilters={availableFilters}
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
