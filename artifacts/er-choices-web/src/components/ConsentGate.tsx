import React, { useEffect, useState } from "react";

const CONSENT_KEY = "er_choices_consent_v1";
const LEGAL_URL = "https://erchoices.com/legal";

export function ConsentGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "required" | "agreed">("loading");

  useEffect(() => {
    const val = localStorage.getItem(CONSENT_KEY);
    if (val === "agreed") {
      setStatus("agreed");
    } else {
      setStatus("required");
    }
  }, []);

  const handleAgree = () => {
    localStorage.setItem(CONSENT_KEY, "agreed");
    setStatus("agreed");
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-[#0d1b2e] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#c0392b] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === "agreed") {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-[#0d1b2e] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 rounded-2xl bg-[#c0392b18] border border-[#c0392b40] flex items-center justify-center mb-4">
            <svg className="w-10 h-10 text-[#c0392b]" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 8h-1V3H6v5H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zM8 5h8v3H8V5zm8 12v2H8v-4h8v2zm2-2v-2H6v2H4v-4c0-.55.45-1 1-1h14c.55 0 1 .45 1 1v4h-2z"/>
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">ER Choices</h1>
          <p className="text-sm text-[#8899aa] mt-1 tracking-wide">For EMS Professionals</p>
        </div>

        <div className="bg-[#152236] border border-[#1e3352] rounded-2xl p-5 mb-7">
          <h2 className="text-base font-bold text-white mb-3">Before You Continue</h2>
          <p className="text-sm text-[#99aabb] leading-relaxed">
            ER Choices uses your device's precise location only while the app is in use to show nearby hospitals and open navigation. ER Choices does not store your location.
          </p>
          <p className="text-sm text-[#99aabb] leading-relaxed mt-3">
            ER Choices is an informational aid only and does not provide medical advice, destination authorization, or emergency dispatch functionality. It does not supersede local EMS protocols, medical control, OEM/regional routing directives, hospital diversion instructions, physician orders, dispatch instructions, employer SOPs/SOGs, payer or transport authorization rules, or applicable law. Use only as a convenience tool and verify all destination decisions independently.
          </p>
          <p className="text-sm text-[#99aabb] leading-relaxed mt-3">
            By tapping <strong className="text-[#ccddee]">I Agree</strong> you confirm you have read and agree to our{" "}
            <a href={LEGAL_URL} target="_blank" rel="noopener noreferrer" className="text-[#c0392b] underline hover:text-[#e04040]">
              Terms of Service, EULA &amp; Privacy Policy
            </a>
            .
          </p>
        </div>

        <button
          onClick={handleAgree}
          className="w-full bg-[#c0392b] hover:bg-[#a93226] text-white font-bold py-4 rounded-2xl text-base transition-colors mb-3 shadow-lg"
        >
          I Agree
        </button>

        <a
          href={LEGAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-xs text-[#556677] underline hover:text-[#8899aa] mt-4 transition-colors"
        >
          View Terms of Service, EULA &amp; Privacy Policy
        </a>
      </div>
    </div>
  );
}
