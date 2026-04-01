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
  address: string;
  city: string;
  state: string;
  zip: string;
  latitude: number;
  longitude: number;
  phone?: string;
  website?: string;
  categories: HospitalCategory[];
  hospitalType?: string;
  distance?: number;
}

export interface ApiNinjasHospital {
  name: string;
  address: string;
  city: string;
  state: string;
  zip_code?: string;
  latitude: number;
  longitude: number;
  phone?: string;
  website?: string;
  country?: string;
  is_emergency_care?: boolean;
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
