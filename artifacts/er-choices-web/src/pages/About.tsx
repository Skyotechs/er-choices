import React from "react";

const LEGAL_URL = "https://erchoices.com/legal";

export function About() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">

        <div className="bg-muted rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-base">⚠️</span>
            <p className="text-sm font-bold text-foreground">Important Disclaimer</p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            ER Choices is a navigational aid only. It does not provide medical advice, triage direction, hospital destination authorization, or protocol replacement.
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed mt-2">
            Users must follow local EMS protocols, medical control directives, agency policy, and regional destination requirements. This app does not guarantee a hospital is the most appropriate destination for any patient.
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed mt-2">
            In an emergency, always contact your medical control or follow established protocols.
          </p>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <a
            href={LEGAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between px-4 py-3.5 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                <span className="text-sm">🔒</span>
              </div>
              <span className="text-sm font-medium text-foreground">Privacy Policy</span>
            </div>
            <span className="text-muted-foreground">›</span>
          </a>
          <div className="h-px bg-border ml-16" />
          <a
            href={LEGAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between px-4 py-3.5 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                <span className="text-sm">📄</span>
              </div>
              <span className="text-sm font-medium text-foreground">Terms of Use</span>
            </div>
            <span className="text-muted-foreground">›</span>
          </a>
          <div className="h-px bg-border ml-16" />
          <a
            href="mailto:support@erchoices.com"
            className="flex items-center justify-between px-4 py-3.5 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                <span className="text-sm">✉️</span>
              </div>
              <span className="text-sm font-medium text-foreground">Contact Support</span>
            </div>
            <span className="text-muted-foreground">›</span>
          </a>
        </div>

        <p className="text-xs text-muted-foreground text-center pb-4">
          ER Choices — Made for EMS professionals
        </p>
      </div>
    </div>
  );
}
