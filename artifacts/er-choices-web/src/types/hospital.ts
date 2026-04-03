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
