import React from "react";
import { Hospital } from "@/types/hospital";
import { formatDistance } from "@/services/hospitalService";
import { buildDesignationGroups } from "@/services/designationUtils";

interface HospitalCardProps {
  hospital: Hospital;
  index: number;
  onPress: (hospital: Hospital) => void;
}

export function HospitalCard({ hospital, index, onPress }: HospitalCardProps) {
  // Verified Speciality only — never inferred categories or legacy designation text.
  const groups = buildDesignationGroups(hospital);
  const designationBadge = groups[0]
    ? (groups[0].subs[0] ? `${groups[0].label}: ${groups[0].subs[0]}` : groups[0].label)
    : null;
  const extraCount = Math.max(0, groups.length - 1);

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
          </div>
          {(hospital.address || hospital.city) && (
            <p className="text-xs text-muted-foreground truncate">
              {[hospital.address, hospital.city, hospital.state].filter(Boolean).join(", ")}
            </p>
          )}
          {hospital.phone && (
            <p className="text-xs text-muted-foreground mt-0.5">{hospital.phone}</p>
          )}
          {(designationBadge || hospital.helipad) && (
            <div className="flex flex-wrap items-center gap-1 mt-2">
              {designationBadge && (
                <span
                  className="text-xs px-1.5 py-0.5 bg-[#c0392b]/10 text-[#c0392b] rounded-md font-medium truncate max-w-full"
                  title="Verified Speciality"
                  data-testid={`badge-speciality-${hospital.id}`}
                >
                  {designationBadge}
                  {extraCount > 0 ? ` +${extraCount}` : ""}
                </span>
              )}
              {hospital.helipad && (
                <span className="text-xs px-1.5 py-0.5 border border-border text-muted-foreground rounded-md" title="Service, not a Speciality">
                  Helipad
                </span>
              )}
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
