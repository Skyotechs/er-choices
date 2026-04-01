import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  ActivityIndicator,
} from "react-native";
import { FontAwesome5, MaterialIcons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useHospital } from "@/context/HospitalContext";

interface StateConfig {
  label: string;
  description: string;
  url: string;
}

const STATE_CONFIGS: Record<string, StateConfig> = {
  PA: {
    label: "Pennsylvania Live Status",
    description: "pamedic.org",
    url: "https://www.pamedic.org",
  },
  NJ: {
    label: "New Jersey Live Status",
    description: "njdivert.juvare.com",
    url: "https://njdivert.juvare.com/",
  },
  MD: {
    label: "Maryland Live Status",
    description: "edas.miemss.org",
    url: "https://edas.miemss.org/dashboard",
  },
  CT: {
    label: "Connecticut Live Status",
    description: "overnight-boarding.ctacep.org",
    url: "https://overnight-boarding.ctacep.org/hospitals/?peerGroup=large",
  },
};

const STATE_NAME_TO_ABBR: Record<string, string> = {
  "new jersey": "NJ",
  "pennsylvania": "PA",
  "maryland": "MD",
  "connecticut": "CT",
};

async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
      { headers: { "User-Agent": "ERChooser/1.0" } }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const stateName: string = (data?.address?.state ?? "").toLowerCase().trim();
    return STATE_NAME_TO_ABBR[stateName] ?? null;
  } catch {
    return null;
  }
}

export function LiveStatusBanner() {
  const colors = useColors();
  const { location } = useHospital();
  const [stateCode, setStateCode] = useState<string | null | "loading">("loading");

  useEffect(() => {
    if (!location) return;
    let cancelled = false;
    setStateCode("loading");
    reverseGeocode(location.latitude, location.longitude).then((code) => {
      if (!cancelled) setStateCode(code);
    });
    return () => { cancelled = true; };
  }, [location?.latitude, location?.longitude]);

  if (!location || stateCode === "loading" || stateCode === null) return null;

  const config = STATE_CONFIGS[stateCode];
  if (!config) return null;

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
        <FontAwesome5 name="broadcast-tower" size={14} color={colors.primary} />
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
        <Text style={[styles.actionText, { color: colors.primary }]}>View</Text>
        <MaterialIcons name="open-in-new" size={13} color={colors.primary} />
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
