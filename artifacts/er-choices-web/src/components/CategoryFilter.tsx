import React from "react";
import { HospitalCategory, CATEGORIES } from "@/types/hospital";

const CATEGORY_ICONS: Record<HospitalCategory, string> = {
  All: "🏥",
  Trauma: "🚑",
  Stroke: "🧠",
  Cardiac: "❤️",
  Pediatric: "👶",
  Obstetrics: "🤰",
  Burn: "🔥",
  Psychiatric: "🧩",
  Cancer: "🎗️",
  HazMat: "☣️",
};

interface CategoryFilterProps {
  selected: HospitalCategory;
  onSelect: (category: HospitalCategory) => void;
  availableCategories?: HospitalCategory[];
}

export function CategoryFilter({ selected, onSelect, availableCategories }: CategoryFilterProps) {
  const displayCategories = availableCategories ?? CATEGORIES;

  return (
    <div className="border-b border-border bg-background">
      <div className="flex gap-2 px-4 py-2.5 overflow-x-auto scrollbar-none">
        {displayCategories.map((category) => {
          const isSelected = selected === category;
          return (
            <button
              key={category}
              onClick={() => onSelect(category)}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap
                border transition-colors flex-shrink-0
                ${isSelected
                  ? "bg-[#c0392b] border-[#c0392b] text-white"
                  : "bg-card border-border text-foreground hover:border-[#c0392b]/40"
                }
              `}
            >
              <span className="text-xs">{CATEGORY_ICONS[category]}</span>
              {category}
            </button>
          );
        })}
      </div>
    </div>
  );
}
