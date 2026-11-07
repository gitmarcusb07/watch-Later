/**
 * Ships both 32-bit and 64-bit Android native libraries.
 *
 * The generated `android/gradle.properties` defaults to every ABI, but this
 * project previously pinned `reactNativeArchitectures=arm64-v8a` to shrink a
 * direct-download APK. That produces a 64-bit-only app, which cannot install
 * on 32-bit ARM devices.
 *
 * This plugin runs during `expo prebuild` (local builds and EAS cloud builds)
 * and pins the ABIs we actually ship:
 *   - armeabi-v7a : 32-bit ARM phones
 *   - arm64-v8a   : 64-bit ARM phones (required by Google Play)
 *   - x86_64      : 64-bit Android emulators
 *
 * A Google Play App Bundle splits these per device, so users only download the
 * ABI their phone needs. A directly shared universal APK contains both.
 */
const { withGradleProperties } = require('@expo/config-plugins');

const PROPERTY = 'reactNativeArchitectures';
const VALUE = 'armeabi-v7a,arm64-v8a,x86_64';

module.exports = function withAllArchitectures(config) {
  return withGradleProperties(config, (config) => {
    const properties = config.modResults;
    const existing = properties.find(
      (item) => item.type === 'property' && item.key === PROPERTY,
    );

    if (existing) {
      existing.value = VALUE;
    } else {
      properties.push({ type: 'property', key: PROPERTY, value: VALUE });
    }

    return config;
  });
};
