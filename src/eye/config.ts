// Where the eye-mint service lives.
//
// Lab build: the phone reaches the PC over USB (`adb reverse tcp:8787
// tcp:8787`), so the app talks to its own loopback and the reverse carries it
// across. Production will be `https://skr.alexkosa.dev`, behind the same
// reviewed HTTPS host as the rest of the API.
export const EYE_BASE_URL = 'http://127.0.0.1:8787';

// The attestor that reads Google's key-attestation chain and says whether the
// key was born in a real Seeker's StrongBox, under a fingerprint, inside our
// APK. SEEKIN's service; it must be told to accept this app's package and
// signing digest before it will say yes to us (docs/FINGER.md).
export const ATTESTOR_BASE_URL = 'https://attestor.alexkosa.dev';

// The finger. When on, the Eye is enrolled with the attestor before it is
// first opened, and every Blink carries a signature from the StrongBox key
// that only a living fingerprint can use (src/eye/finger.ts). Off until the
// attestor accepts this package and the eye-mint server verifies the proof.
export const EYE_FINGER_ENABLED = false;
