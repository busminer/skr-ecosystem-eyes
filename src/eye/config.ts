// Where the eye-mint service lives.
//
// Lab build: the phone reaches the PC over USB (`adb reverse tcp:8787
// tcp:8787`), so the app talks to its own loopback and the reverse carries it
// across. Production will be `https://skr.alexkosa.dev`, behind the same
// reviewed HTTPS host as the rest of the API.
export const EYE_BASE_URL = 'http://127.0.0.1:8787';

// The attestor that reads Google's key-attestation chain and says whether the
// key was born in a real Seeker's StrongBox, under a fingerprint, inside our
// APK. SKR Eyes has its own instance of SEEKIN's attestor, on the same
// reviewed host as the API, with its own key. The endpoints are SEEKIN's:
// `GET {base}/attestor`, `GET {base}/challenge?wallet=`, `POST {base}/verify`
// (docs/FINGER.md).
//
// Two of them, because the attestor checks the package name and the signing
// certificate that Google's chain names, and a sideloaded test build has
// neither the store's package nor the store's key: `-PskrLabId=true` gives
// `dev.alexkosa.skreyes.lab`, signed with the debug key. The lab attestor
// accepts that pair; the production one never will. The build picks by its
// own package (src/eye/witness.ts).
export const ATTESTOR_BASE_URL = 'https://skr.alexkosa.dev/eye/attest';
export const ATTESTOR_LAB_BASE_URL = 'https://skr.alexkosa.dev/eye/attest-lab';
export const LAB_PACKAGE = 'dev.alexkosa.skreyes.lab';

// The finger. When on, the Eye is enrolled with the attestor before it is
// first opened, and every open and every Blink carries a signature from the
// StrongBox key that only a living fingerprint can use (src/eye/finger.ts).
// Off until the attestor and the eye-mint endpoints are live.
export const EYE_FINGER_ENABLED = false;
