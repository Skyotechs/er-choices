import { useEffect, useState } from "react";
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
      { headers: { "User-Agent": "ERChoices/1.0" } }
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
    <a
      href={config.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 mx-3 my-1.5 px-3 py-2.5 bg-card border border-border rounded-xl hover:bg-muted/50 transition-colors group"
    >
      <div className="w-1 self-stretch bg-[#c0392b] rounded-full flex-shrink-0" />
      <span className="text-sm">📡</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground leading-tight">{config.label}</p>
        <p className="text-[11px] text-muted-foreground leading-tight">{config.description}</p>
      </div>
      <span className="text-xs font-semibold text-[#c0392b] group-hover:underline flex-shrink-0">
        View →
      </span>
    </a>
  );
}
