# Speciality rollout

## Storage and verification

Official classifications use per-entry evidence, not the hospital-wide
`verified` flag or legacy importer source tags. Admin verification is an
explicit human assertion that the linked official record was checked for that
hospital and classification; the software does not certify the external
authority or automatically inspect the linked page.

Entries contain category, exact classification, population, review status,
authority, HTTPS evidence URL, verification date, and official-record
confirmation. Only complete verified entries are used publicly. One current
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
5. Review legacy evidence manually. An empty verified list initially is expected:
   neither importer tags nor hospital-wide flags have been promoted into
   official classifications. Do not run a bulk certification or invent evidence.

Updated clients presented with an old API fail closed for Speciality and show
verification unavailable; hospitals remain visible under All Speciality.
Public API response shapes keep legacy category/string fields for installed
clients, projected from reviewed entries where possible, and preserve service
information separately. Existing installed binaries have older fallback logic;
they cannot gain the new evidence rules until updated. Release the backend,
website, and Android changes together before representing the rollout as complete.

## Verification and limitations

Isolated router fixtures cover create, evidence save/reload, revision conflicts,
identity/auth checks, connection failures, preserved legacy values, public
projection, and import preservation. Shared-rule tests cover evidence validation,
duplicates/conflicts, and identical web/Android filtering. No live hospital rows
or official verification evidence are created or changed as tests.

Evidence dates record when the administrator checked the authority. This release
does not automatically expire entries, validate authority registries, or keep
a full edit-history ledger. Rechecking stale evidence and recording audit history
are separate improvements.
