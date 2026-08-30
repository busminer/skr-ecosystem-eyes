// Lets a release build be given its own application id on demand, so a signed
// test APK can be sideloaded beside the real app:
//
//   ./gradlew assembleRelease -PskrLabId=true
//
// Off by default, and that default is the whole point. On 30.08.2026 the same
// suffix was sitting unconditionally in the release block as a hand edit inside
// `android/`, and the 1.0.4 store candidate came out as
// `dev.alexkosa.skreyes.lab`. A suffixed APK is not an update of the listed
// app — it is a second app, with a second set of installs and no way back to
// the first. It was caught only because the phone refused to install it over
// the real one.
//
// A hand edit could not be caught by anything, because `android/` is not in the
// repository. That is why this is a plugin: it is written down, it is reviewed,
// and `expo prebuild` cannot take it away.

const { withAppBuildGradle } = require('@expo/config-plugins');

// `release {` appears under signingConfigs as well, so the anchor carries its
// parent with it — the same trap the debug plugin next door documents.
const ANCHOR = `    buildTypes {
        debug {`;

const GATE = `        release {
            if ((findProperty('skrLabId') ?: 'false').toBoolean()) {
                applicationIdSuffix '.lab'
            }`;

module.exports = function withLabAppId(config) {
  return withAppBuildGradle(config, (mod) => {
    const gradle = mod.modResults.contents;
    if (gradle.includes("findProperty('skrLabId')")) return mod;

    // An unconditional suffix is exactly what this plugin exists to prevent, so
    // finding one is a build failure rather than something to quietly repair.
    if (gradle.includes("applicationIdSuffix '.lab'")) {
      throw new Error('withLabAppId: build.gradle already carries an unconditional .lab suffix. Remove it — it would ship to the store as a different app.');
    }

    if (!gradle.includes(ANCHOR)) {
      throw new Error('withLabAppId: the buildTypes block was not found in build.gradle.');
    }

    const release = gradle.indexOf('        release {', gradle.indexOf(ANCHOR));
    if (release === -1) throw new Error('withLabAppId: the release block under buildTypes was not found in build.gradle.');

    mod.modResults.contents = gradle.slice(0, release) + GATE + gradle.slice(release + '        release {'.length);
    return mod;
  });
};
