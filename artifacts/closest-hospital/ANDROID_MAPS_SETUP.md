# Android live map release checklist

The native Android map requires a Google Maps Platform key. Keep the value out
of source control, app.json, chat, and screenshots.

## Google Cloud configuration

1. Enable **Maps SDK for Android** on your Google Cloud project and ensure
   the project's billing is active.
2. Create an API key restricted to **Android apps**.
3. Add package name **com.erchooser.app** with the **Google Play app signing
   certificate SHA-1** from Play Console → App integrity → App signing.
   This is not necessarily the upload certificate.
4. For testing an EAS-signed APK directly, also allow the EAS Android signing
   certificate SHA-1 with the same package name.
5. Restrict the key's API access to **Maps SDK for Android**.

## Build environment

In the ER Choices project on expo.dev, open Environment variables and add:

- Name: `GOOGLE_MAPS_ANDROID_API_KEY`
- Environment: `production`
- Visibility: `Sensitive` (available during local EAS config resolution and
  masked in build logs)

The production profile explicitly selects this environment. Replit Secrets
are separate from EAS environment variables: a key saved in Replit alone does
not provision a remote EAS build. For local configuration validation, use the
same name in Replit Secrets.

The dynamic Expo config injects the key into Android native configuration.
Only a key-present boolean is published to the runtime manifest. Google Maps
keys are embedded in the native binary, so Android package/certificate and API
restrictions remain essential even when the build environment stores them securely.

## Verification before Play resubmission

Run from this directory:

```sh
pnpm run typecheck
pnpm run test:android-maps-config
```

Configuration tests use a dummy value and do not verify a real key's Google
Cloud permissions or render the native map.

After the real key is configured, build the Android release using the
production profile. Missing keys block production Android builds; development
builds without a key still show the safe map fallback. Expo Go uses its own map
configuration and is not proof that a standalone release is correctly configured.

Verify a Play-installed internal-track build on an Android device: accept
consent, allow location, confirm Google map tiles and hospital pins load, tap
a hospital pin, and confirm the list remains usable. Also verify denied
location and retry. Review Android logs and Google Play's pre-launch report
before submitting for review.