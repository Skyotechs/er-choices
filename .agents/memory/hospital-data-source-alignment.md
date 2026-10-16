---
name: Hospital data source alignment
description: Public hospital data and same-origin admin routes can use different databases.
---

Do not assume that the website and its admin page use the same hospital store
because they share a public domain.

**Why:** The website's configured API base pointed to Railway, like the Android
app, while same-origin hospital admin routes used Replit's separate database.
The latter lacked street addresses present in Railway. Connecting reports to
Railway did not change hospital-admin storage.

**How to apply:** Check the public clients' actual API configuration and the
admin's deployed connection before diagnosing missing fields. Align hospital
admin reads and writes together only with user authorization. Do not copy
addresses or join records across databases by numeric IDs, which may differ.

Railway should be the hospital-data source of truth: the admin must read and
edit the same data the app and website use, including their existing addresses.
Preserve the user's constraint: “existing records are untouched, no changes to
anything else.”

**Why:** The user explicitly replaced the proposed address-only backfill with
alignment of admin reads and edits to Railway.

**How to apply:** Align the hospital connection rather than copying or merging
records. Leave both databases' existing records intact during the change; only
subsequent intentional admin edits should modify Railway records. Guard against
stale numeric IDs from the old admin dataset targeting a different hospital.
