import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons, Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import Constants from "expo-constants";

interface InfoRowProps {
  icon: React.ReactNode;
  label: string;
  value?: string;
  onPress?: () => void;
}

function InfoRow({ icon, label, value, onPress }: InfoRowProps) {
  const colors = useColors();
  const content = (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.rowLeft}>
        <View style={[styles.rowIcon, { backgroundColor: colors.muted, borderRadius: 8 }]}>
          {icon}
        </View>
        <Text style={[styles.rowLabel, { color: colors.foreground }]}>
          {label}
        </Text>
      </View>
      <View style={styles.rowRight}>
        {value && (
          <Text style={[styles.rowValue, { color: colors.mutedForeground }]}>
            {value}
          </Text>
        )}
        {onPress && (
          <MaterialIcons name="chevron-right" size={20} color={colors.mutedForeground} />
        )}
      </View>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const appVersion = Constants.expoConfig?.version ?? "1.0.0";

  const headerHeight = Platform.OS === "web" ? 67 : 0;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: headerHeight + 16,
          paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 40),
        },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
        ABOUT
      </Text>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
        <InfoRow
          icon={<MaterialIcons name="info" size={18} color={colors.primary} />}
          label="App Version"
          value={`v${appVersion}`}
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <InfoRow
          icon={<Ionicons name="location" size={18} color={colors.primary} />}
          label="Location Data"
          value="In-session only"
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <InfoRow
          icon={<MaterialIcons name="security" size={18} color={colors.primary} />}
          label="Privacy Policy"
          onPress={() => Linking.openURL("https://example.com/privacy")}
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <InfoRow
          icon={<MaterialIcons name="description" size={18} color={colors.primary} />}
          label="Terms of Use"
          onPress={() => Linking.openURL("https://example.com/terms")}
        />
      </View>

      <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 24 }]}>
        SUPPORT
      </Text>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
        <InfoRow
          icon={<MaterialIcons name="email" size={18} color={colors.primary} />}
          label="Contact Support"
          onPress={() => Linking.openURL("mailto:support@closesthospital.app")}
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <InfoRow
          icon={<MaterialIcons name="star" size={18} color={colors.primary} />}
          label="Rate the App"
          onPress={() => Linking.openURL("https://apps.apple.com")}
        />
      </View>

      <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 24 }]}>
        PERMISSIONS
      </Text>

      <View
        style={[
          styles.permissionBox,
          { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
        ]}
      >
        <View style={styles.permRow}>
          <Ionicons name="location" size={20} color={colors.primary} />
          <View style={styles.permText}>
            <Text style={[styles.permTitle, { color: colors.foreground }]}>
              Location Access
            </Text>
            <Text style={[styles.permDesc, { color: colors.mutedForeground }]}>
              Used to find hospitals near you. Your precise location is only used during your
              session and is never stored or shared.
            </Text>
          </View>
        </View>
      </View>

      <View
        style={[
          styles.disclaimer,
          { backgroundColor: colors.muted, borderRadius: colors.radius },
        ]}
      >
        <View style={styles.disclaimerHeader}>
          <MaterialIcons name="warning" size={16} color={colors.warning} />
          <Text style={[styles.disclaimerTitle, { color: colors.foreground }]}>
            Important Disclaimer
          </Text>
        </View>
        <Text style={[styles.disclaimerText, { color: colors.mutedForeground }]}>
          ER Chooser is a navigational aid only. It does not provide medical
          advice, triage direction, hospital destination authorization, or
          protocol replacement.{"\n\n"}
          Users must follow local EMS protocols, medical control directives,
          agency policy, and regional destination requirements. This app does not
          guarantee a hospital is the most appropriate destination for any
          patient.{"\n\n"}
          In an emergency, always contact your medical control or follow
          established protocols.
        </Text>
      </View>

      <Text style={[styles.copyright, { color: colors.mutedForeground }]}>
        ER Chooser v{appVersion} — Made for EMS professionals
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  rowIcon: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  rowLabel: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  rowValue: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  divider: {
    height: 1,
    marginLeft: 60,
  },
  permissionBox: {
    padding: 16,
    borderWidth: 1,
  },
  permRow: {
    flexDirection: "row",
    gap: 12,
  },
  permText: {
    flex: 1,
    gap: 4,
  },
  permTitle: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  permDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  disclaimer: {
    marginTop: 24,
    padding: 16,
    gap: 8,
  },
  disclaimerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  disclaimerTitle: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  disclaimerText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
  },
  copyright: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 24,
    marginBottom: 8,
  },
});
