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
import { MaterialIcons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

const LEGAL_URL = "https://erchoices.com/legal";

interface LinkRowProps {
  emoji: string;
  label: string;
  onPress: () => void;
  showDivider?: boolean;
}

function LinkRow({ emoji, label, onPress, showDivider = true }: LinkRowProps) {
  const colors = useColors();
  return (
    <>
      <TouchableOpacity
        style={styles.linkRow}
        onPress={onPress}
        activeOpacity={0.7}
      >
        <View style={[styles.linkIcon, { backgroundColor: colors.muted, borderRadius: 8 }]}>
          <Text style={styles.linkEmoji}>{emoji}</Text>
        </View>
        <Text style={[styles.linkLabel, { color: colors.foreground }]}>{label}</Text>
        <MaterialIcons name="chevron-right" size={20} color={colors.mutedForeground} />
      </TouchableOpacity>
      {showDivider && (
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
      )}
    </>
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
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
      {/* Important Disclaimer — top, matches web */}
      <View style={[styles.disclaimer, { backgroundColor: colors.muted, borderRadius: colors.radius }]}>
        <View style={styles.disclaimerHeader}>
          <Text style={styles.disclaimerEmoji}>⚠️</Text>
          <Text style={[styles.disclaimerTitle, { color: colors.foreground }]}>
            Important Disclaimer
          </Text>
        </View>
        <Text style={[styles.disclaimerText, { color: colors.mutedForeground }]}>
          ER Choices is a navigational aid only. It does not provide medical advice, triage direction, hospital destination authorization, or protocol replacement.
        </Text>
        <Text style={[styles.disclaimerText, { color: colors.mutedForeground, marginTop: 8 }]}>
          Users must follow local EMS protocols, medical control directives, agency policy, and regional destination requirements. This app does not guarantee a hospital is the most appropriate destination for any patient.
        </Text>
        <Text style={[styles.disclaimerText, { color: colors.mutedForeground, marginTop: 8 }]}>
          In an emergency, always contact your medical control or follow established protocols.
        </Text>
      </View>

      {/* Single card: Privacy Policy + Terms of Use + Contact Support */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
          },
        ]}
      >
        <LinkRow
          emoji="🔒"
          label="Privacy Policy"
          onPress={() => Linking.openURL(LEGAL_URL)}
        />
        <LinkRow
          emoji="📄"
          label="Terms of Use"
          onPress={() => Linking.openURL(LEGAL_URL)}
        />
        <LinkRow
          emoji="✉️"
          label="Contact Support"
          onPress={() => Linking.openURL("mailto:support@erchoices.com")}
          showDivider={false}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    gap: 16,
  },
  disclaimer: {
    padding: 16,
  },
  disclaimerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  disclaimerEmoji: {
    fontSize: 16,
  },
  disclaimerTitle: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  disclaimerText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
  },
  card: {
    borderWidth: 1,
    overflow: "hidden",
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  linkIcon: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  linkEmoji: {
    fontSize: 16,
  },
  linkLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  divider: {
    height: 1,
    marginLeft: 60,
  },
});
