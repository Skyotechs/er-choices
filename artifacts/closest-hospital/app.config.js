// Native Maps keys belong in the build environment, never in committed config.
module.exports = ({ config }) => {
  const androidMapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY?.trim();
  const isAndroidProductionBuild =
    process.env.EAS_BUILD_PLATFORM === "android" &&
    process.env.EAS_BUILD_PROFILE === "production";

  if (isAndroidProductionBuild && !androidMapsKey) {
    throw new Error(
      "Android production builds require GOOGLE_MAPS_ANDROID_API_KEY. " +
        "Set it in the EAS production environment before rebuilding.",
    );
  }

  return {
    ...config,
    android: {
      ...config.android,
      ...(androidMapsKey
        ? {
            config: {
              ...config.android?.config,
              googleMaps: {
                ...config.android?.config?.googleMaps,
                apiKey: androidMapsKey,
              },
            },
          }
        : {}),
    },
    extra: {
      ...config.extra,
      // Expo strips android.config from the public manifest. Publish only a
      // boolean for the runtime guard, not a duplicate of the actual key.
      androidMapsConfigured: Boolean(androidMapsKey),
    },
  };
};