// Builds native code for arm64 only.
//
// This app is distributed through the Solana dApp Store and the Solana dApp
// Store exists on the Seeker, which is arm64. The other three architectures
// React Native builds by default are 54 MB of code that no device receiving
// this app can execute — they took the released APK from 42 MB to 96 MB.
//
// Verified rather than assumed: the published 1.0.1 sitting on the phone
// contains lib/arm64-v8a and nothing else, so this restores what that build
// had rather than introducing a new restriction.
//
// Like the other plugins beside it this cannot be a hand edit inside android/,
// because `expo prebuild` throws that folder away and writes it again — which
// is exactly how the setting went missing in the first place.

const { withGradleProperties } = require('@expo/config-plugins');

const KEY = 'reactNativeArchitectures';
const VALUE = 'arm64-v8a';

module.exports = function withArm64Only(config) {
  return withGradleProperties(config, (mod) => {
    const properties = mod.modResults.filter(
      (item) => !(item.type === 'property' && item.key === KEY),
    );

    properties.push({
      type: 'comment',
      value: 'Seeker is arm64. The other architectures are dead weight this app can never run on.',
    });
    properties.push({ type: 'property', key: KEY, value: VALUE });

    mod.modResults = properties;
    return mod;
  });
};
