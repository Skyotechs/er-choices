---
name: Speciality classification policy
description: User wants one term and non-overlapping official verified classifications.
---

Use the single term “speciality” for official verified classifications, rather
than overlapping specialties and designations.

**Why:** The user said, “lets only use the term speciality which should be for
official verified classifications,” so changes do not overlap.

**How to apply:** Keep admin editing and public display on a single classification
concept. Do not certify unsupported existing data or delete legacy information.
An authority name, source tag, or hospital-wide verification flag does not
grandfather an existing classification into official verified status. Updated
clients must not restore such labels through older fallback fields.

Verification is a human admin review of the hospital's exact official
classification, supported by an authority, source link, and date, not a claim
that the software authenticated an external registry.

**Why:** Existing inferred services and generic importer tags do not establish
an official classification. The user wants those concepts separated without
overlapping edits, while retaining existing information.

**How to apply:** Preserve old data for manual review, require explicit evidence
per classification, and describe missing verification as unavailable rather
than saying the service is absent. Treat public rollout as coordinated API,
web, and Android work: installed older binaries cannot acquire new evidence
rules just because an admin page changed.
