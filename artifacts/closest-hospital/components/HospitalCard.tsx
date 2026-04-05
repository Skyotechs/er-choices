import React, { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Linking,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { Hospital } from "@/types/hospital";
import { formatDistance, normalizeDesignation } from "@/services/hospitalService";

interface HospitalCardProps {
  hospital: Hospital;
  index: number;
  onPress: (hospital: Hospital) => void;
}

export function HospitalCard({ hospital, index, onPress }: HospitalCardProps) {
  const colors = useColors();

  const handlePress = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress(hospital);
  }, [hospital, onPress]);

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
        },
      ]}
      onPress={handlePress}
      activeOpacity={0.75}
    >
      <View style={styles.indexBadge}>
        <Text style={[styles.indexText, { color: colors.mutedForeground }]}>
          {index + 1}
        </Text>
      </View>

      <View style={styles.info}>
        <Text
          style={[styles.name, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {hospital.name}
        </Text>

        {(() => {
          const badge = hospital.actualDesignation
            ? normalizeDesignation(hospital.actualDesignation.split(";")[0].trim())
            : (hospital.categories as string[]).filter((c) => c !== "All")[0] ?? null;
          return (badge || hospital.helipad) ? (
            <View style={styles.badgeRow}>
              {badge ? (
                <View style={[styles.designationBadge, { backgroundColor: colors.muted }]}>
                  <Text
                    style={[styles.designationText, { color: colors.primary }]}
                    numberOfLines={1}
                  >
                    {badge}
                  </Text>
                </View>
              ) : null}
              {hospital.helipad ? (
                <Text style={styles.helipadIcon}>✈️</Text>
              ) : null}
            </View>
          ) : null;
        })()}

        <Text
          style={[styles.address, { color: colors.mutedForeground }]}
          numberOfLines={1}
        >
          {[hospital.address, hospital.city, hospital.state].filter(Boolean).join(", ")}
        </Text>
        {hospital.phone ? (
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              Linking.openURL(`tel:${hospital.phone}`);
            }}
            activeOpacity={0.6}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
          >
            <Text style={[styles.phone, { color: colors.primary }]}>
              {hospital.phone}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.right}>
        <Text style={[styles.distance, { color: colors.primary }]}>
          {formatDistance(hospital.distance ?? 0)}
        </Text>
        <MaterialIcons
          name="directions"
          size={20}
          color={colors.mutedForeground}
          style={{ marginTop: 4 }}
        />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 10,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  indexBadge: {
    width: 22,
    alignItems: "center",
    marginRight: 10,
  },
  indexText: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  info: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.2,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 1,
  },
  designationBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  helipadIcon: {
    fontSize: 13,
  },
  designationText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.1,
  },
  address: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  phone: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginTop: 1,
  },
  right: {
    alignItems: "flex-end",
    justifyContent: "center",
    minWidth: 52,
    marginLeft: 8,
  },
  distance: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
});
