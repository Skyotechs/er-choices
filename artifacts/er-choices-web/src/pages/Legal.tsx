import React from "react";

const SECTIONS = [
  {
    num: "1",
    title: "Introduction",
    body: [
      "This Master Legal Agreement (\"Agreement\") governs access to and use of the ER Choices mobile application, website, and related services (collectively, the \"Platform\").",
      "The Platform is operated by ER Choices LLC (\"Company,\" \"we,\" \"us,\" or \"our\").",
      "By accessing or using the Platform, you agree to be bound by this Agreement. If you do not agree, you must not use the Platform.",
    ],
  },
  {
    num: "2",
    title: "Platform Purpose",
    body: [
      "ER Choices is a location-based informational tool that displays nearby hospitals based on proximity, along with hospital names, addresses, and phone numbers.",
      "The Platform is intended solely to provide general location and reference information.",
    ],
  },
  {
    num: "3",
    title: "Medical / EMS / Routing Disclaimer",
    body: [
      "ER Choices is not a medical device, a clinical decision support system, a triage tool, a diagnostic tool, or a treatment recommendation system.",
      "ER Choices does not supersede local EMS protocols, medical control direction, OEM or regional routing directives, hospital diversion instructions, physician orders, dispatch instructions, employer SOPs/SOGs, payer or transport authorization rules.",
      "Users acknowledge and agree that ER Choices must not be relied upon for patient care decisions and must not be used as the sole basis for determining destination. All routing decisions must be made through proper medical, operational, and regulatory channels.",
      "The Platform is not an emergency system and must not be relied upon for time-critical decisions, emergency dispatch, or urgent routing decisions.",
    ],
  },
  {
    num: "4",
    title: "End User License Agreement (EULA)",
    body: [
      "ER Choices LLC grants you a limited, non-exclusive, non-transferable, revocable license to use the Platform for personal, non-commercial use.",
      "You may not copy, modify, distribute, reverse engineer, decompile, scrape, automate, or unlawfully exploit the Platform or interfere with its functionality.",
      "All intellectual property related to the Platform remains the exclusive property of ER Choices LLC.",
    ],
  },
  {
    num: "5",
    title: "Terms of Service",
    body: [
      "All information provided through the Platform is for reference purposes only. We do not guarantee accuracy, completeness, timeliness, availability, or correctness of hospital capabilities or hospital status.",
      "ER Choices does not guarantee that any hospital is accepting patients, has capacity, has any specific specialty currently available, or is appropriate for any condition.",
      "You are solely responsible for independently verifying information and following proper EMS, dispatch, medical, employer, and regulatory requirements.",
      "You assume all risk associated with use of the Platform, including reliance on displayed information and decisions made based on Platform data.",
      "We do not guarantee uninterrupted or error-free service and may modify, suspend, or discontinue the Platform at any time without notice.",
    ],
  },
  {
    num: "6",
    title: "Privacy Policy",
    body: [
      "ER Choices does not collect, store, or retain personal user data, except temporary device location data used solely to identify and display nearby hospitals.",
      "Location is used in real time, is not stored, saved, or retained, and is not linked to user identity by ER Choices.",
      "The Platform does not require accounts, does not store user profiles, and does not track saved favorites or search history.",
      "The Platform may rely on third-party services such as mapping or routing providers, including Apple Maps, Google Maps, or Waze. Those providers may collect information under their own terms and privacy practices.",
      "While we implement reasonable safeguards, no system is completely secure, and we do not guarantee absolute security.",
      "The Platform is available to all ages. We do not knowingly collect personal information from children, and no personal data is stored or retained by ER Choices other than temporary location use as described above.",
    ],
  },
  {
    num: "7",
    title: "No Warranty",
    body: [
      "THE PLATFORM IS PROVIDED \"AS IS\" AND \"AS AVAILABLE\" WITHOUT WARRANTIES OF ANY KIND, INCLUDING WARRANTIES OF ACCURACY, RELIABILITY, AVAILABILITY, MERCHANTABILITY, OR FITNESS FOR A PARTICULAR PURPOSE.",
    ],
    caps: true,
  },
  {
    num: "8",
    title: "Limitation of Liability",
    body: [
      "TO THE MAXIMUM EXTENT PERMITTED BY LAW, ER CHOICES LLC SHALL NOT BE LIABLE FOR MEDICAL OUTCOMES, PATIENT CARE DECISIONS, ROUTING DECISIONS, DELAYS IN CARE, MISINTERPRETATION OF DATA, SYSTEM ERRORS, SERVICE INTERRUPTIONS, OR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR EXEMPLARY DAMAGES.",
      "Total cumulative liability shall not exceed the greater of $100 USD or the amount paid by the user, if any, during the twelve (12) months preceding the claim.",
    ],
  },
  {
    num: "9",
    title: "Arbitration / Class Action Waiver",
    body: [
      "You must first attempt to resolve disputes by contacting Support@ERChoices.com and allowing thirty (30) days for informal resolution.",
      "Except where prohibited by law, all disputes shall be resolved through binding individual arbitration in New Jersey under the rules of the American Arbitration Association (AAA).",
      "You waive any right to participate in a class action, collective action, representative action, or jury trial. Eligible claims may be brought in small claims court if brought on an individual basis.",
    ],
  },
  {
    num: "10",
    title: "Governing Law",
    body: [
      "This Agreement is governed by the laws of the State of New Jersey, without regard to conflict of law principles.",
    ],
  },
  {
    num: "11",
    title: "Entire Agreement",
    body: [
      "This Agreement represents the entire agreement between you and ER Choices LLC regarding the Platform and supersedes prior or contemporaneous oral or written understandings on the same subject.",
    ],
  },
  {
    num: "12",
    title: "Severability",
    body: [
      "If any provision of this Agreement is found invalid or unenforceable, the remaining provisions shall remain in full force and effect.",
    ],
  },
];

export function Legal() {
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0d1b2e", color: "#e2e8f0" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 20px 64px" }}>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            backgroundColor: "#c0392b",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <span style={{ color: "#fff", fontWeight: 800, fontSize: 13 }}>ER</span>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#f1f5f9", lineHeight: 1.2 }}>ER Choices Legal</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>Master Legal Agreement</div>
          </div>
        </div>

        <div style={{
          backgroundColor: "#7f1d1d22",
          border: "1px solid #c0392b55",
          borderRadius: 12,
          padding: "14px 18px",
          marginBottom: 28,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#c0392b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            Important Notice
          </div>
          <p style={{ fontSize: 13, color: "#fca5a5", lineHeight: 1.6, margin: 0 }}>
            ER Choices is an informational hospital proximity tool only. It does not supersede EMS protocols, medical control, dispatch, hospital diversion instructions, physician orders, employer SOPs/SOGs, payer rules, or transport authorization rules.
          </p>
        </div>

        <div style={{
          backgroundColor: "#152236",
          border: "1px solid #1e3352",
          borderRadius: 12,
          padding: "14px 18px",
          marginBottom: 36,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "8px 24px",
        }}>
          {[
            ["Operator", "ER Choices LLC"],
            ["Location", "Hoboken, New Jersey"],
            ["Contact", "Support@ERChoices.com"],
            ["Effective Date", "02/03/2022"],
          ].map(([label, value]) => (
            <div key={label}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</div>
              <div style={{ fontSize: 13, color: "#cbd5e1", marginTop: 2 }}>
                {label === "Contact"
                  ? <a href={`mailto:${value}`} style={{ color: "#c0392b", textDecoration: "none" }}>{value}</a>
                  : value
                }
              </div>
            </div>
          ))}
        </div>

        {SECTIONS.map((sec) => (
          <div key={sec.num} style={{
            backgroundColor: "#152236",
            border: "1px solid #1e3352",
            borderRadius: 12,
            padding: "18px 20px",
            marginBottom: 12,
          }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
              <span style={{
                fontSize: 11, fontWeight: 700, color: "#c0392b",
                backgroundColor: "#c0392b18",
                border: "1px solid #c0392b33",
                borderRadius: 6, padding: "2px 8px",
                flexShrink: 0,
              }}>{sec.num}</span>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>{sec.title}</h2>
            </div>
            {sec.body.map((para, i) => (
              <p key={i} style={{
                fontSize: 13,
                color: (sec.num === "7" || (sec.num === "8" && i === 0)) ? "#94a3b8" : "#94a3b8",
                lineHeight: 1.65,
                margin: 0,
                marginTop: i > 0 ? 10 : 0,
                fontVariant: (sec.num === "7" || (sec.num === "8" && i === 0)) ? undefined : undefined,
              }}>
                {para}
              </p>
            ))}
          </div>
        ))}

        <div style={{
          backgroundColor: "#152236",
          border: "1px solid #1e3352",
          borderRadius: 12,
          padding: "18px 20px",
          marginBottom: 12,
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
            <span style={{
              fontSize: 11, fontWeight: 700, color: "#c0392b",
              backgroundColor: "#c0392b18",
              border: "1px solid #c0392b33",
              borderRadius: 6, padding: "2px 8px",
              flexShrink: 0,
            }}>13</span>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>Contact</h2>
          </div>
          <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.65, margin: 0 }}>ER Choices LLC</p>
          <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.65, margin: "4px 0 0" }}>Hoboken, New Jersey</p>
          <a
            href="mailto:Support@ERChoices.com"
            style={{ fontSize: 13, color: "#c0392b", textDecoration: "none", display: "block", marginTop: 4 }}
          >
            Support@ERChoices.com
          </a>
        </div>

        <p style={{ fontSize: 11, color: "#334155", textAlign: "center", marginTop: 32 }}>
          © {new Date().getFullYear()} ER Choices LLC. All rights reserved.
        </p>
      </div>
    </div>
  );
}
