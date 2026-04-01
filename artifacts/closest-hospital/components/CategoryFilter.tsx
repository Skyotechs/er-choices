import React, { useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from "react-native";
import { FontAwesome5, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { HospitalCategory, CATEGORIES } from "@/types/hospital";

const CATEGORY_ICONS: Record<HospitalCategory, { lib: "fa5" | "mci"; name: string }> = {
  All: { lib: "mci", name: "hospital-box" },
  Trauma: { lib: "fa5", name: "ambulance" },
  Stroke: { lib: "fa5", name: "brain" },
  Cardiac: { lib: "fa5", name: "heartbeat" },
  Pediatric: { lib: "fa5", name: "baby" },
  Obstetrics: { lib: "fa5", name: "baby-carriage" },
  Burn: { lib: "fa5", name: "fire" },
  Psychiatric: { lib: "mci", name: "head-cog" },
  Cancer: { lib: "fa5", name: "ribbon" },
};

interface CategoryFilterProps {
  selected: HospitalCategory;
  onSelect: (category: HospitalCategory) => void;
  /** Subset of CATEGORIES to display (always includes "All"). Falls back to all CATEGORIES if omitted. */
  availableCategories?: HospitalCategory[];
}

function CategoryChip({
  category,
  isSelected,
  onSelect,
}: {
  category: HospitalCategory;
  isSelected: boolean;
  onSelect: (c: HospitalCategory) => void;
}) {
  const colors = useColors();
  const icon = CATEGORY_ICONS[category];

  const handlePress = () => {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync();
    }
    onSelect(category);
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      style={[
        styles.chip,
        {
          backgroundColor: isSelected ? colors.primary : colors.card,
          borderColor: isSelected ? colors.primary : colors.border,
          borderRadius: colors.radius,
        },
      ]}
      activeOpacity={0.7}
    >
      {icon.lib === "fa5" ? (
        <FontAwesome5
          name={icon.name}
          size={13}
          color={isSelected ? colors.primaryForeground : colors.mutedForeground}
          solid
          style={styles.chipIcon}
        />
      ) : (
        <MaterialCommunityIcons
          name={icon.name as any}
          size={15}
          color={isSelected ? colors.primaryForeground : colors.mutedForeground}
          style={styles.chipIcon}
        />
      )}
      <Text
        style={[
          styles.chipText,
          {
            color: isSelected ? colors.primaryForeground : colors.foreground,
            fontFamily: isSelected ? "Inter_600SemiBold" : "Inter_500Medium",
          },
        ]}
      >
        {category}
      </Text>
    </TouchableOpacity>
  );
}

export function CategoryFilter({ selected, onSelect, availableCategories }: CategoryFilterProps) {
  const colors = useColors();
  const displayCategories = availableCategories ?? CATEGORIES;

  return (
    <View style={[styles.wrapper, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        bounces={true}
      >
        {displayCategories.map((category) => (
          <CategoryChip
            key={category}
            category={category}
            isSelected={selected === category}
            onSelect={onSelect}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderBottomWidth: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    flexDirection: "row",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
  },
  chipIcon: {
    marginRight: 5,
  },
  chipText: {
    fontSize: 13,
    letterSpacing: 0.1,
  },
});
