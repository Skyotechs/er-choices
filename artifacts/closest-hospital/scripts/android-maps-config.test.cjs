const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
// Non-credential value used only to exercise Expo config resolution.
const testKey = "android-maps-config-test-placeholder";

function resolveConfig({ key, platform, profile, publicConfig = false } = {}) {
  const env = { ...process.env };
  delete env.GOOGLE_MAPS_ANDROID_API_KEY;
  delete env.EAS_BUILD_PLATFORM;
  delete env.EAS_BUILD_PROFILE;
  if (key !== undefined) env.GOOGLE_MAPS_ANDROID_API_KEY = key;
  if (platform) env.EAS_BUILD_PLATFORM = platform;
  if (profile) env.EAS_BUILD_PROFILE = profile;
  return spawnSync(
    process.execPath,
    [
      "-e",
      `const { getConfig } = require("expo/config");
       try {
         const { exp } = getConfig(process.cwd(), { isPublicConfig: ${publicConfig} });
         process.stdout.write(JSON.stringify(exp));
       } catch (error) {
         process.stderr.write(error.message);
         process.exit(1);
       }`,
    ],
    { cwd: root, env, encoding: "utf8" },
  );
}

test("development without a key keeps the safe map fallback", () => {
  const result = resolveConfig();
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.extra.androidMapsConfigured, false);
  assert.equal(config.android.config?.googleMaps?.apiKey, undefined);
  assert.equal(config.android.package, "com.erchooser.app");
  assert.ok(config.extra.eas.projectId);
});

test("production Android injects the native key without exposing it in public config", () => {
  const options = { key: testKey, platform: "android", profile: "production" };
  const nativeResult = resolveConfig(options);
  assert.equal(nativeResult.status, 0, nativeResult.stderr);
  const nativeConfig = JSON.parse(nativeResult.stdout);
  assert.equal(nativeConfig.android.config.googleMaps.apiKey, testKey);
  const publicResult = resolveConfig({ ...options, publicConfig: true });
  assert.equal(publicResult.status, 0, publicResult.stderr);
  const publicConfig = JSON.parse(publicResult.stdout);
  assert.equal(publicConfig.extra.androidMapsConfigured, true);
  assert.equal(publicConfig.android.config, undefined);
  assert.equal(publicResult.stdout.includes(testKey), false);
  assert.equal(publicConfig.ios.bundleIdentifier, "com.erchooser.app");
});

test("production Android rejects missing and blank keys", () => {
  for (const key of [undefined, "   "]) {
    const result = resolveConfig({ key, platform: "android", profile: "production" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /require GOOGLE_MAPS_ANDROID_API_KEY/);
  }
});

test("production iOS remains buildable without the Android key", () => {
  const result = resolveConfig({ platform: "ios", profile: "production" });
  assert.equal(result.status, 0, result.stderr);
});