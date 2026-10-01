---
name: Android Maps release safety
description: Native Android map behavior when an Android Google Maps key is absent.
---

Do not initialize the native Android map in a standalone build unless the Android Google Maps API key has been supplied through the app configuration.

**Why:** Android release builds can display a blank map or crash when the Google Maps native SDK starts without an API key. The hospital list is more valuable than a failing map, so it must remain usable while the key is being configured.

**How to apply:** Gate the native map behind the configured key and use a clear non-map fallback. Before restoring the interactive map, add the key through the secure build configuration and validate a signed Android release on a real device.

Do not infer native map readiness from the presence of a key in Expo's public
runtime configuration.

**Why:** Expo removes `android.config` from the public manifest. Reading its
key at runtime incorrectly disables a properly configured native map. Expo Go
also uses its own native Maps configuration, so preview success is not evidence
that a signed release is configured correctly.

**How to apply:** Use a non-sensitive build-time availability flag for the
standalone runtime guard, keep the actual key in native build configuration,
and verify a Play-installed build with the Google Play app signing certificate
allowed by the key's Android restrictions.