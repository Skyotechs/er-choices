import React from "react";
import { View, StyleSheet, Text } from "react-native";
import { useColors } from "@/hooks/useColors";
import { Hospital } from "@/types/hospital";

interface MapSectionProps {
  latitude: number | null;
  longitude: number | null;
  hospitals: Hospital[];
  onHospitalPress: (hospital: Hospital) => void;
}

export function MapSection({
  latitude,
  longitude,
}: MapSectionProps) {
  const colors = useColors();

  if (!latitude || !longitude) {
    return (
      <View style={[styles.container, { backgroundColor: colors.muted }]}>
        <Text style={[styles.text, { color: colors.mutedForeground }]}>
          Enable location to see map
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: "#dbeafe" }]}>
      <Text style={[styles.label, { color: "#1e40af" }]}>
        Map view available on iPhone via Expo Go
      </Text>
      <Text style={[styles.coords, { color: "#3b82f6" }]}>
        {latitude.toFixed(5)}, {longitude.toFixed(5)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },
  text: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  label: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    textAlign: "center",
    paddingHorizontal: 20,
  },
  coords: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
});
