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
  try {
    const [report] = await db
      .insert(hospitalReports)
      .values({ osmId, hospitalName, issueType, notes })
      .returning({ id: hospitalReports.id });
    res.status(201).json({ success: true, id: report.id });
  } catch (err) {
    console.error("POST /api/reports error:", err);
    res.status(500).json({ error: "Failed to save report" });
  }
});

router.get("/admin/reports", requireAdmin, async (_req, res) => {
  try {
    const reports = await db
      .select()
      .from(hospitalReports)
      .orderBy(desc(hospitalReports.submittedAt));
    res.json(reports);
  } catch (err) {
    console.error("GET /api/admin/reports error:", err);
    res.status(500).json({ error: "Failed to load reports" });
  }
});

router.get("/admin/reports/export-csv", requireAdmin, async (_req, res) => {
  try {
    const reports = await db
      .select()
      .from(hospitalReports)
      .orderBy(desc(hospitalReports.submittedAt));

    const ISSUE_LABELS: Record<string, string> = {
      wrong_name: "Wrong Name",
      wrong_address: "Wrong Address",
      wrong_phone: "Wrong Phone",
      permanently_closed: "Permanently Closed",
      not_a_hospital: "Not a Hospital",
      wrong_specialty: "Wrong Specialty",
      other: "Other",
    };

    function csvCell(v: string | null | undefined): string {
      if (v == null) return "";
      const s = String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    }

    const headers = ["ID", "Hospital Name", "Hospital ID", "Issue Type", "Notes", "Status", "Submitted At", "Resolved At"];
    const rows = reports.map((r) => [
      r.id,
      csvCell(r.hospitalName),
      csvCell(r.osmId),
      csvCell(ISSUE_LABELS[r.issueType] ?? r.issueType),
      csvCell(r.notes),
      csvCell(r.status),
      r.submittedAt ? new Date(r.submittedAt).toISOString() : "",
      r.resolvedAt ? new Date(r.resolvedAt).toISOString() : "",
    ]);

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="hospital-reports-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error("GET /api/admin/reports/export-csv error:", err);
    res.status(500).json({ error: "Failed to export reports" });
  }
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
