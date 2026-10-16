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

Admins only need to record the Speciality, since they would have done the research
to determine it. Saving the classification is sufficient confirmation. Do not
require an authority name, evidence URL, manually entered date, review-status
selection, or additional confirmation checkbox. Admins enter Category / Speciality
OR exact classification / level; either alone is enough, not both. Population
must not be another required input or selector.

Services & Capabilities should let admins select all applicable Speciality
categories with checkboxes, rather than making them add each category manually.

**Why:** The user requested all relevant specialties, including general acute
care, women and critical access, as a multiple-selection checkbox list.

**How to apply:** Keep the checklist and optional exact classifications in the
same authoritative Speciality records, not parallel overlapping fields.

**Why:** The user said, “admin only needs to record the specialties, since they
would have done the research to determine the specialty,” then clarified,
“Category/Specialty or Exact classification/level.”

**How to apply:** Trust authenticated admin saves, preserve existing optional
supporting information, and keep imports from automatically confirming legacy
labels. Describe missing confirmation as unavailable rather than saying the
service is absent. Coordinate Railway API, website/admin, Android, and Apple/iOS releases; installed
older binaries cannot acquire the updated rules just because an admin page changed.

**Why:** The user clarified the release scope: “its for the website, railway api,
android and apple apps.”

Do not guess the category of a classification-only entry (for example, “Level II”).

**Why:** Accepting level-only entries must not invent a Trauma or other classification.

**How to apply:** Show the entered level without a guessed category; category-based
filters use an explicitly recorded category. Preserve previously stored population
and supporting details without making admins re-enter them.

The admin editor should have no Service Line input. Show an optional PCI/STEMI
capability field only when Cardiac is selected; selecting Stroke or Cardiac must
not automatically assert PCI capability.

**Why:** The user said there is no need for Service Line and chose an optional
PCI/STEMI field conditional on Cardiac after the cardiac/stroke distinction was explained.

**How to apply:** Preserve stored legacy values when removing or hiding inputs.
PCI/STEMI remains an explicitly entered capability, separate from category selection.
