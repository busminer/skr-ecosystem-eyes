// Gives debug builds their own application id, so a development build installs
// beside the store build instead of on top of it.
//
// Without this the two share `dev.alexkosa.skreyes`. They cannot actually
// replace each other — the store build is signed with the release key and a
// development build is not — so the install simply fails. The failure is the
// good case. The bad case is a machine that does hold the release key, where
// the install succeeds and a half-finished build silently becomes the app on
// the phone, taking the stored session and the armed unlock alerts with it.
//
// Like the signing plugin next to it, this lives here rather than as a hand
// edit inside `android/`, because `expo prebuild` throws that folder away and
// writes it again.

const { withAppBuildGradle } = require('@expo/config-plugins');

// There are two blocks named `debug` in this file — one under signingConfigs
// and one under buildTypes — so the anchor has to carry its parent with it.
// Matching on `debug {` alone rewrites the signing block instead and the build
// then fails somewhere else entirely.
const ANCHOR = `    buildTypes {
        debug {`;

const PATCHED = `    buildTypes {
        debug {
            applicationIdSuffix '.dev'`;

module.exports = function withDebugAppId(config) {
  return withAppBuildGradle(config, (mod) => {
    const gradle = mod.modResults.contents;
    if (gradle.includes("applicationIdSuffix '.dev'")) return mod;

    if (!gradle.includes(ANCHOR)) {
      throw new Error('withDebugAppId: the debug block under buildTypes was not found in build.gradle.');
    }

    mod.modResults.contents = gradle.replace(ANCHOR, PATCHED);
    return mod;
  });
};
