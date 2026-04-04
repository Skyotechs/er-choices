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
import { DesignationFilter } from "@/types/hospital";

type IconSpec =
  | { lib: "fa5"; name: string }
  | { lib: "mci"; name: string };

const FILTER_ICONS: Record<DesignationFilter, IconSpec> = {
  All:            { lib: "mci", name: "hospital-box" },
  "Trauma I":     { lib: "fa5", name: "ambulance" },
  "Trauma II":    { lib: "fa5", name: "ambulance" },
  "Trauma III":   { lib: "fa5", name: "ambulance" },
  "Trauma IV":    { lib: "fa5", name: "ambulance" },
  Stroke:         { lib: "fa5", name: "brain" },
  Burn:           { lib: "fa5", name: "fire" },
  "PCI/STEMI":    { lib: "fa5", name: "heartbeat" },
  "Critical Access": { lib: "mci", name: "hospital-building" },
  Psychiatric:    { lib: "mci", name: "head-cog" },
};

interface CategoryFilterProps {
  selected: DesignationFilter;
  onSelect: (filter: DesignationFilter) => void;
  availableFilters: DesignationFilter[];
}

function FilterChip({
  filter,
  isSelected,
  onSelect,
}: {
  filter: DesignationFilter;
  isSelected: boolean;
  onSelect: (f: DesignationFilter) => void;
}) {
  const colors = useColors();
  const icon = FILTER_ICONS[filter];

  const handlePress = () => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    onSelect(filter);
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
        {filter}
      </Text>
    </TouchableOpacity>
  );
}

export function CategoryFilter({ selected, onSelect, availableFilters }: CategoryFilterProps) {
  const colors = useColors();

  return (
    <View style={[styles.wrapper, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        bounces={true}
      >
        {availableFilters.map((filter) => (
          <FilterChip
            key={filter}
            filter={filter}
            isSelected={selected === filter}
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
