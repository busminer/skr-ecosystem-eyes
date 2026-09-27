// Lets the app talk plain HTTP to the phone's own loopback, and to nothing
// else. The lab build reaches the eye-mint service on the PC it is plugged
// into through `adb reverse tcp:8787 tcp:8787`, which the app sees as
// `http://127.0.0.1:8787`; a release build blocks cleartext by default and
// would refuse it without a word.
//
// Scoped to `127.0.0.1` and `localhost` on purpose. Everything the app says to
// any real host stays HTTPS-only exactly as the platform has it.
//
// `android/` is not in the repository, so the same two changes are also made by
// hand in there for the build; this file is the written-down copy that a
// review can see and that `expo prebuild` would reproduce.

const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const CONFIG_NAME = 'network_security_config';

const XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- Lab build: the phone reaches the eye-mint service on the PC over
     \`adb reverse\`, so plain HTTP is allowed for the loopback names and for
     nothing else. Every other host keeps the platform default, HTTPS only. -->
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">127.0.0.1</domain>
        <domain includeSubdomains="false">localhost</domain>
    </domain-config>
</network-security-config>
`;

module.exports = function withLoopbackCleartext(config) {
  config = withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.$['android:networkSecurityConfig'] = `@xml/${CONFIG_NAME}`;
    return mod;
  });

  return withDangerousMod(config, ['android', async (mod) => {
    const dir = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${CONFIG_NAME}.xml`), XML);
    return mod;
  }]);
};
