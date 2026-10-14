---
name: Hospital report visibility
description: Admin visibility is required alongside hospital-report email alerts.
---

The admin panel should show when reports are made.

**Why:** The user explicitly requested this while reviewing hospital-report
alerts; an email alert alone does not meet that requirement.

**How to apply:** Preserve admin visibility of submitted hospital reports and
their submission times when changing report or notification flows.

Verify that the installed app's report submissions and the published admin
reader use the same backing database; matching routes are not enough.

**Why:** The Android app wrote reports to Railway while the erchoices.com
admin read Replit's separate production database. Successful polling showed
old records, not the newly submitted reports.

**How to apply:** Compare the deployed writer and reader, including read-only
database checks. Simulated UI tests cannot confirm production data visibility.
Do not move or delete records to mask a connection mismatch.
