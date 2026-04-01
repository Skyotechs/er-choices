import React, { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from "react-native";
import { Ionicons, MaterialIcons, FontAwesome5 } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { Hospital, HospitalCategory } from "@/types/hospital";
import { formatDistance } from "@/services/hospitalService";

const CATEGORY_ICONS: Record<HospitalCategory, string> = {
  All: "medical-bag",
  Trauma: "ambulance",
  Stroke: "brain",
  Obstetrics: "baby-carriage",
  Burn: "fire",
  Pediatric: "baby",
  Psychiatric: "head-side-brain",
  Cardiac: "heartbeat",
  Cancer: "ribbon",
};

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

  const primaryCategory = hospital.categories[0] ?? "All";
  const iconName = CATEGORY_ICONS[primaryCategory] ?? "medical-bag";

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

      <View
        style={[
          styles.iconContainer,
          { backgroundColor: colors.primary + "15", borderRadius: colors.radius - 4 },
        ]}
      >
        <FontAwesome5
          name={iconName}
          size={20}
          color={colors.primary}
          solid
        />
      </View>

      <View style={styles.info}>
        <Text
          style={[styles.name, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {hospital.name}
        </Text>
        <Text
          style={[styles.address, { color: colors.mutedForeground }]}
          numberOfLines={1}
        >
          {hospital.address}, {hospital.city}, {hospital.state}
        </Text>
        <View style={styles.tagsRow}>
          {hospital.categories.slice(0, 3).map((cat) => (
            <View
              key={cat}
              style={[
                styles.tag,
                { backgroundColor: colors.primary + "18", borderRadius: 6 },
              ]}
            >
              <Text style={[styles.tagText, { color: colors.primary }]}>
                {cat}
              </Text>
            </View>
          ))}
        </View>
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
  iconContainer: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
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
  address: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 2,
  },
  tag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  tagText: {
    fontSize: 10,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.2,
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
