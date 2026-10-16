/** Pure shared rules: no platform APIs, database access, or inferred verification. */
export const SPECIALITY_KEY = "_specialityV1";
export const SPECIALITY_CATEGORIES = [
  "Trauma", "Stroke", "Burn", "Pediatric", "Obstetrics", "Psychiatric",
  "Cardiac", "Cancer", "HazMat",
  "General Acute Care", "Critical Access", "Women", "Rehabilitation",
  "Long-Term Acute Care", "Orthopedic", "Neurology", "Neonatal", "Transplant",
] as const;
export type SpecialityCategory = typeof SPECIALITY_CATEGORIES[number];
export interface SpecialityEntry {
  category: SpecialityCategory | null;
  classification: string;
  population: "Adult" | "Pediatric" | "All";
  status: "unverified" | "verified";
  authority: string;
  sourceUrl: string;
  verifiedOn: string;
  officialConfirmed: boolean;
}
export interface SpecialityState {
  revision: string;
  entries: SpecialityEntry[];
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const normal = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

/** Admin confirmation, not importer tags or hospital-wide flags, is authoritative. */
export function validateSpecialityEntries(input: unknown, today = new Date().toISOString().slice(0, 10)): SpecialityEntry[] {
  if (!Array.isArray(input) || input.length > 30) throw new Error("Speciality must be a list of at most 30 entries.");
  const entries: SpecialityEntry[] = input.map((raw, index) => {
    const row = object(raw);
    const text = (key: string, max: number) => {
      if (typeof row[key] !== "string" || row[key].length > max) throw new Error(`Entry ${index + 1}: invalid ${key}.`);
      return row[key].trim();
    };
    if (row.category !== null && !(SPECIALITY_CATEGORIES as readonly unknown[]).includes(row.category)) throw new Error(`Entry ${index + 1}: invalid Speciality category.`);
    if (!["All", "Adult", "Pediatric"].includes(String(row.population))) throw new Error(`Entry ${index + 1}: choose the population.`);
    if (!["unverified", "verified"].includes(String(row.status))) throw new Error(`Entry ${index + 1}: invalid review status.`);
    if (typeof row.officialConfirmed !== "boolean") throw new Error(`Entry ${index + 1}: official confirmation must be explicit.`);
    const entry: SpecialityEntry = {
      category: row.category as SpecialityCategory | null,
      population: row.population as SpecialityEntry["population"],
      status: row.status as SpecialityEntry["status"],
      classification: text("classification", 200), authority: text("authority", 200),
      sourceUrl: text("sourceUrl", 2000), verifiedOn: text("verifiedOn", 10),
      officialConfirmed: row.officialConfirmed,
    };
    if (!entry.classification) throw new Error(`Entry ${index + 1}: enter a category/speciality or classification/level.`);
    if (entry.sourceUrl) {
      let url: URL;
      try { url = new URL(entry.sourceUrl); } catch { throw new Error(`Entry ${index + 1}: invalid evidence URL.`); }
      if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) throw new Error(`Entry ${index + 1}: use a public HTTPS evidence URL without credentials.`);
    }
    if (entry.verifiedOn && (!/^\d{4}-\d{2}-\d{2}$/.test(entry.verifiedOn) ||
        !Number.isFinite(Date.parse(entry.verifiedOn)) ||
        new Date(entry.verifiedOn).toISOString().slice(0, 10) !== entry.verifiedOn ||
        entry.verifiedOn > today)) throw new Error(`Entry ${index + 1}: use a valid verification date that is not in the future.`);
    if (entry.status === "verified" && !entry.officialConfirmed) {
      throw new Error(`Entry ${index + 1}: Speciality must be confirmed through the admin editor.`);
    }
    return entry;
  });
  for (let i = 0; i < entries.length; i++) for (let j = 0; j < i; j++) {
    const a = entries[i], b = entries[j];
    if (a.category !== b.category) continue;
    if (a.category === null && normal(a.classification) !== normal(b.classification)) continue;
    if (a.population !== b.population && a.population !== "All" && b.population !== "All") continue;
    if (normal(a.classification) === normal(b.classification)) throw new Error("Duplicate Speciality entry for the same category and population.");
    throw new Error("Conflicting Speciality entries: use one current classification per category and population. Keep unresolved evidence in review, not as competing entries.");
  }
  return entries;
}

/**
 * Call only at an authenticated admin write boundary. Saving is the admin's
 * confirmation; evidence fields are optional. Never apply this to imported data.
 */
export function recordAdminSpecialities(input: unknown, previous: SpecialityEntry[] = [], today = new Date().toISOString().slice(0, 10)): SpecialityEntry[] {
  if (!Array.isArray(input)) throw new Error("Speciality must be a list.");
  return validateSpecialityEntries(input.map(value => {
    const row = object(value);
    const category = row.category === "" || row.category == null ? null : row.category;
    const classification = typeof row.classification === "string"
      ? row.classification.trim() || category : row.classification === undefined ? category : row.classification;
    const population = row.population ?? "All";
    const existing = previous.find(entry => entry.category === category &&
      entry.population === population && typeof classification === "string" &&
      normal(entry.classification) === normal(classification));
    return {
      ...row, category, classification, population,
      authority: row.authority ?? existing?.authority ?? "",
      sourceUrl: row.sourceUrl ?? existing?.sourceUrl ?? "",
      verifiedOn: row.verifiedOn || existing?.verifiedOn || today,
      status: "verified", officialConfirmed: true,
    };
  }), today);
}

/** Missing legacy data is explicitly unreviewed; never consult hospital-wide verified. */
export function readSpecialityState(sources: unknown): SpecialityState {
  const raw = object(object(sources)[SPECIALITY_KEY]);
  if (!Object.keys(raw).length) return { revision: "", entries: [] };
  if (typeof raw.revision !== "string" || !raw.revision) throw new Error("Stored Speciality revision is invalid.");
  return { revision: raw.revision, entries: validateSpecialityEntries(raw.entries) };
}

/** Fail closed on an old API or malformed public data, without reviving legacy labels. */
export function verifiedSpecialityEntries(input: unknown): SpecialityEntry[] {
  try { return validateSpecialityEntries(input).filter(entry => entry.status === "verified"); }
  catch { return []; }
}
export function specialityCategories(input: unknown): SpecialityCategory[] {
  return [...new Set(verifiedSpecialityEntries(input).flatMap(entry =>
    entry.category === null ? [] : entry.population === "Pediatric" && entry.category !== "Pediatric"
      ? [entry.category, "Pediatric" as const] : [entry.category]))];
}
export function specialityGroups(input: unknown): Array<{ label: string; subs: string[] }> {
  const groups = new Map<string, string[]>();
  for (const entry of verifiedSpecialityEntries(input)) {
    const category = entry.category ?? "Speciality";
    const subs = groups.get(category) ?? [];
    const label = entry.population === "All" ? entry.classification : `${entry.population} — ${entry.classification}`;
    if (normal(label) !== normal(category) && !subs.includes(label)) subs.push(label);
    groups.set(category, subs);
  }
  return [...groups].map(([label, subs]) => ({ label, subs }));
}
