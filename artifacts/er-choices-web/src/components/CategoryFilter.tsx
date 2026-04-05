import React from "react";
import { DesignationFilter, DESIGNATION_FILTERS } from "@/types/hospital";

const FILTER_ICONS: Record<DesignationFilter, string> = {
  All: "🏥",
  "Trauma I": "🚑",
  "Trauma II": "🚑",
  "Trauma III": "🚑",
  "Trauma IV": "🚑",
  Stroke: "🧠",
  Burn: "🔥",
  "PCI/STEMI": "❤️",
  "Critical Access": "🏨",
  Psychiatric: "🧩",
};

interface CategoryFilterProps {
  selected: DesignationFilter;
  onSelect: (filter: DesignationFilter) => void;
  availableFilters?: DesignationFilter[];
}

export function CategoryFilter({ selected, onSelect, availableFilters }: CategoryFilterProps) {
  const displayFilters = availableFilters ?? DESIGNATION_FILTERS;

  return (
    <div className="border-b border-border bg-background">
      <div className="flex gap-2 px-4 py-2.5 overflow-x-auto scrollbar-none">
        {displayFilters.map((filter) => {
          const isSelected = selected === filter;
          return (
            <button
              key={filter}
              onClick={() => onSelect(filter)}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap
                border transition-colors flex-shrink-0
                ${isSelected
                  ? "bg-[#c0392b] border-[#c0392b] text-white"
                  : "bg-card border-border text-foreground hover:border-[#c0392b]/40"
                }
              `}
            >
              <span className="text-xs">{FILTER_ICONS[filter]}</span>
              {filter}
            </button>
          );
        })}
      </div>
    </div>
  );
}
