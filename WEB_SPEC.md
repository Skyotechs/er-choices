> **MAINTAINER NOTE:** This file is a living specification. It **must be updated** whenever the mobile app (`artifacts/closest-hospital`) or the API server (`artifacts/api-server`) gains new features, and whenever the web mirror (`artifacts/er-choices-web`) is changed.

# ER Choices Web — Living Specification

## Purpose

Provide a fully functional browser-based mirror of the ER Choices mobile app so that users on any device or OS — including older iPhones, Android phones, and desktop browsers — can access the same core functionality without installing a native app.

---

## Target Users

- EMS professionals and first responders who need to locate nearby emergency rooms quickly
- Users on devices that cannot run the native Expo mobile app
- Desktop users who prefer a browser interface

---

## Features

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Consent / disclaimer gate | ✅ Implemented | Stored in `localStorage` (`er_choices_consent_v1`). Shows once; skipped on repeat visits. |
| 2 | Browser Geolocation | ✅ Implemented | Uses `navigator.geolocation.getCurrentPosition` with `enableHighAccuracy: true`. |
| 3 | Interactive map | ✅ Implemented | Leaflet.js over OpenStreetMap tiles. User location shown as blue dot; hospitals as red "H" markers. |
| 4 | Hospital list | ✅ Implemented | Sorted by distance (ascending), limited to 10 results. Shows name, address, distance (miles), and phone. |
| 5 | Specialty filter bar | ✅ Implemented | Horizontal scrollable bar with 10 category groups (All, Trauma, Stroke, Cardiac, Pediatric, Obstetrics, Burn, Psychiatric, Cancer, HazMat). These groups map to the 16 underlying admin designation keys returned by `/api/specialties` (e.g., "Trauma - Adult Level 1 & 2" → Trauma). Filters both map markers and the list in real time. |
| 6 | Hospital detail panel | ✅ Implemented | Slide-up panel showing name, address, distance, phone (click-to-call `tel:` link), and navigation links. |
| 7 | Navigation links | ✅ Implemented | Deep-link URLs to Google Maps, Apple Maps, and Waze using destination coordinates. |
| 8 | Report incorrect info | ✅ Implemented | Modal with radio issue-type selection + optional notes textarea; POSTs to `/api/reports`. |
| 9 | Info / About page | ✅ Implemented | App version, location data policy, privacy policy link, terms link, contact support mailto, disclaimer text. |
| 10 | Refresh / re-locate | ✅ Implemented | Button re-runs geolocation and re-fetches hospitals from Overpass API. |
| 11 | Verified specialty overlay | ✅ Implemented | Pulls from `/api/specialties`; admin-verified specialties override OSM-inferred categories. |

---

## Screen / Page Inventory

### Consent Gate (`ConsentGate.tsx`)

Full-screen overlay shown on first visit:
- App logo and tagline
- Disclaimer text about location usage and informational-only nature
- "I Agree" button → stores acceptance, reveals app
- Link to Terms of Service / EULA / Privacy Policy (`https://www.skyotechs.com/erlegal`)

### Home Page (`pages/Home.tsx`)

Main screen with two sub-sections:

**Map Section (`components/HospitalMap.tsx`)**
- Leaflet map (OpenStreetMap tiles)
- Blue marker = user location
- Red "H" markers = hospitals; clicking a marker opens the detail panel
- Refresh button (top-right) re-runs geolocation

**Hospital List**
- Vertical scroll of `HospitalCard` components
- Each card: rank number, name, address, phone, distance badge, specialty tags

**Category Filter (`components/CategoryFilter.tsx`)**
- Shown only when at least one specialty has verified data
- Horizontal scrollable pill list; active pill is red

### Hospital Detail Panel (`components/HospitalDetailPanel.tsx`)

Slide-up bottom sheet:
- Hospital name, address, distance, click-to-call phone link
- Navigation buttons: Apple Maps, Google Maps, Waze
- "Report incorrect information" → opens Report Modal
- Cancel button

### Report Modal (`components/ReportModal.tsx`)

Second-layer bottom sheet:
- Issue type radio selection (wrong name, address, phone, permanently closed, not a hospital, wrong specialty, other)
- Optional notes textarea (max 500 chars)
- Cancel / Submit buttons; success/error states

### About Page (`pages/About.tsx`)

Static info page:
- About section: version, location data policy, privacy policy link, terms link
- Support section: mailto link (`support@erchoices.com`)
- Permissions section: location access explanation
- Important Disclaimer block
- Copyright line

---

## API Contracts Used

All requests go to the same Express API server used by the mobile app (preview path `/api`).

### `GET /api/specialties`

Returns the admin-verified specialty map.

**Response:** `Record<string, HospitalCategory[]>` — keyed by OSM hospital ID.

Used to overlay verified specialties onto Overpass-sourced hospital data.

### `POST /api/reports`

Submit a hospital data correction report.

**Request body:**
```json
{
  "osmId": "osm-node-12345",
  "hospitalName": "City General Hospital",
  "issueType": "wrong_phone",
  "notes": "Optional additional details"
}
```

**Valid `issueType` values:** `wrong_name`, `wrong_address`, `wrong_phone`, `permanently_closed`, `not_a_hospital`, `wrong_specialty`, `other`

**Response:** `{ "success": true, "id": <number> }` (HTTP 201)

### External: Overpass API (`https://overpass-api.de/api/interpreter`)

The web app calls the public Overpass API directly (same as the mobile app). Query fetches hospitals within 80 km using `[amenity=hospital][emergency=yes/!no]`.

---

## Out of Scope

- Haptic feedback (browser limitation — not supported)
- Push notifications
- Native map app deep-links requiring a native container (Google Maps / Apple Maps / Waze **URLs** still work)
- Admin dashboard (see Task #2 / `artifacts/api-server/src/routes/admin-ui.ts`)
- Any features not already present in the mobile app at time of implementation

---

## Component Inventory

| Component/File | Location | Purpose |
|---|---|---|
| `ConsentGate.tsx` | `src/components/` | First-visit disclaimer gate |
| `HospitalMap.tsx` | `src/components/` | Leaflet map with user + hospital markers |
| `CategoryFilter.tsx` | `src/components/` | Specialty filter pill bar |
| `HospitalCard.tsx` | `src/components/` | Hospital list row |
| `HospitalDetailPanel.tsx` | `src/components/` | Slide-up detail / navigation panel |
| `ReportModal.tsx` | `src/components/` | Report incorrect info form |
| `HospitalContext.tsx` | `src/context/` | Geolocation, hospital data, category state |
| `hospitalService.ts` | `src/services/` | Overpass query, haversine distance, filtering |
| `hospital.ts` | `src/types/` | `Hospital` type and `HospitalCategory` union |
| `Home.tsx` | `src/pages/` | Main page orchestrating map + list |
| `About.tsx` | `src/pages/` | Info / settings page |
| `App.tsx` | `src/` | Root: HospitalProvider + ConsentGate + tab nav |

---

## Changelog

### v1.0.0 — 2026-04-01

**Initial release — web mirror of ER Choices mobile app**

- Registered new `react-vite` artifact at preview path `/web/`
- Implemented consent gate with `localStorage` persistence
- Integrated Leaflet.js (over OpenStreetMap) for interactive hospital map
- Ported Overpass API query and haversine distance logic from mobile app
- Hospital list sorted by distance with name, address, distance, phone
- Specialty filter bar (10 category groups: All, Trauma, Stroke, Cardiac, Pediatric, Obstetrics, Burn, Psychiatric, Cancer, HazMat)
- Hospital detail panel with Google Maps, Apple Maps, and Waze navigation links
- Click-to-call `tel:` links for hospital phone numbers
- "Report incorrect information" modal posting to `/api/reports`
- Info / About page with disclaimer, version, and contact link
- Dark theme matching the mobile app's color palette
- Verified specialty overlay from `/api/specialties`
