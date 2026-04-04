export type HospitalCategory =
  | "All"
  | "Trauma"
  | "Stroke"
  | "Obstetrics"
  | "Burn"
  | "Pediatric"
  | "Psychiatric"
  | "Cardiac"
  | "Cancer"
  | "HazMat";

export interface Hospital {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  latitude: number;
  longitude: number;
  phone?: string;
  website?: string;
  categories: HospitalCategory[];
  verifiedSpecialties?: HospitalCategory[];
  specialties?: string[];
  hospitalType?: string;
  distance?: number;
  // ── Enriched fields from HIFLD / research pass ─────────────────────────────
  /** e.g. "Level II Trauma Center; Acute Care Hospital" */
  actualDesignation?: string | null;
  /** e.g. "General Acute Care", "Critical Access", "Psychiatric" */
  serviceLine?: string | null;
  /** e.g. "Trauma capability; Helipad" */
  advancedCapabilities?: string | null;
  /** Pipe-separated EMS classification tags */
  emsTags?: string | null;
  /** True if the hospital has a confirmed helipad */
  helipad?: boolean | null;
  /** Staffed bed count */
  beds?: number | null;
  /** Ownership type */
  hifldOwner?: string | null;
  /** Official hospital website */
  hifldWebsite?: string | null;
  /** Stroke center designation */
  strokeDesignation?: string | null;
  /** Burn center designation */
  burnDesignation?: string | null;
  /** PCI/STEMI capability */
  pciCapability?: string | null;
  /** HIFLD data match confidence: HIGH | MEDIUM | LOW | UNMATCHED */
  hifldMatchConfidence?: string | null;
}

export const CATEGORIES: HospitalCategory[] = [
  "All",
  "Trauma",
  "Stroke",
  "Cardiac",
  "Pediatric",
  "Obstetrics",
  "Burn",
  "Psychiatric",
  "Cancer",
  "HazMat",
];
