import { Hospital, DesignationFilter, DESIGNATION_FILTERS } from "@/types/hospital";
import { specialityCategories, specialityGroups } from "@workspace/speciality";

/** Retained export for older callers; never infer or alter an official level. */
export function normalizeDesignation(segment: string): string { return segment; }

export function matchesDesignationFilter(hospital: Hospital, filter: DesignationFilter): boolean {
  return filter === "All" || specialityCategories(hospital.specialities).includes(filter);
}
export function computeAvailableFilters(_hospitals: Hospital[]): DesignationFilter[] {
  return DESIGNATION_FILTERS;
}
export interface DesignationGroup { label: string; subs: string[] }
export function buildDesignationGroups(hospital: Hospital): DesignationGroup[] {
  return specialityGroups(hospital.specialities);
}
