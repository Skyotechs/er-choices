import React, { useState } from "react";
import { Hospital } from "@/types/hospital";

const API_BASE = import.meta.env.VITE_API_BASE
  ? (import.meta.env.VITE_API_BASE as string).replace(/\/$/, "")
  : `${window.location.origin}/api`;

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
      setTimeout(() => { handleClose(); }, 1800);
    } catch {
      setStatus("error");
    }
  }

  if (!visible || !hospital) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-[60]" onClick={handleClose} />
      <div className="fixed bottom-0 left-0 right-0 z-[70] bg-card border-t border-border rounded-t-2xl shadow-2xl max-h-[88vh] overflow-y-auto animate-in slide-in-from-bottom duration-200">
        <div className="w-9 h-1 bg-border rounded-full mx-auto mt-3 mb-4" />

        {status === "success" ? (
          <div className="flex flex-col items-center px-6 py-10 gap-3">
            <div className="text-5xl">✅</div>
            <h3 className="text-lg font-bold text-foreground">Report Submitted</h3>
            <p className="text-sm text-muted-foreground text-center">
              Thank you. An admin will review and correct this information.
            </p>
          </div>
        ) : (
          <div className="px-4 pb-8">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[#c0392b]">🚩</span>
              <h3 className="text-base font-bold text-foreground">Report an Issue</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-5 truncate">{hospital.name}</p>

            <p className="text-xs font-semibold text-muted-foreground tracking-widest mb-3">WHAT IS INCORRECT?</p>

            {ISSUE_OPTIONS.map((opt) => {
              const isSelected = selectedIssue === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setSelectedIssue(opt.value)}
                  className={`
                    flex items-center gap-3 w-full px-3.5 py-3 rounded-xl mb-2 border-[1.5px] text-left transition-colors
                    ${isSelected
                      ? "border-[#c0392b] bg-[#c0392b]/10"
                      : "border-border hover:border-[#c0392b]/40"
                    }
                  `}
                >
                  <div className={`w-4.5 h-4.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${isSelected ? "border-[#c0392b]" : "border-border"}`}>
                    {isSelected && <div className="w-2 h-2 rounded-full bg-[#c0392b]" />}
                  </div>
                  <span className="text-sm font-medium text-foreground">{opt.label}</span>
                </button>
              );
            })}

            <p className="text-xs font-semibold text-muted-foreground tracking-widest mt-4 mb-2">ADDITIONAL NOTES (OPTIONAL)</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="E.g. The correct phone number is 555-1234"
              maxLength={500}
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm resize-none focus:outline-none focus:border-[#c0392b] placeholder:text-muted-foreground"
            />

            {status === "error" && (
              <p className="text-sm text-red-500 mt-2">Failed to submit. Please try again.</p>
            )}

            <div className="flex gap-2.5 mt-5">
              <button
                onClick={handleClose}
                className="flex-1 py-3 border border-border rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!selectedIssue || status === "loading"}
                className={`flex-[2] py-3 rounded-xl text-sm font-semibold text-white transition-colors ${
                  selectedIssue ? "bg-[#c0392b] hover:bg-[#a93226]" : "bg-muted text-muted-foreground cursor-not-allowed"
                }`}
              >
                {status === "loading" ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Submitting...
                  </span>
                ) : (
                  "Submit Report"
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
