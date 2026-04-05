import React from "react";
import { Hospital } from "@/types/hospital";
import { formatDistance } from "@/services/hospitalService";

interface HospitalCardProps {
  hospital: Hospital;
  index: number;
  onPress: (hospital: Hospital) => void;
}

export function HospitalCard({ hospital, index, onPress }: HospitalCardProps) {
  const designationBadge = hospital.actualDesignation
    ? hospital.actualDesignation.split(";")[0].trim()
    : null;

  return (
    <button
      onClick={() => onPress(hospital)}
      className="w-full text-left bg-card border border-border rounded-xl px-4 py-4 mx-4 mb-3 hover:border-[#c0392b]/40 transition-colors active:bg-muted"
      style={{ width: "calc(100% - 32px)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-muted-foreground font-medium">#{index + 1}</span>
            <h3 className="text-sm font-semibold text-foreground truncate">{hospital.name}</h3>
            {hospital.helipad && (
              <span className="text-xs flex-shrink-0" title="Helipad available">✈️</span>
            )}
          </div>
          {(hospital.address || hospital.city) && (
            <p className="text-xs text-muted-foreground truncate">
              {[hospital.address, hospital.city, hospital.state].filter(Boolean).join(", ")}
            </p>
          )}
          {hospital.phone && (
            <p className="text-xs text-muted-foreground mt-0.5">📞 {hospital.phone}</p>
          )}
          {designationBadge && (
            <div className="flex flex-wrap gap-1 mt-2">
              <span className="text-xs px-1.5 py-0.5 bg-[#c0392b]/10 text-[#c0392b] rounded-md font-medium">
                {designationBadge}
              </span>
            </div>
          )}
        </div>
        {hospital.distance != null && (
          <div className="flex-shrink-0 text-right">
            <span className="text-sm font-bold text-[#c0392b]">{formatDistance(hospital.distance)}</span>
            <p className="text-xs text-muted-foreground">away</p>
          </div>
        )}
      </div>
    </button>
  );
}
