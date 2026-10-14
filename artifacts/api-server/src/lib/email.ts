import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

const ADMIN_EMAIL = "jason.deluca@skyotechs.com";
// Use onboarding@resend.dev until erchoices.com domain is verified on Resend.
// Once verified at https://resend.com/domains, switch to: "ER Choices <alerts@erchoices.com>"
const FROM_EMAIL = "ER Choices <onboarding@resend.dev>";

const ISSUE_LABELS: Record<string, string> = {
  wrong_name: "Wrong Name",
  wrong_address: "Wrong Address",
  wrong_phone: "Wrong Phone",
  permanently_closed: "Permanently Closed",
  not_a_hospital: "Not a Hospital",
  wrong_specialty: "Wrong Specialty",
  other: "Other",
};

export interface ReportEmailParams {
  reportId: number;
  hospitalName: string;
  hospitalId: string;
  issueType: string;
  notes?: string | null;
}

export async function sendReportAlert(params: ReportEmailParams): Promise<void> {
  const { reportId, hospitalName, hospitalId, issueType, notes } = params;
  const issueLabel = ISSUE_LABELS[issueType] ?? issueType;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f8fafc">
      <div style="background:#0d1b2e;border-radius:12px;padding:24px;margin-bottom:16px">
        <div style="display:inline-block;background:#c0392b;border-radius:8px;padding:6px 12px;font-weight:800;font-size:14px;color:#fff;letter-spacing:.05em;margin-bottom:16px">ER CHOICES</div>
        <h2 style="color:#f1f5f9;margin:0 0 4px;font-size:20px">New Hospital Report</h2>
        <p style="color:#64748b;margin:0;font-size:14px">Report #${reportId} submitted by a user</p>
      </div>

      <div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e2e8f0">
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;width:140px">Hospital</td>
            <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:15px;color:#0f172a;font-weight:600">${escHtml(hospitalName)}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Issue Type</td>
            <td style="padding:10px 0;border-bottom:1px solid #f1f5f9">
              <span style="background:#c0392b22;color:#c0392b;font-size:13px;font-weight:700;padding:3px 10px;border-radius:4px">${escHtml(issueLabel)}</span>
            </td>
          </tr>
          ${notes ? `
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Notes</td>
            <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#334155">${escHtml(notes)}</td>
          </tr>` : ""}
          <tr>
            <td style="padding:10px 0;font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Hospital ID</td>
            <td style="padding:10px 0;font-size:12px;color:#94a3b8;font-family:monospace">${escHtml(hospitalId)}</td>
          </tr>
        </table>

        <div style="margin-top:20px;padding-top:16px;border-top:1px solid #f1f5f9">
          <a href="https://er-choices-production.up.railway.app/api/admin-ui"
             style="display:inline-block;background:#c0392b;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:10px 20px;border-radius:8px">
            Review in Admin Dashboard →
          </a>
        </div>
      </div>

      <p style="text-align:center;color:#94a3b8;font-size:12px;margin-top:16px">
        ER Choices — Hospital Database Alerts
      </p>
    </div>
  `;

  const text = [
    `New Hospital Report #${reportId}`,
    ``,
    `Hospital: ${hospitalName}`,
    `Issue: ${issueLabel}`,
    notes ? `Notes: ${notes}` : null,
    `Hospital ID: ${hospitalId}`,
    ``,
    `Review at: https://er-choices-production.up.railway.app/api/admin-ui`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  try {
    const connectors = new ReplitConnectors();
    const response = await connectors.proxy("resend", "/emails", {
      method: "POST",
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [ADMIN_EMAIL],
        subject: `[ER Choices] Report #${reportId}: ${issueLabel} — ${hospitalName}`,
        html,
        text,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.warn({ status: response.status, body }, "Resend API returned non-OK status");
    } else {
      logger.info({ reportId, hospitalName, issueType }, "Report alert email sent");
    }
  } catch (err) {
    // Non-fatal — log but don't fail the request
    logger.error({ err, reportId }, "Failed to send report alert email");
  }
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
