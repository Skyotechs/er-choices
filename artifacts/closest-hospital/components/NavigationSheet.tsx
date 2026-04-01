import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Linking,
  Platform,
} from "react-native";
import { FontAwesome5, MaterialIcons, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { Hospital } from "@/types/hospital";
import { formatDistance } from "@/services/hospitalService";
import { ReportModal } from "./ReportModal";

interface NavigationSheetProps {
  hospital: Hospital | null;
  visible: boolean;
  onClose: () => void;
}

interface MapOption {
  id: string;
  label: string;
  icon: React.ReactNode;
  buildUrl: (lat: number, lon: number, name: string) => string;
  appScheme?: string;
}

export function NavigationSheet({
  hospital,
  visible,
  onClose,
}: NavigationSheetProps) {
  const colors = useColors();
  const [reportVisible, setReportVisible] = useState(false);

  const openMap = useCallback(
    async (option: MapOption) => {
      if (!hospital) return;

      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      const url = option.buildUrl(
        hospital.latitude,
        hospital.longitude,
        hospital.name
      );

      try {
        const canOpen = await Linking.canOpenURL(url);
        if (canOpen) {
          await Linking.openURL(url);
        } else {
          const fallbackUrl = `https://maps.apple.com/?daddr=${hospital.latitude},${hospital.longitude}&dirflg=d`;
          await Linking.openURL(fallbackUrl);
        }
      } catch (err) {
        console.error("Failed to open map:", err);
      }

      onClose();
    },
    [hospital, onClose]
  );

  const mapOptions: MapOption[] = [
    {
      id: "apple",
      label: "Apple Maps",
      icon: <Ionicons name="map" size={22} color={colors.primary} />,
      buildUrl: (lat, lon) =>
        `maps://maps.apple.com/?daddr=${lat},${lon}&dirflg=d`,
    },
    {
      id: "google",
      label: "Google Maps",
      icon: <FontAwesome5 name="google" size={20} color="#4285F4" />,
      buildUrl: (lat, lon) =>
        `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`,
    },
    {
      id: "waze",
      label: "Waze",
      icon: <FontAwesome5 name="waze" size={20} color="#33CCFF" />,
      buildUrl: (lat, lon) =>
        `waze://?ll=${lat},${lon}&navigate=yes`,
    },
  ];

  if (!hospital) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: colors.border }]} />

        <View style={styles.hospitalInfo}>
          <Text
            style={[styles.hospitalName, { color: colors.foreground }]}
            numberOfLines={2}
          >
            {hospital.name}
          </Text>
          <Text style={[styles.hospitalAddress, { color: colors.mutedForeground }]}>
            {hospital.address}, {hospital.city}, {hospital.state}
          </Text>
          {hospital.distance != null && (
            <View style={styles.distanceBadge}>
              <MaterialIcons
                name="place"
                size={14}
                color={colors.primary}
              />
              <Text style={[styles.distanceText, { color: colors.primary }]}>
                {formatDistance(hospital.distance)} away
              </Text>
            </View>
          )}
          {hospital.phone && (
            <TouchableOpacity
              onPress={() => Linking.openURL(`tel:${hospital.phone}`)}
              style={styles.phoneRow}
            >
              <MaterialIcons name="phone" size={14} color={colors.mutedForeground} />
              <Text style={[styles.phone, { color: colors.mutedForeground }]}>
                {hospital.phone}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          OPEN IN MAPS
        </Text>

        {mapOptions.map((option) => (
          <TouchableOpacity
            key={option.id}
            style={[
              styles.mapOption,
              { borderColor: colors.border, borderRadius: colors.radius - 2 },
            ]}
            onPress={() => openMap(option)}
            activeOpacity={0.7}
          >
            <View style={styles.mapOptionIcon}>{option.icon}</View>
            <Text style={[styles.mapOptionLabel, { color: colors.foreground }]}>
              {option.label}
            </Text>
            <MaterialIcons
              name="chevron-right"
              size={20}
              color={colors.mutedForeground}
            />
          </TouchableOpacity>
        ))}

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <TouchableOpacity
          style={styles.reportBtn}
          onPress={() => setReportVisible(true)}
          activeOpacity={0.7}
        >
          <FontAwesome5 name="flag" size={12} color={colors.mutedForeground} />
          <Text style={[styles.reportText, { color: colors.mutedForeground }]}>
            Report incorrect information
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.cancelBtn, { borderColor: colors.border, borderRadius: colors.radius }]}
          onPress={onClose}
          activeOpacity={0.7}
        >
          <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>
            Cancel
          </Text>
        </TouchableOpacity>
      </View>

      <ReportModal
        hospital={hospital}
        visible={reportVisible}
        onClose={() => setReportVisible(false)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingBottom: 40,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 16,
  },
  hospitalInfo: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 4,
  },
  hospitalName: {
    fontSize: 18,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
  },
  hospitalAddress: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  distanceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 6,
  },
  distanceText: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  phone: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  divider: {
    height: 1,
    marginBottom: 14,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  mapOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
  },
  mapOptionIcon: {
    width: 36,
    alignItems: "center",
    marginRight: 12,
  },
  mapOptionLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  reportBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginBottom: 4,
  },
  reportText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  cancelBtn: {
    marginHorizontal: 16,
    marginTop: 4,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
  },
  cancelText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
});
