import React, { useEffect, useRef } from "react";
import type { Map as LeafletMap, Marker, TileLayer } from "leaflet";
import { Hospital } from "@/types/hospital";

interface HospitalMapProps {
  latitude: number | null;
  longitude: number | null;
  hospitals: Hospital[];
  onHospitalSelect: (hospital: Hospital) => void;
}

export function HospitalMap({ latitude, longitude, hospitals, onHospitalSelect }: HospitalMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const userMarkerRef = useRef<Marker | null>(null);
  const tileLayerRef = useRef<TileLayer | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    let cancelled = false;

    import("leaflet").then(async (L) => {
      if (cancelled || mapRef.current) return;

      await import("leaflet/dist/leaflet.css");

      const map = L.map(mapContainerRef.current!, {
        center: [latitude ?? 39.5, longitude ?? -98.35],
        zoom: latitude ? 11 : 4,
        zoomControl: true,
      });

      tileLayerRef.current = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;
    });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        tileLayerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || latitude === null || longitude === null) return;

    import("leaflet").then((L) => {
      if (!mapRef.current) return;

      if (userMarkerRef.current) {
        userMarkerRef.current.remove();
        userMarkerRef.current = null;
      }

      const userIcon = L.divIcon({
        html: `<div style="width:14px;height:14px;background:#3b82f6;border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.5)"></div>`,
        className: "",
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      userMarkerRef.current = L.marker([latitude, longitude], { icon: userIcon })
        .addTo(mapRef.current)
        .bindPopup("Your Location");

      mapRef.current.setView([latitude, longitude], 11);
    });
  }, [latitude, longitude]);

  useEffect(() => {
    if (!mapRef.current) return;

    import("leaflet").then((L) => {
      if (!mapRef.current) return;

      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      hospitals.forEach((h) => {
        if (!mapRef.current) return;

        const hospitalIcon = L.divIcon({
          html: `<div style="background:#c0392b;color:white;font-size:10px;font-weight:bold;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4)">H</div>`,
          className: "",
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });

        const marker = L.marker([h.latitude, h.longitude], { icon: hospitalIcon })
          .addTo(mapRef.current!)
          .bindPopup(`<strong>${h.name}</strong>`);

        marker.on("click", () => onHospitalSelect(h));
        markersRef.current.push(marker);
      });
    });
  }, [hospitals, onHospitalSelect]);

  return (
    <div ref={mapContainerRef} className="w-full h-full" />
  );
}
