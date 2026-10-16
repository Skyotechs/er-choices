import { createHmac, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { getHospitalPool, hospitalDb, hospitalSpecialties } from "@workspace/db";
import { eq } from "drizzle-orm";

type HospitalIdentity = { id: number; cmsId: string };

/** An authenticated read binds a numeric ID to its stable Railway CMS identity. */
export function hospitalRecordIdentity(record: HospitalIdentity): string {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) throw new Error("Admin authentication is not configured");
  const identity = Buffer.from(JSON.stringify(["railway-hospital-v1", record.id, record.cmsId])).toString("base64url");
  const signature = createHmac("sha256", secret).update(identity).digest("base64url");
  return `${identity}.${signature}`;
}

export const requireHospitalIdentity: RequestHandler = async (req, res, next) => {
  const rawId = typeof req.params.id === "string" ? req.params.id : "";
  const id = Number(rawId);
  // Preserve the legacy osmId endpoint's 410 response, but never let parseInt
  // in an older handler turn an unguarded "1junk" into a write to hospital 1.
  if (rawId.startsWith("osm-")) { next(); return; }
  if (!Number.isSafeInteger(id) || id <= 0 || !/^\d+$/.test(rawId)) {
    res.status(400).json({ error: "id must be a positive integer" });
    return;
  }
  const token = req.body?.recordIdentity;
  const reload = () => res.status(409).json({
    error: "Hospital data source has changed or the record identity is stale. Reload the admin page and select the hospital again.",
  });
  if (typeof token !== "string" || token.length > 2048) { reload(); return; }
  try {
    const [payload, signature, extra] = token.split(".");
    const [store, tokenId, cmsId] = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (extra || store !== "railway-hospital-v1" || tokenId !== id || typeof cmsId !== "string") {
      reload(); return;
    }
    const expected = hospitalRecordIdentity({ id, cmsId });
    const a = Buffer.from(token), b = Buffer.from(expected);
    if (!signature || a.length !== b.length || !timingSafeEqual(a, b)) { reload(); return; }
    const [record] = await hospitalDb.select({ id: hospitalSpecialties.id, cmsId: hospitalSpecialties.cmsId })
      .from(hospitalSpecialties).where(eq(hospitalSpecialties.id, id)).limit(1);
    if (!record || record.cmsId !== cmsId) { reload(); return; }
  } catch {
    // Malformed tokens are a reload error; database errors must not look successful.
    res.status(503).json({ error: "Unable to verify hospital identity. Reload the admin page; if this persists, check the Railway hospital connection." });
    return;
  }
  next();
};

export const requireHospitalStore: RequestHandler = async (_req, res, next) => {
  try {
    await getHospitalPool().query("SELECT 1");
    next();
  } catch {
    res.status(503).json({ error: "Railway hospital database is not configured or is unavailable. No maintenance job was started." });
  }
};
