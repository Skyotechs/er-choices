---
name: Android Maps release safety
description: Native Android map behavior when an Android Google Maps key is absent.
---

Do not initialize the native Android map in a standalone build unless the Android Google Maps API key has been supplied through the app configuration.

**Why:** Android release builds can display a blank map or crash when the Google Maps native SDK starts without an API key. The hospital list is more valuable than a failing map, so it must remain usable while the key is being configured.

**How to apply:** Gate the native map behind the configured key and use a clear non-map fallback. Before restoring the interactive map, add the key through the secure build configuration and validate a signed Android release on a real device.