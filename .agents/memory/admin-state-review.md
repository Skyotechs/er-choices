---
name: Admin state-wide hospital review
description: State browsing must support reviewing all hospitals independently of name search.
---

Admins need to view all hospitals by state separately from having to search
for them, to support large-scale editing.

**Why:** The user explicitly requested state-wide review for “better grandscale
editing.”

**How to apply:** Keep state browsing independent of search terms and make every
matching hospital reachable, rather than silently truncating the state list.
Preserve review context when opening and returning from hospital edits.
