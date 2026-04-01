import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  TextInput,
  ActivityIndicator,
  Platform,
  ScrollView,
} from "react-native";
import { FontAwesome5 } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { Hospital } from "@/types/hospital";

const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

type IssueType =
  | "wrong_name"
  | "wrong_address"
  | "wrong_phone"
  | "permanently_closed"
  | "not_a_hospital"
  | "wrong_specialty"
  | "other";

const ISSUE_OPTIONS: { value: IssueType; label: string }[] = [
  { value: "wrong_name", label: "Wrong name" },
  { value: "wrong_address", label: "Wrong address" },
  { value: "wrong_phone", label: "Wrong phone number" },
  { value: "permanently_closed", label: "Permanently closed" },
  { value: "not_a_hospital", label: "Not a hospital" },
  { value: "wrong_specialty", label: "Wrong specialty / category" },
  { value: "other", label: "Other" },
];

interface ReportModalProps {
  hospital: Hospital | null;
  visible: boolean;
  onClose: () => void;
}

export function ReportModal({ hospital, visible, onClose }: ReportModalProps) {
  const colors = useColors();
  const [selectedIssue, setSelectedIssue] = useState<IssueType | null>(null);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  function reset() {
    setSelectedIssue(null);
    setNotes("");
    setStatus("idle");
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function submit() {
    if (!hospital || !selectedIssue) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setStatus("loading");
    try {
      const res = await fetch(`${API_BASE}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          osmId: hospital.id,
          hospitalName: hospital.name,
          issueType: selectedIssue,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error("Server error");
      setStatus("success");
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setTimeout(() => { handleClose(); }, 1800);
    } catch {
      setStatus("error");
    }
  }

  if (!hospital) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.handle, { backgroundColor: colors.border }]} />

        {status === "success" ? (
          <View style={styles.successContainer}>
            <FontAwesome5 name="check-circle" size={40} color="#27ae60" solid />
            <Text style={[styles.successTitle, { color: colors.foreground }]}>Report Submitted</Text>
            <Text style={[styles.successSub, { color: colors.mutedForeground }]}>
              Thank you. An admin will review and correct this information.
            </Text>
          </View>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
            <View style={styles.headerRow}>
              <FontAwesome5 name="flag" size={14} color={colors.primary} solid />
              <Text style={[styles.title, { color: colors.foreground }]}>Report an Issue</Text>
            </View>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]} numberOfLines={2}>
              {hospital.name}
            </Text>

            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>WHAT IS INCORRECT?</Text>

            {ISSUE_OPTIONS.map((opt) => {
              const selected = selectedIssue === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.option,
                    {
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primary + "15" : "transparent",
                      borderRadius: colors.radius - 2,
                    },
                  ]}
                  onPress={() => setSelectedIssue(opt.value)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.radio, { borderColor: selected ? colors.primary : colors.border }]}>
                    {selected && <View style={[styles.radioDot, { backgroundColor: colors.primary }]} />}
                  </View>
                  <Text style={[styles.optionLabel, { color: colors.foreground }]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}

            <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 16 }]}>
              ADDITIONAL NOTES (OPTIONAL)
            </Text>
            <TextInput
              style={[
                styles.notesInput,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                  borderRadius: colors.radius - 2,
                },
              ]}
              placeholder="E.g. The correct phone number is 555-1234"
              placeholderTextColor={colors.mutedForeground}
              value={notes}
              onChangeText={setNotes}
              multiline
              maxLength={500}
              numberOfLines={3}
              textAlignVertical="top"
            />

            {status === "error" && (
              <Text style={styles.errorText}>Failed to submit. Please try again.</Text>
            )}

            <View style={styles.footerRow}>
              <TouchableOpacity
                style={[styles.cancelBtn, { borderColor: colors.border, borderRadius: colors.radius - 2 }]}
                onPress={handleClose}
              >
                <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.submitBtn,
                  {
                    backgroundColor: selectedIssue ? colors.primary : colors.muted,
                    borderRadius: colors.radius - 2,
                  },
                ]}
                onPress={submit}
                disabled={!selectedIssue || status === "loading"}
                activeOpacity={0.8}
              >
                {status === "loading" ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.submitText}>Submit Report</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    maxHeight: "88%",
    paddingBottom: 40,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    alignSelf: "center", marginTop: 10, marginBottom: 16,
  },
  successContainer: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 40,
    gap: 12,
  },
  successTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  successSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  headerRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 20, marginBottom: 4,
  },
  title: { fontSize: 17, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", paddingHorizontal: 20, marginBottom: 20 },
  sectionLabel: {
    fontSize: 11, fontFamily: "Inter_600SemiBold",
    letterSpacing: 1, paddingHorizontal: 20, marginBottom: 8,
  },
  option: {
    flexDirection: "row", alignItems: "center",
    marginHorizontal: 16, marginBottom: 8,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1.5,
  },
  radio: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 2,
    alignItems: "center", justifyContent: "center", marginRight: 12,
  },
  radioDot: { width: 8, height: 8, borderRadius: 4 },
  optionLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  notesInput: {
    marginHorizontal: 16, padding: 12,
    borderWidth: 1, fontSize: 14,
    fontFamily: "Inter_400Regular", minHeight: 72,
  },
  errorText: { color: "#e74c3c", fontSize: 13, paddingHorizontal: 20, marginTop: 8 },
  footerRow: {
    flexDirection: "row", gap: 10,
    marginHorizontal: 16, marginTop: 20,
  },
  cancelBtn: {
    flex: 1, paddingVertical: 13,
    alignItems: "center", borderWidth: 1,
  },
  cancelText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  submitBtn: { flex: 2, paddingVertical: 13, alignItems: "center" },
  submitText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
