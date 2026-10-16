# Railway deployment guide — ER Choices API

Railway hosts the API used by the public website and Android/Apple apps.
Hospital administration and reports must read and write the existing Railway
hospital database. Publishing Replit is a separate release.

## 1. Existing project: keep the current database

Use the existing API service and PostgreSQL database. Do not create a replacement
database, copy hospital records, rerun an import, or change database targets as
part of a routine code release.

Review the API service's variables securely in Railway. Do not paste credentials
into chat, source control, logs, or screenshots.

| Variable | Requirement |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Keep the existing default application database connection. The application still requires this variable at startup. |
| `RAILWAY_DATABASE_URL` | Required by hospital administration, public hospital reads, reports, and hospital maintenance. It must point to the existing canonical Railway hospital database; there is no fallback to `DATABASE_URL`. |
| `ADMIN_SECRET` | Keep the existing admin authentication secret; hospital record identities are also signed with this value. |
| `SESSION_SECRET` | Preserve this variable if configured for other session consumers; it does not replace `ADMIN_SECRET`. |
| `CORS_ORIGINS` | Allow the actual published web origins that call the API. |
| `PORT` | Use the port provided by Railway. |

In Railway, use service variable references to the intended PostgreSQL service
rather than copying connection strings. When the API's default store and
hospital store intentionally use the same Railway database, both variables may
reference that service. Do not assume this is also true of Replit's default
database: preserve its existing independent `DATABASE_URL`.

These are configuration requirements, not confirmation that the external
Railway service currently has every variable set. Verify before release.
Hospital pools are lazy: a successful process start or health check does not
validate `RAILWAY_DATABASE_URL`. Confirm its service reference before approving
the release, then use only read-only hospital/report requests to check access.

## 2. Repository and container settings

- Connect the GitHub repository and the branch intended for production.
- Keep the root directory at the repository root, not `artifacts/api-server`.
  The API build depends on the shared `lib/` workspace packages.
- `railway.json` selects the root `Dockerfile` and `/api/healthz` health check.
- The Dockerfile installs dependencies and builds the API. It does not apply
  database schema changes.
- The container start command is only:

  ```sh
  node --enable-source-maps artifacts/api-server/dist/index.mjs
  ```

Review Railway service-level overrides as well as the repository configuration.
Remove any existing custom Build, Start, or Pre-deploy command that pushes
schema, migrates, imports, seeds, enriches, or synchronizes hospital data.
Prefer the Dockerfile's build and start defaults. Changing this repository does
not remove an old command stored in Railway's dashboard.

Routine deployments and restarts must not create, alter, drop, truncate, seed,
or import hospital tables. This release needs no database migration.
An unprovisioned or incompatible database should fail explicitly rather than
being silently created, replaced, or populated during startup.

## 3. Automatic code releases through GitHub

### Single-command release from Replit

Run this explicitly in the Replit Shell from the repository root:

```sh
pnpm release:api
```

Starting this command is approval to push the committed `main` branch to
`Skyotechs/er-choices`, which can trigger a live Railway deployment. Save and
commit the intended changes first. The command never stages or commits files
for you; pending tracked or untracked files block release.
The ordinary Run button and app startup never invoke the release command.

The command also blocks tracked credentials in `.replit`. Before the first
release, move the plaintext admin credential out of source control and into
Secrets, and rotate it with explicit approval. Removing it from the latest file
does not erase earlier Git history. Do not rewrite history or rotate credentials
as part of the release command.

It runs the Speciality, hospital/report store, startup-safety, and release-script
regressions, then builds the API. It checks for concurrent local changes and
fetches current GitHub history before pushing only the exact tested commit.
It never force-pushes, bypasses Git hooks, merges, rebases, resets, or runs
database maintenance. Divergent history or failed checks stop the release.

The command uses a clean, fixed HTTPS repository URL instead of a potentially
credential-bearing `origin`. If the existing `GITHUB_PAT` secret is available,
a process-scoped credential helper supplies it to Git without putting it in
the URL or saving it in Git configuration. Otherwise existing Git credential
helpers are used. The credential needs write access to this repository; any
Git LFS hook must also authenticate successfully. No Git/LFS safety checks
are disabled.

Safe checks that do **not** push:

```sh
pnpm release:api:check
pnpm release:api --check-connection
```

The first runs tests and builds the current working files (even if uncommitted).
Passing this check-only mode does not establish that credential cleanup, a clean
committed branch, or GitHub write access is ready.
The second only checks whether GitHub's `main` is readable; read access alone
does not establish push permission. This focused API gate does not claim a
passing whole-workspace typecheck, website/mobile build, or native store build.
Existing unrelated workspace typecheck failures remain separate work.

A successful push is not confirmation of a completed Railway deployment.
Verify the pushed commit and deployment status in Railway. This command does
not configure external Railway settings, publish Replit, or build/upload apps
to Google Play or the Apple App Store.

### Railway configuration (required once)

1. In the API service's Settings → Source, confirm the connected repository and
   branch.
2. Enable automatic deployments for that branch if they are disabled.
3. Commit and push the complete project changes, including shared libraries.
4. Railway will build the pushed commit and start the new API.
5. If watch paths are configured, include the API, shared libraries, root
   package/lock/workspace files, `Dockerfile`, and `railway.json`; otherwise an
   API dependency change can be skipped. Leaving watch paths unset avoids that
   accidental omission.

For a manual deployment of new code, open Railway's command palette and select
**Deploy Latest Commit**. **Redeploy** on an earlier deployment rebuilds that
deployment's original code; it does not fetch new workspace changes.

Replit republishing is not a native trigger for Railway. The recommended flow
is to push the same tested code to GitHub for Railway autodeploy, then republish
the Replit website/admin as appropriate. Do not add a deployment trigger to the
API startup or health check: normal restarts and health probes must not launch
more deployments.

Optional: after adding a suitable GitHub Actions workflow, Railway's **Wait for
CI** can hold a deployment until its checks succeed. Do not enable this without
the required workflow.

References:
- [Railway GitHub autodeploys](https://docs.railway.com/deployments/github-autodeploys)
- [Railway deployment actions](https://docs.railway.com/deployments/deployment-actions)

## 4. Read-only verification after an approved deployment

Deployment itself must be separately approved. No deployment, external setting,
database connection, schema operation, or live hospital edit was performed by
the startup-safety change.

1. Confirm Railway built the intended GitHub commit, not a previous deployment.
2. Check startup logs: they should start Node directly, with no schema or import
   step.
3. Confirm `/api/healthz` returns success. This checks that the API is serving;
   it does not prove database connectivity or correct database selection.
4. Sign in at `/api/admin-ui` and use a read-only hospital search/state list and
   Reports view to confirm the canonical store is reachable.
5. Check public hospital reads against the same existing records. Do not make
   test edits, run imports, or trigger synchronization to verify a release.
6. Refresh old admin pages. Web and mobile code changes still require their own
   coordinated releases; API deploys do not update installed app binaries.

The existing Replit API may still serve the same-origin admin panel. Do not
remove it merely because the public clients use Railway.

## 5. Database schema changes: separate explicit approval

Schema changes are maintenance work, never part of an ordinary build, startup,
health check, automatic GitHub deployment, or container restart.

Before any future schema change:

1. Identify the intended database and environment using read-only checks. The
   existing `lib/db/drizzle.config.ts` and database push commands target
   `DATABASE_URL`, not `RAILWAY_DATABASE_URL`. They must not be assumed to target
   the hospital database.
2. Prepare and review the proposed SQL/migration separately. Explain affected
   tables, possible data loss, locks/downtime, and compatibility with both
   backends and installed Android/Apple clients.
3. Confirm a restorable backup and a recovery procedure with the database owner.
4. Obtain explicit approval for the exact operation and production target.
5. Run only that approved operation as a separately supervised maintenance
   action, with credentials supplied securely to that operation. Do not
   permanently repoint either application database variable to select a target.
6. Verify the result using read-only schema/data checks before releasing code
   that depends on it.

Do not use a forced schema push as a shortcut for a reviewed production change.
No schema command is needed or authorized for this startup-safety release.

## Troubleshooting

| Symptom | Action |
|---|---|
| Hospital/report routes say `RAILWAY_DATABASE_URL` is missing | Configure the API service's secure reference to the existing canonical hospital database. Do not substitute an unrelated default store. |
| Startup says `DATABASE_URL` is missing | Restore the existing default-store variable/reference; the API still imports that connection module. |
| A table or column is missing | Confirm the correct database first. Stop and prepare a separately approved schema change; do not add schema pushes to startup. |
| CORS blocks the web client | Check that `CORS_ORIGINS` includes the actual published web origin. |
| Deployment succeeds but old behavior remains | Check the deployed commit and whether an old deployment was redeployed instead of the latest commit. |
| GitHub push does not deploy | Check autodeploy permissions, branch selection, watch paths, and skipped deployments in Railway. |
