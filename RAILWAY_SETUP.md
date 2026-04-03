# Railway Deployment Guide — ER Choices API

This guide walks through moving the API server and PostgreSQL database from Replit to Railway so the backend runs 24/7 without interruption.

---

## 1. Create the Railway project

1. Sign in at [railway.app](https://railway.app) and click **New Project**.
2. Choose **Deploy from GitHub repo** and select the `er-choices` repository.
3. Railway will detect the monorepo. You will configure the build/start commands in the next step — do not let it auto-detect for now.

---

## 2. Add a PostgreSQL service

1. Inside the new project, click **+ New Service → Database → PostgreSQL**.
2. Railway will automatically inject `DATABASE_URL` into your API service. No manual copy-paste needed.

---

## 3. Configure environment variables

In the API service's **Variables** tab, add the following:

| Variable | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Enables production logging |
| `ADMIN_SECRET` | *(set a strong unique value)* | Protects the admin dashboard |
| `SESSION_SECRET` | *(a long random string)* | Used for cookie session signing |
| `CORS_ORIGINS` | `https://erchoice.replit.app,https://YOUR_CUSTOM_DOMAIN` | Comma-separated list of allowed origins — no trailing slashes. Update if you add more domains. |

> **Do NOT set `DATABASE_URL` or `PORT`** — Railway injects both automatically.

---

## 4. Configure build and start commands

In the API service's **Settings → Build** section:

- **Build command:**
  ```
  pnpm install --frozen-lockfile && pnpm --filter @workspace/db run push-force && pnpm --filter @workspace/api-server run build
  ```
  This installs all workspace packages, pushes the Drizzle schema to the Railway Postgres database, then builds the API bundle.

- **Start command:**
  ```
  node --enable-source-maps artifacts/api-server/dist/index.mjs
  ```

- **Health check path:** `/api/healthz`

> The `railway.json` file in the repo root already contains these settings. Railway will pick them up automatically if you leave the build/start fields empty.

---

## 5. Deploy

1. Click **Deploy** (or push any commit to trigger a deploy).
2. Watch the build logs — the `push-force` step will create all tables in the Railway Postgres database.
3. Once the health check at `/api/healthz` returns `200 OK`, the service is live.
4. Copy your Railway service URL (e.g. `https://er-choices-api-production.up.railway.app`).

---

## 6. Trigger the CMS hospital import

1. Open the admin dashboard at:
   ```
   https://<railway-service-url>/api/admin-ui
   ```
2. Enter your admin password when prompted.
3. Click **Run Full Import** (Phase 1 → Phase 2 → Phase 3).
4. The import processes ~5,426 hospitals. It takes 10–20 minutes. Railway will not interrupt it.
5. When the status shows "Import complete", verify the hospital count matches.

---

## 7. Point the web app at Railway

Add the following to `artifacts/er-choices-web/.env.production` (create the file if it doesn't exist):

```
VITE_API_BASE=https://<railway-service-url>/api
```

Then redeploy the web app on Replit. The web app already reads `VITE_API_BASE` and falls back to `window.location.origin/api` for local development, so dev mode is unaffected.

---

## 8. Point the mobile app at Railway

Update `artifacts/closest-hospital/.env`:

```
EXPO_PUBLIC_DOMAIN=<railway-service-url>
```

Remove the `https://` prefix — the app prepends the scheme itself (check `HospitalContext.tsx` for the exact format used).

Also update the `EXPO_PUBLIC_DOMAIN` secret in Replit's Secrets panel to match, so new EAS builds pick it up.

---

## 9. Remove the Replit API server (optional, later)

Once Railway is confirmed healthy:
1. You can stop the `artifacts/api-server` workflow on Replit to save resources.
2. The web app and mobile app will now make all requests directly to Railway.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `push-force` fails during build | `DATABASE_URL` not injected yet | Make sure the Postgres service was added *before* the first deploy |
| CORS errors in browser | `CORS_ORIGINS` missing the web domain | Add the exact origin (no trailing slash) to the `CORS_ORIGINS` env var |
| Health check never passes | Port mismatch | Railway injects `PORT` automatically; the API reads `process.env.PORT` |
| Import hangs mid-way | Memory limit on hobby plan | Upgrade Railway plan or re-trigger — import is resumable via Phase 2/3 buttons |
