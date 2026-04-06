import React, { useState } from "react";
import { Hospital } from "@/types/hospital";
import { formatDistance } from "@/services/hospitalService";
import { normalizeDesignation } from "@/services/designationUtils";
import { ReportModal } from "./ReportModal";

interface HospitalDetailPanelProps {
  hospital: Hospital | null;
  onClose: () => void;
}

export function HospitalDetailPanel({ hospital, onClose }: HospitalDetailPanelProps) {
  const [reportVisible, setReportVisible] = useState(false);

  if (!hospital) return null;

  const fullAddress = [hospital.address, hospital.city, hospital.state, hospital.zip]
    .filter(Boolean)
    .join(", ");

  const googleMapsUrl = fullAddress
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fullAddress)}&travelmode=driving`
    : `https://www.google.com/maps/dir/?api=1&destination=${hospital.latitude},${hospital.longitude}&travelmode=driving`;

  const appleMapsUrl = fullAddress
    ? `https://maps.apple.com/?daddr=${encodeURIComponent(fullAddress)}&dirflg=d`
    : `https://maps.apple.com/?daddr=${hospital.latitude},${hospital.longitude}&dirflg=d`;

  const wazeUrl = `https://waze.com/ul?ll=${hospital.latitude},${hospital.longitude}&navigate=yes`;

  const primaryChips = (hospital.categories as string[]).filter((c) => c !== "All");

  const secondaryLines: { icon: string; label: string }[] = [];
  if (hospital.strokeDesignation) secondaryLines.push({ icon: "🧠", label: hospital.strokeDesignation });
  if (hospital.burnDesignation) secondaryLines.push({ icon: "🔥", label: hospital.burnDesignation });
  if (hospital.pciCapability) secondaryLines.push({ icon: "❤️", label: hospital.pciCapability });
  if (hospital.helipad) secondaryLines.push({ icon: "✈️", label: "Helipad available" });

  const hasDesignationSection =
    primaryChips.length > 0 ||
    hospital.actualDesignation ||
    secondaryLines.length > 0;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-[1000]"
        onClick={onClose}
      />
      <div className="fixed bottom-0 left-0 right-0 z-[1001] bg-card border-t border-border rounded-t-2xl shadow-2xl max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom duration-300">
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

        {hasDesignationSection && (
          <>
            <div className="h-px bg-border" />
            <div className="px-5 py-4">
              <p className="text-xs font-semibold text-muted-foreground tracking-widest mb-3">DESIGNATIONS</p>

              {primaryChips.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {primaryChips.map((cat) => (
                    <span
                      key={cat}
                      className="px-3 py-1 rounded-full text-sm font-medium"
                      style={{ backgroundColor: "rgba(192,57,43,0.1)", color: "#c0392b" }}
                    >
                      {cat}
                    </span>
                  ))}
                </div>
              )}

              {hospital.actualDesignation && (
                <ul className="space-y-1 mb-2">
                  {hospital.actualDesignation.split(";").map((seg) => seg.trim()).filter(Boolean).map((seg) => (
                    <li key={seg} className="text-sm text-muted-foreground">
                      {normalizeDesignation(seg)}
                    </li>
                  ))}
                </ul>
              )}

              {secondaryLines.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {secondaryLines.map(({ icon, label }) => (
                    <span
                      key={label}
                      className="px-3 py-1 rounded-full text-sm font-medium bg-muted text-foreground"
                    >
                      {icon} {label}
                    </span>
                  ))}
                </div>
              )}
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
