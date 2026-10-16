# Hospital administration: Railway connection handoff

## Deployment requirements

- Merge this change before publishing the API update. No publishing was performed during implementation.
- `RAILWAY_DATABASE_URL` is required for all hospital data. Its existence in the production environment was verified securely; no credentials were printed or changed.
- Keep the existing `DATABASE_URL` for unrelated/default data. Do not replace it with the Railway connection string.
- Do **not** run a schema push, migration, data import, geocoding, enrichment, merge, or synchronization as part of this release. The API artifact's development and production-build commands no longer run automatic schema pushes; application startup no longer seeds specialty definitions.
- Refresh `/api/admin-ui` after the API release and select hospitals from a newly loaded search/state list. Old numeric-ID edit/status requests are rejected with a reload requirement.
- No web/mobile endpoint configuration or Android binary changes are needed.

## Data ownership and identity

Hospital search, state browsing, counts, CSV export/import, additions, field edits,
activation, specialties, overrides, and hospital maintenance scripts now use a
separate, lazy Railway-only pool (maximum five connections). Missing configuration
or connection errors never fall back to the default store. Maintenance triggers
check Railway connectivity before starting work, and children inherit the
Railway configuration without changing `DATABASE_URL`.

Reports retain their existing independent Railway connection and behavior.
The default database implementation is unchanged.

Search/state responses and specialty-gap responses include `recordIdentity`.
Numeric hospital edits/status changes and numeric specialty-gap edits require
this signed value. It binds the numeric ID to the Railway CMS identity and is
checked against the stored CMS identity before permitting the original handler.
CMS-ID and OSM-ID mutation paths retain their stable-identifier behavior.

The editor sends this value for saves, activation, and deactivation. No existing
field-patch semantics were replaced. Legacy phone/coordinate overrides continue
to take precedence on reads; edits clear only the corresponding override fields.
Public nearby reads normalize legacy OSM IDs for the override join, matching
admin lookups.

## Verification on 2026-10-16

Read-only baselines:

| Store | Hospital records | Nonblank street addresses |
| --- | ---: | ---: |
| Railway, used by public clients | 5,432 | 5,429 |
| Default development store | 5,428 | 0 |
| Default deployed store | 5,426 | 0 |

- Existing clients still point to `https://er-choices-production.up.railway.app/api`.
- CMS identity `010005` demonstrates why numeric IDs cannot be shared between stores: Railway ID `2`, default development ID `37`.
- CMS `010001`: new admin and public results both return `1108 Ross Clark Circle`, Dothan, AL, with matching phone, ZIP, and effective coordinates.
- The normalized override representative CMS `310119` is visible from admin with its existing `150 Bergen St` address.
- Actual admin Texas state browse: 466 matching records, page 7 returns 50 records; active/inactive filters also checked.
- Actual hospital CSV export includes Railway addresses; unauthenticated admin reads return 401.
- Full-row checksums for hospital records, override records, and specialty definitions matched before/after in Railway and the default development store. The deployed default hospital checksum also matched its baseline.
- Three Railway hospitals without street addresses remain blank.
- No live hospital mutation, maintenance trigger, import, or schema command was submitted during verification.
- The managed API workflow built and restarted once, then `/api/healthz` returned `{ "status": "ok" }`. The admin sign-in page rendered correctly.

Isolated tests (no real database connections or jobs):

```sh
node --test lib/db/tests/*.test.cjs artifacts/api-server/tests/*.test.cjs
```

All 21 checks pass. They cover connection selection/pool limits, missing or
failed Railway connections, authentication, effective overrides, blank
addresses, pagination beyond 300 records, saves/additions/status changes,
specialty edits, stale and tampered identities, CSV/sync routing, maintenance
preflight/environment inheritance, report-connection invariants, and the
rendered editor's identity-bearing requests.

### Existing validation failures

- `pnpm run typecheck:libs` fails on the existing Zod/Drizzle-Zod type incompatibility in `lib/db/src/schema/index.ts`.
- `pnpm --filter @workspace/api-server run typecheck` retains existing CMS-import JSON typing errors, a script outside the configured `rootDir`, and existing handler return-path errors.
- Comparing TypeScript diagnostics using the original tracked source versus the changed source found no newly introduced diagnostics. Declaration output was refreshed with emission permitted despite the existing library error solely to make that comparison meaningful; no tracked schema code was changed.

These project-wide errors were not repaired as part of the connection change.
The API's actual esbuild build succeeds.

## Separate existing concerns

Both the Railway `Dockerfile` and the API artifact now start the API directly,
without an automatic schema push. See `RAILWAY_SETUP.md` for required database
variables, service-level override checks, and the separate approval process for
schema changes. No Railway deployment or external setting was changed by this
code update. Also, the existing `/admin/seed`
subprocess points at the module exporting the importer rather than its CLI
runner. Its routing/configuration is aligned here, but its pre-existing job
behavior was not changed or exercised against live data.
