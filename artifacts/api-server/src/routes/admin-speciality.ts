import { Router, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { hospitalDb as db, hospitalSpecialties } from "@workspace/db";
import { UpdateAdminHospitalSpecialityBody } from "@workspace/api-zod";
import { readSpecialityState, recordAdminSpecialities, SPECIALITY_KEY } from "@workspace/speciality";
import { hospitalRecordIdentity, requireHospitalIdentity } from "../lib/hospital-store";
import { specialityProvenanceUpdate } from "../lib/speciality-store";

const router = Router();
const requireAdmin: RequestHandler = (req, res, next) => {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers.authorization?.replace(/^Bearer\s+/i, "") !== secret) {
    res.status(401).json({ error: "Unauthorized" }); return;
  }
  next();
};
function review(record: typeof hospitalSpecialties.$inferSelect) {
  const sources = { ...record.designationSources as Record<string, unknown> };
  delete sources[SPECIALITY_KEY];
  return {
    id: record.id, recordIdentity: hospitalRecordIdentity(record),
    ...readSpecialityState(record.designationSources),
    legacy: {
      specialties: record.specialties, actualDesignation: record.actualDesignation,
      strokeDesignation: record.strokeDesignation, burnDesignation: record.burnDesignation,
      designationSources: sources, needsAdminReview: record.needsAdminReview,
      serviceLine: record.serviceLine, pciCapability: record.pciCapability,
    },
  };
}
router.get("/admin/hospitals/:id/speciality", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "Invalid hospital id" }); return; }
  try {
    const [record] = await db.select().from(hospitalSpecialties).where(eq(hospitalSpecialties.id, id)).limit(1);
    if (!record) { res.status(404).json({ error: "Hospital not found" }); return; }
    res.setHeader("Cache-Control", "no-store");
    res.json(review(record));
  } catch (err) {
    req.log.error({ err }, "Speciality review could not be loaded");
    res.status(503).json({ error: "Unable to load Speciality review. No legacy values have been certified. Retry before editing." });
  }
});
router.put("/admin/hospitals/:id/speciality", requireAdmin, requireHospitalIdentity, async (req, res): Promise<void> => {
  const parsed = UpdateAdminHospitalSpecialityBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid Speciality update. Include record identity, expected revision, and classification entries." }); return; }
  const id = Number(req.params.id);
  try {
    const [current] = await db.select().from(hospitalSpecialties).where(eq(hospitalSpecialties.id, id)).limit(1);
    if (!current) { res.status(404).json({ error: "Hospital not found" }); return; }
    const previous = readSpecialityState(current.designationSources);
    if (previous.revision !== parsed.data.expectedRevision) {
      res.status(409).json({ error: "Speciality changed in another session. Reload before saving." }); return;
    }
    let entries;
    try { entries = recordAdminSpecialities(parsed.data.entries, previous.entries); }
    catch (err) { res.status(400).json({ error: (err as Error).message }); return; }
    const state = { revision: randomUUID(), entries };
    const [saved] = await db.update(hospitalSpecialties).set({
      designationSources: specialityProvenanceUpdate(state), updatedAt: new Date(),
    }).where(and(
      eq(hospitalSpecialties.id, id),
      sql`COALESCE(${hospitalSpecialties.designationSources}->${SPECIALITY_KEY}->>'revision', '') = ${parsed.data.expectedRevision}`,
    )).returning();
    if (!saved) {
      res.status(409).json({ error: "Speciality revision conflict: changed in another session. Your entries were not saved. Reload the review before trying again." }); return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(review(saved));
  } catch (err) {
    req.log.error({ err }, "Speciality save failed");
    res.status(503).json({ error: "Speciality could not be saved. Check the connection and reload to confirm the current review." });
  }
});
export default router;
