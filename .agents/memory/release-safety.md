---
name: Release safety
description: Keep routine releases separate from database maintenance and avoid recursive deployment triggers.
---

Routine builds, deployments, restarts, and health checks must not apply hospital
database schema changes, import records, or otherwise run data maintenance.
Schema work requires separate explicit approval for the intended database.

**Why:** Hospital data is shared across admin, web, Android, and Apple clients.
The user approved removing schema changes from Railway startup before releasing
updated API code; that approval did not authorize a migration or deployment.

**How to apply:** Keep ordinary release commands limited to building and serving
the API. Review external service-level command overrides before claiming the
running Railway service has adopted a safe startup.

Prefer source-control-triggered Railway deployments to triggers in the running
application's startup or health checks.

**Why:** Restarts, replicas, and repeated health checks must not launch more
deployments or create a deployment loop. Replit publishing and Railway deployment
are independent release operations.

**How to apply:** Explain GitHub autodeploy as a push-triggered release, not as an
automatic consequence of Replit republishing. Do not claim external automation
is enabled without checking or configuring it with approval.

The user chose an intentional one-click release (checks, GitHub push, then
Railway autodeploy), not unattended pushes of every change.

**Why:** Pushing to the production branch can release unfinished code. Setting
up the release action is separate from executing a production release.

**How to apply:** Keep releases user-initiated. Do not start release automation
as part of app startup, health checks, routine editing, or verification.

Keep production push commands out of Replit workflows used for normal app runs.

**Why:** Configuring a custom workflow can attach it to the default Project run
action even with `autoStart: false`; this can turn a normal Run into a release.

**How to apply:** Use an explicit Shell release command. If adding manual
automation later, inspect the default Run dependency graph before leaving it
configured; do not rely on `autoStart: false` alone.
