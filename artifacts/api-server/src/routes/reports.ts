import { Router } from "express";
import { db, hospitalReports } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

const VALID_ISSUE_TYPES = new Set([
  "wrong_name",
  "wrong_address",
  "wrong_phone",
  "permanently_closed",
  "not_a_hospital",
  "wrong_specialty",
  "other",
]);

function requireAdmin(req: any, res: any, next: any) {
  const secret = process.env.ADMIN_SECRET;
  const auth = req.headers["authorization"] ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!secret || token !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.post("/reports", async (req, res) => {
  const { osmId, hospitalName, issueType, notes } = req.body ?? {};
  if (
    typeof osmId !== "string" || !osmId.trim() ||
    typeof hospitalName !== "string" || !hospitalName.trim() ||
    !VALID_ISSUE_TYPES.has(issueType)
  ) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const [report] = await db
    .insert(hospitalReports)
    .values({ osmId, hospitalName, issueType, notes })
    .returning({ id: hospitalReports.id });

  res.status(201).json({ success: true, id: report.id });
});

router.get("/admin/reports", requireAdmin, async (_req, res) => {
  const reports = await db
    .select()
    .from(hospitalReports)
    .orderBy(desc(hospitalReports.submittedAt));
  res.json(reports);
});

router.patch("/admin/reports/:id/resolve", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db
    .update(hospitalReports)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(eq(hospitalReports.id, id));
  res.json({ success: true });
});

router.patch("/admin/reports/:id/dismiss", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db
    .update(hospitalReports)
    .set({ status: "dismissed", resolvedAt: new Date() })
    .where(eq(hospitalReports.id, id));
  res.json({ success: true });
});

export default router;
