# Speciality rollout

## Storage and verification

Official classifications are confirmed by an authenticated admin saving the
Speciality after doing their research. Authority, evidence URL, date, status
selection and a separate confirmation checkbox are not required in the editor.
The software does not verify external registries. The hospital-wide `verified`
flag and legacy importer tags still do not automatically confirm classifications.

Admins enter category, exact classification and population. The server records
confirmation and a date automatically. Previously saved authority/source/date
metadata is optional and retained for unchanged entries when omitted. Only
admin-confirmed entries are used publicly. One current
classification per category and overlapping population prevents contradictory
labels. Adult and pediatric entries may coexist.

The authoritative envelope is stored at `_specialityV1` in the existing
`designation_sources` JSONB column. This is reserved application metadata,
not a legacy source tag. The envelope contains a revision and reviewed entries.
No new table, schema push, startup migration, or legacy backfill is required.
Existing legacy values remain available in the admin's read-only review.

All importer updates to this JSONB column must preserve this namespace in
the UPDATE expression itself, not copy it from a prior snapshot. Otherwise
a concurrent manual review could be lost. The dedicated save changes only
this namespace and updatedAt, with optimistic revision protection, while
preserving all existing legacy source keys and hospital fields.

## Release order

1. Publish the API code to **every backend used by the public clients and
   admin**, including Railway. Publishing only the Replit admin API will
   not update the Railway public API.
2. Verify authenticated GET `/api/admin/hospitals/:id/speciality` and public
   `/api/hospitals/nearby` responses read the same Railway store. Use read-only
   checks; do not submit test edits to existing hospitals.
3. Publish the website update. Build and distribute a new Android version
   through the usual approved release process. No binary or Play upload is
   performed by this change.
4. Refresh open admin pages. Old classification write endpoints and overlapping
   legacy fields now reject changes with a reload/use-editor message. Ordinary
   non-classification hospital edits and report workflows are unchanged.
5. Record researched legacy classifications through the admin editor. An empty confirmed list initially is expected:
   neither importer tags nor hospital-wide flags have been promoted into
   official classifications. Do not run a bulk certification.

Updated clients presented with an old API fail closed for Speciality and show
verification unavailable; hospitals remain visible under All Speciality.
Public API response shapes keep legacy category/string fields for installed
clients, projected from reviewed entries where possible, and preserve service
information separately. Existing installed binaries have older fallback logic;
they cannot gain the new admin-confirmation rules until updated. Release the backend,
website, and Android changes together before representing the rollout as complete.

## Verification and limitations

Isolated router fixtures cover classification-only create/save/reload, revision conflicts,
identity/auth checks, connection failures, preserved legacy values, public
projection, optional metadata preservation, and import preservation. Shared-rule tests cover confirmation validation,
duplicates/conflicts, and identical web/Android filtering. No live hospital rows
or official verification evidence are created or changed as tests.

For new entries the stored date is the admin recording date; historical dates
remain unchanged for unchanged entries. This release does not automatically
expire entries, validate authority registries, or keep a full edit-history ledger.
Rechecking classifications and recording audit history are separate improvements.
