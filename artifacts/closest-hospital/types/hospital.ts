export type HospitalCategory =
  | "All"
  | "Trauma"
  | "Stroke"
  | "Obstetrics"
  | "Burn"
  | "Pediatric"
  | "Psychiatric"
  | "Cardiac"
  | "Cancer";

export interface Hospital {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state: string;
  zip?: string;
  latitude: number;
  longitude: number;
  phone?: string;
  website?: string;
  categories: HospitalCategory[];
  /**
   * Specialties confirmed from the verified CMS/admin data source.
   * Undefined when no verified data exists for this hospital.
   * Used by the specialty filter — only hospitals with verifiedSpecialties
   * that include the selected category are shown in filtered results.
   */
  verifiedSpecialties?: HospitalCategory[];
  /** Raw specialty strings from the database (superset of categories). */
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
  /** Pipe-separated EMS classification tags, e.g. "TRAUMA_1 | HELIPAD | ED" */
  emsTags?: string | null;
  /** True if the hospital has a confirmed helipad */
  helipad?: boolean | null;
  /** Staffed bed count */
  beds?: number | null;
  /** Ownership type, e.g. "GOVERNMENT - STATE", "VOLUNTARY NON-PROFIT" */
  hifldOwner?: string | null;
  /** Official hospital website */
  hifldWebsite?: string | null;
  /** Stroke center designation, e.g. "Comprehensive Stroke Center" */
  strokeDesignation?: string | null;
  /** Burn center designation */
  burnDesignation?: string | null;
  /** PCI/STEMI capability description */
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
];
