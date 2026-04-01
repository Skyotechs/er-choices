import React, { useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
} from "react-native";
import { FontAwesome5, MaterialIcons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useHospital } from "@/context/HospitalContext";

interface StateConfig {
  label: string;
  description: string;
  url: string;
  icon: string;
}

const STATE_CONFIGS: Record<string, StateConfig> = {
  PA: {
    label: "PA Live Diversion",
    description: "pamedic.org",
    url: "https://www.pamedic.org",
    icon: "broadcast-tower",
  },
  NJ: {
    label: "NJ ED Diversion",
    description: "njdivert.juvare.com",
    url: "https://njdivert.juvare.com/",
    icon: "broadcast-tower",
  },
  MD: {
    label: "MD ED Advisory",
    description: "edas.miemss.org",
    url: "https://edas.miemss.org/dashboard",
    icon: "broadcast-tower",
  },
  CT: {
    label: "CT Boarding Status",
    description: "overnight-boarding.ctacep.org",
    url: "https://overnight-boarding.ctacep.org/hospitals/?peerGroup=large",
    icon: "broadcast-tower",
  },
};

function detectState(states: string[]): string | null {
  if (!states.length) return null;
  const counts: Record<string, number> = {};
  for (const s of states) {
    const upper = s.toUpperCase().trim();
    if (upper) counts[upper] = (counts[upper] ?? 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  const state = top[0];
  return STATE_CONFIGS[state] ? state : null;
}

export function LiveStatusBanner() {
  const colors = useColors();
  const { allHospitals } = useHospital();

  const detectedState = useMemo(
    () => detectState(allHospitals.map((h) => h.state)),
    [allHospitals]
  );

  if (!detectedState) return null;

  const config = STATE_CONFIGS[detectedState];

  return (
    <TouchableOpacity
      style={[
        styles.banner,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          marginHorizontal: 16,
          borderRadius: colors.radius,
        },
      ]}
      onPress={() => Linking.openURL(config.url)}
      activeOpacity={0.75}
    >
      <View style={[styles.accent, { backgroundColor: colors.primary }]} />
      <View style={styles.iconWrap}>
        <FontAwesome5
          name={config.icon as any}
          size={14}
          color={colors.primary}
        />
      </View>
      <View style={styles.body}>
        <Text style={[styles.label, { color: colors.foreground }]}>
          {config.label}
        </Text>
        <Text style={[styles.desc, { color: colors.mutedForeground }]}>
          {config.description}
        </Text>
      </View>
      <View style={styles.action}>
        <Text style={[styles.actionText, { color: colors.primary }]}>
          View
        </Text>
        <MaterialIcons
          name="open-in-new"
          size={13}
          color={colors.primary}
        />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    borderWidth: 1,
    marginTop: 10,
    marginBottom: 2,
    minHeight: 48,
  },
  accent: {
    width: 4,
    alignSelf: "stretch",
  },
  iconWrap: {
    paddingHorizontal: 12,
  },
  body: {
    flex: 1,
    paddingVertical: 10,
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 17,
  },
  desc: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 14,
  },
  actionText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
});
