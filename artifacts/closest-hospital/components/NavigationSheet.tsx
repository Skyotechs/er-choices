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
  buildUrl: (lat: number, lon: number, name: string, address?: string) => string;
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

      const fullAddress = [hospital.address, hospital.city, hospital.state, hospital.zip]
        .filter(Boolean)
        .join(", ");

      const url = option.buildUrl(
        hospital.latitude,
        hospital.longitude,
        hospital.name,
        fullAddress || undefined
      );

      try {
        const canOpen = await Linking.canOpenURL(url);
        if (canOpen) {
          await Linking.openURL(url);
        } else {
          const fallback = fullAddress
            ? `https://maps.apple.com/?daddr=${encodeURIComponent(fullAddress)}&dirflg=d`
            : `https://maps.apple.com/?daddr=${hospital.latitude},${hospital.longitude}&dirflg=d`;
          await Linking.openURL(fallback);
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
      buildUrl: (lat, lon, _name, address) =>
        address
          ? `maps://maps.apple.com/?daddr=${encodeURIComponent(address)}&dirflg=d`
          : `maps://maps.apple.com/?daddr=${lat},${lon}&dirflg=d`,
    },
    {
      id: "google",
      label: "Google Maps",
      icon: <FontAwesome5 name="google" size={20} color="#4285F4" />,
      buildUrl: (lat, lon, _name, address) =>
        address
          ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`
          : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`,
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
            {[hospital.address, hospital.city, hospital.state].filter(Boolean).join(", ")}
          </Text>
          {hospital.distance != null && (
            <View style={styles.distanceBadge}>
              <MaterialIcons name="place" size={14} color={colors.primary} />
              <Text style={[styles.distanceText, { color: colors.primary }]}>
                {formatDistance(hospital.distance)} away
              </Text>
            </View>
          )}

          {hospital.actualDesignation && (
            <View style={styles.designationBlock}>
              {hospital.actualDesignation.split(";").map((seg) => seg.trim()).filter(Boolean).map((seg) => (
                <View
                  key={seg}
                  style={[styles.designationBadge, { backgroundColor: colors.primary + "18" }]}
                >
                  <Text style={[styles.designationBadgeText, { color: colors.primary }]}>
                    {seg}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {(hospital.strokeDesignation || hospital.burnDesignation || hospital.pciCapability) && (
            <View style={styles.secondaryBadgesRow}>
              {hospital.strokeDesignation ? (
                <View style={[styles.secondaryBadge, { backgroundColor: colors.muted }]}>
                  <Text style={[styles.secondaryBadgeText, { color: colors.foreground }]}>
                    🧠 {hospital.strokeDesignation}
                  </Text>
                </View>
              ) : null}
              {hospital.burnDesignation ? (
                <View style={[styles.secondaryBadge, { backgroundColor: colors.muted }]}>
                  <Text style={[styles.secondaryBadgeText, { color: colors.foreground }]}>
                    🔥 {hospital.burnDesignation}
                  </Text>
                </View>
              ) : null}
              {hospital.pciCapability ? (
                <View style={[styles.secondaryBadge, { backgroundColor: colors.muted }]}>
                  <Text style={[styles.secondaryBadgeText, { color: colors.foreground }]}>
                    ❤️ {hospital.pciCapability}
                  </Text>
                </View>
              ) : null}
            </View>
          )}

          {hospital.helipad && (
            <View style={styles.helipadRow}>
              <Text style={styles.helipadText}>✈️ Helipad available</Text>
            </View>
          )}

          {hospital.phone && (
            <TouchableOpacity
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                Linking.openURL(`tel:${hospital.phone}`);
              }}
              style={[styles.callBtn, { borderColor: colors.primary, borderRadius: colors.radius - 2 }]}
              activeOpacity={0.75}
            >
              <MaterialIcons name="phone" size={20} color={colors.primary} />
              <Text style={[styles.callBtnText, { color: colors.primary }]}>
                Call {hospital.phone}
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
  designationBlock: {
    gap: 5,
    marginTop: 8,
  },
  designationBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  designationBadgeText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.1,
  },
  secondaryBadgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  secondaryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
  },
  secondaryBadgeText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  helipadRow: {
    marginTop: 6,
  },
  helipadText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "#4A90D9",
  },
  callBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1.5,
    paddingVertical: 13,
    marginTop: 12,
  },
  callBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: -0.1,
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
