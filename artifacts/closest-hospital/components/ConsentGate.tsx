import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
  BackHandler,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useHospital } from "@/context/HospitalContext";

const CONSENT_KEY = "er_choices_consent_v1";
const LEGAL_URL = "https://www.skyotechs.com/erlegal";

export function ConsentGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "required" | "agreed">("loading");
  const insets = useSafeAreaInsets();
  const { requestLocationPermission, isLoading, location } = useHospital();

  useEffect(() => {
    AsyncStorage.getItem(CONSENT_KEY).then((val) => {
      if (val === "agreed") {
        setStatus("agreed");
        if (!isLoading && !location) {
          requestLocationPermission();
        }
      } else {
        setStatus("required");
      }
    });
  }, []);

  const handleAgree = async () => {
    await AsyncStorage.setItem(CONSENT_KEY, "agreed");
    setStatus("agreed");
    requestLocationPermission();
  };

  const handleDecline = () => {
    if (Platform.OS === "android") {
      BackHandler.exitApp();
    } else {
      BackHandler.exitApp();
    }
  };

  if (status === "loading") {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#c0392b" />
      </View>
    );
  }

  return (
    <>
      {children}
      <Modal
        visible={status === "required"}
        animationType="fade"
        transparent={false}
        statusBarTranslucent
      >
        <View
          style={[
            styles.screen,
            { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 },
          ]}
        >
          <View style={styles.iconRow}>
            <View style={styles.iconBadge}>
              <MaterialIcons name="local-hospital" size={40} color="#c0392b" />
            </View>
          </View>

          <Text style={styles.appName}>ER Choices</Text>
          <Text style={styles.tagline}>For EMS Professionals</Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Before You Continue</Text>
            <Text style={styles.cardBody}>
              By using ER Choices you agree to our{" "}
              <Text
                style={styles.link}
                onPress={() => Linking.openURL(LEGAL_URL)}
              >
                Terms of Service, End User License Agreement (EULA), and Privacy
                Policy
              </Text>
              .{"\n\n"}
              ER Choices is a navigational aid only. It does not replace medical
              control, local EMS protocols, or agency policy.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.agreeBtn}
            onPress={handleAgree}
            activeOpacity={0.85}
          >
            <Text style={styles.agreeBtnText}>I Agree</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.declineBtn}
            onPress={handleDecline}
            activeOpacity={0.7}
          >
            <Text style={styles.declineBtnText}>Decline</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => Linking.openURL(LEGAL_URL)}
            activeOpacity={0.7}
            style={{ marginTop: 20 }}
          >
            <Text style={styles.legalLink}>
              View Terms of Service, EULA &amp; Privacy Policy
            </Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: "#0d1b2e",
    justifyContent: "center",
    alignItems: "center",
  },
  screen: {
    flex: 1,
    backgroundColor: "#0d1b2e",
    alignItems: "center",
    paddingHorizontal: 28,
  },
  iconRow: {
    marginBottom: 20,
  },
  iconBadge: {
    width: 84,
    height: 84,
    borderRadius: 22,
    backgroundColor: "#c0392b18",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#c0392b40",
  },
  appName: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  tagline: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#8899aa",
    marginBottom: 36,
    letterSpacing: 0.5,
  },
  card: {
    width: "100%",
    backgroundColor: "#152236",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "#1e3352",
    marginBottom: 28,
  },
  cardTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
    marginBottom: 12,
  },
  cardBody: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#99aabb",
    lineHeight: 22,
  },
  link: {
    color: "#c0392b",
    fontFamily: "Inter_500Medium",
    textDecorationLine: "underline",
  },
  agreeBtn: {
    width: "100%",
    backgroundColor: "#c0392b",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 12,
    shadowColor: "#c0392b",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  agreeBtnText: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
    letterSpacing: 0.3,
  },
  declineBtn: {
    width: "100%",
    backgroundColor: "#1e3352",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2a4a6e",
  },
  declineBtnText: {
    fontSize: 16,
    fontFamily: "Inter_500Medium",
    color: "#8899aa",
  },
  legalLink: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#556677",
    textAlign: "center",
    textDecorationLine: "underline",
  },
});
