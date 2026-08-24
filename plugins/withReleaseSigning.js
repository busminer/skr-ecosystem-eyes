// Teaches the generated Android project to sign release builds with our own
// key, read from four environment variables at build time.
//
// It lives here as a config plugin rather than as a hand edit inside
// `android/`, because `expo prebuild` throws that folder away and writes it
// again. A hand edit survives until the next prebuild and then quietly
// disappears — and an APK signed with the sample debug key is rejected by the
// store, or worse, published under a key nobody controls.
//
// The key itself never enters the repository. Gradle reads:
//
//   SKR_EYES_KEYSTORE_PATH      absolute path to skr-eyes-release.jks
//   SKR_EYES_KEYSTORE_PASSWORD  store password
//   SKR_EYES_KEY_ALIAS          skr-eyes-release
//   SKR_EYES_KEY_PASSWORD       key password
//
// When they are missing the build still works, so ordinary development is not
// blocked, but it falls back to the debug key and says so loudly. The final
// check is never the log line: it is `apksigner verify --print-certs` against
// the fingerprint recorded in skr-keys/READ-ME-FIRST.txt.

const { withAppBuildGradle } = require('@expo/config-plugins');

const RELEASE_CONFIG = `
        release {
            def keystorePath = System.getenv("SKR_EYES_KEYSTORE_PATH")
            if (keystorePath != null && !keystorePath.isEmpty() && file(keystorePath).exists()) {
                storeFile file(keystorePath)
                storePassword System.getenv("SKR_EYES_KEYSTORE_PASSWORD")
                keyAlias System.getenv("SKR_EYES_KEY_ALIAS")
                keyPassword System.getenv("SKR_EYES_KEY_PASSWORD")
            } else {
                logger.warn("SKR EYES: no release keystore in the environment — this build is signed with the DEBUG key and the store will reject it.")
                storeFile file('debug.keystore')
                storePassword 'android'
                keyAlias 'androiddebugkey'
                keyPassword 'android'
            }
        }`;

const ANCHOR = `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (modified) => {
    let contents = modified.modResults.contents;

    if (!contents.includes(ANCHOR)) {
      throw new Error('withReleaseSigning: the debug signingConfig block was not found, so the release block has nowhere to go.');
    }
    if (!contents.includes('SKR_EYES_KEYSTORE_PATH')) {
      contents = contents.replace(ANCHOR, ANCHOR + RELEASE_CONFIG);
    }

    contents = contents.replace(
      /(release \{\s*\n\s*\/\/ Caution![\s\S]*?)signingConfig signingConfigs\.debug/,
      '$1signingConfig signingConfigs.release',
    );

    modified.modResults.contents = contents;
    return modified;
  });
};
