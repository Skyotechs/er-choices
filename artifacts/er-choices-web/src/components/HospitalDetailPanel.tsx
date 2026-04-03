import React, { useState } from "react";
import { Hospital } from "@/types/hospital";
import { formatDistance } from "@/services/hospitalService";
import { ReportModal } from "./ReportModal";

function specialtyLabel(key: string): string {
  return key.replace(/ - /g, " – ");
}

function specialtyColor(key: string): string {
  if (key.startsWith("Trauma"))            return "bg-red-900/50 text-red-300 border-red-800";
  if (key.startsWith("Stroke"))            return "bg-purple-900/50 text-purple-300 border-purple-800";
  if (key.startsWith("Cardiac"))           return "bg-rose-900/50 text-rose-300 border-rose-800";
  if (key.startsWith("Burn"))              return "bg-orange-900/50 text-orange-300 border-orange-800";
  if (key.startsWith("Pediatric"))         return "bg-blue-900/50 text-blue-300 border-blue-800";
  if (key.startsWith("Obstetrics"))        return "bg-pink-900/50 text-pink-300 border-pink-800";
  if (key.startsWith("Behavioral"))        return "bg-indigo-900/50 text-indigo-300 border-indigo-800";
  if (key.startsWith("HazMat"))            return "bg-amber-900/50 text-amber-300 border-amber-800";
  return "bg-slate-800 text-slate-300 border-slate-700";
}

interface HospitalDetailPanelProps {
  hospital: Hospital | null;
  onClose: () => void;
}

export function HospitalDetailPanel({ hospital, onClose }: HospitalDetailPanelProps) {
  const [reportVisible, setReportVisible] = useState(false);

  if (!hospital) return null;

  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${hospital.latitude},${hospital.longitude}&travelmode=driving`;
  const appleMapsUrl = `https://maps.apple.com/?daddr=${hospital.latitude},${hospital.longitude}&dirflg=d`;
  const wazeUrl = `https://waze.com/ul?ll=${hospital.latitude},${hospital.longitude}&navigate=yes`;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border rounded-t-2xl shadow-2xl max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom duration-300">
        <div className="w-9 h-1 bg-border rounded-full mx-auto mt-3 mb-4" />

        <div className="px-5 pb-4">
          <h2 className="text-lg font-bold text-foreground leading-tight">{hospital.name}</h2>
          {(hospital.address || hospital.city) && (
            <p className="text-sm text-muted-foreground mt-1">
              {[hospital.address, hospital.city, hospital.state].filter(Boolean).join(", ")}
            </p>
          )}
          {hospital.distance != null && (
            <div className="flex items-center gap-1 mt-2">
              <span className="text-sm text-[#c0392b]">📍</span>
              <span className="text-sm font-semibold text-[#c0392b]">{formatDistance(hospital.distance)} away</span>
            </div>
          )}
          {hospital.phone && (
            <a
              href={`tel:${hospital.phone}`}
              className="flex items-center gap-2 mt-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>📞</span>
              <span>{hospital.phone}</span>
            </a>
          )}
        </div>

        {hospital.specialties && hospital.specialties.length > 0 && (
          <>
            <div className="h-px bg-border" />
            <div className="px-5 py-4">
              <p className="text-xs font-semibold text-muted-foreground tracking-widest mb-3">DESIGNATIONS</p>
              <div className="flex flex-wrap gap-2">
                {hospital.specialties.map((s) => (
                  <span
                    key={s}
                    className={`text-xs font-medium px-2.5 py-1 rounded-full border ${specialtyColor(s)}`}
                  >
                    {specialtyLabel(s)}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="h-px bg-border mb-4" />

        <div className="px-5">
          <p className="text-xs font-semibold text-muted-foreground tracking-widest mb-3">OPEN IN MAPS</p>

          <a
            href={appleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-3.5 border border-border rounded-xl mb-2.5 hover:border-[#c0392b]/40 transition-colors"
          >
            <span className="text-xl">🗺️</span>
            <span className="flex-1 text-sm font-medium text-foreground">Apple Maps</span>
            <span className="text-muted-foreground">›</span>
          </a>

          <a
            href={googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-3.5 border border-border rounded-xl mb-2.5 hover:border-[#4285F4]/40 transition-colors"
          >
            <span className="text-xl">🌐</span>
            <span className="flex-1 text-sm font-medium text-foreground">Google Maps</span>
            <span className="text-muted-foreground">›</span>
          </a>

          <a
            href={wazeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-3.5 border border-border rounded-xl mb-4 hover:border-[#33CCFF]/40 transition-colors"
          >
            <span className="text-xl">🚗</span>
            <span className="flex-1 text-sm font-medium text-foreground">Waze</span>
            <span className="text-muted-foreground">›</span>
          </a>
        </div>

        <div className="h-px bg-border mb-3" />

        <div className="px-5 pb-6">
          <button
            onClick={() => setReportVisible(true)}
            className="flex items-center justify-center gap-2 w-full py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>🚩</span>
            <span>Report incorrect information</span>
          </button>

          <button
            onClick={onClose}
            className="w-full py-3.5 border border-border rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted transition-colors mt-2"
          >
            Cancel
          </button>
        </div>
      </div>

      <ReportModal
        hospital={hospital}
        visible={reportVisible}
        onClose={() => setReportVisible(false)}
      />
    </>
  );
}
