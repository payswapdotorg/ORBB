/**
 * ORBB health-platform Expo config plugin (M4-C seam — TEXT-ONLY surface).
 *
 * Registers the native health-platform surface the device-source seams
 * (A34 HealthKit / A35 Health Connect, `@orbb/platform` health seam)
 * require at PREBUILD time — declarations only, no native bindings:
 *
 *   iOS (Info.plist + entitlements):
 *     - NSHealthShareUsageDescription — why ORBB reads from Apple Health.
 *     - NSHealthUpdateUsageDescription — reserved for future measurement-
 *       plan scheduling (ORBB does not write to HealthKit in this
 *       milestone); the description is declared now so the permission
 *       surface is complete and reviewable.
 *     - com.apple.developer.healthkit entitlement.
 *
 *   Android (AndroidManifest.xml):
 *     - The Health Connect read permissions for the supported metric set
 *       (heart rate, steps, sleep — units per the Health Connect docs).
 *     - The Health Connect permissions intent action declaration.
 *
 * The actual native modules (HealthKit native binding, Health Connect
 * client) are a deployment/mobile-integration milestone concern — handoff
 * recorded in the M4-C packet report. This plugin is ESM (.mjs) so it is
 * loadable by the Expo CLI plugin resolver and stays outside the app
 * logic (Lane B owns app screens).
 */
import { withAndroidManifest, withEntitlementsPlist, withInfoPlist } from "expo/config-plugins.js";

/** Info.plist usage descriptions (App Store review text — no PHI). */
export const IOS_HEALTH_USAGE_DESCRIPTIONS = {
  NSHealthShareUsageDescription:
    "ORBB reads heart rate, step count, and sleep measurements you choose to share from Apple Health to create measurement observations with full provenance.",
  NSHealthUpdateUsageDescription:
    "ORBB may write measurements you record back to Apple Health when you enable a measurement plan. Nothing is shared without your explicit choice.",
};

/** Health Connect read permissions for the supported metric set. */
export const ANDROID_HEALTH_CONNECT_PERMISSIONS = [
  "android.permission.health.READ_HEART_RATE",
  "android.permission.health.READ_STEPS",
  "android.permission.health.READ_SLEEP",
];

/** Health Connect permissions intent action (manifest declaration). */
const HEALTH_CONNECT_INTENT_ACTION = "androidx.health.ACTION_SHOW_PERMISSIONS_REQUEST";

/** Adds the HealthKit entitlement on iOS (TEXT ONLY). */
function withHealthKitEntitlements(config) {
  return withEntitlementsPlist(config, (entitlementsConfig) => {
    entitlementsConfig.modResults["com.apple.developer.healthkit"] = true;
    return entitlementsConfig;
  });
}

/** Writes the Info.plist usage descriptions (TEXT ONLY). */
function withHealthUsageDescriptions(config) {
  return withInfoPlist(config, (infoPlistConfig) => {
    const modResults = infoPlistConfig.modResults;
    for (const [key, value] of Object.entries(IOS_HEALTH_USAGE_DESCRIPTIONS)) {
      modResults[key] = value;
    }
    return infoPlistConfig;
  });
}

/**
 * Declares the Health Connect permissions + permissions intent in the
 * Android manifest (TEXT ONLY). Idempotent: already-declared permissions
 * are not duplicated.
 */
function withHealthConnectManifest(config) {
  return withAndroidManifest(config, (manifestConfig) => {
    const manifest = manifestConfig.modResults;
    const existing = manifest["uses-permission"] ?? [];
    const declared = new Set(
      existing.map((entry) => (typeof entry === "object" && entry !== null ? entry["android:name"] : undefined)),
    );
    for (const name of ANDROID_HEALTH_CONNECT_PERMISSIONS) {
      if (!declared.has(name)) {
        existing.push({ "android:name": name });
        declared.add(name);
      }
    }
    manifest["uses-permission"] = existing;

    const application = Array.isArray(manifest["application"]) ? [...manifest["application"]] : [{}];
    const first = application[0] ?? {};
    const activities = Array.isArray(first["activity"]) ? [...first["activity"]] : [];
    activities.push({
      $: {
        "android:name":
          "androidx.health.connect.client.permission.HealthDataRequestPermissionsActivity",
        "android:exported": "true",
      },
      "intent-filter": [
        {
          action: [{ $: { "android:name": HEALTH_CONNECT_INTENT_ACTION } }],
        },
      ],
    });
    first["activity"] = activities;
    application[0] = first;
    manifest["application"] = application;
    return manifestConfig;
  });
}

/** The ORBB health config plugin (composable — every modifier is TEXT ONLY). */
function withOrbbHealth(config) {
  return withHealthConnectManifest(
    withHealthUsageDescriptions(withHealthKitEntitlements(config)),
  );
}

export default withOrbbHealth;
