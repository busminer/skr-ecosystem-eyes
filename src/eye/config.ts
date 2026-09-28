// Where the eye-mint service lives.
//
// Production: `https://skr.alexkosa.dev`, the same reviewed HTTPS host as the
// rest of the API; the service sits behind it under `/eye/*`.
//
// Lab build (`-PskrLabId=true`, package `dev.alexkosa.skreyes.lab`): a second,
// disposable eye-mint environment on the same host under `/eye-lab/*`, with its
// own throwaway collection and ledger, so testing never touches the real
// collection and can be wiped before launch. The build picks by its own
// package, read from the witness module (the only native module that knows
// the applicationId at runtime).
import { getSeekerWitness } from '../../modules/seeker-witness';

export const LAB_PACKAGE = 'dev.alexkosa.skreyes.lab';
export const IS_LAB_BUILD = getSeekerWitness()?.PACKAGE === LAB_PACKAGE;
export const EYE_BASE_URL = IS_LAB_BUILD ? 'https://skr.alexkosa.dev/eye-lab' : 'https://skr.alexkosa.dev';

// The attestor that reads Google's key-attestation chain and says whether the
// key was born in a real Seeker's StrongBox, under a fingerprint, inside our
// APK. SKR Eyes runs its own attestor inside the eye-mint service, one per
// environment, each with its own key: the production one accepts only the
// store package and the store signing certificate, the lab one only the lab
// package and the debug certificate. Endpoints (docs/FINGER.md):
// `GET {base}/attestor`, `GET {base}/challenge?wallet=`, `POST {base}/verify`.
export const ATTESTOR_BASE_URL = `${EYE_BASE_URL}/eye/attest`;
export const ATTESTOR_LAB_BASE_URL = ATTESTOR_BASE_URL;

// The finger. When on, the Eye is enrolled with the attestor before it is
// first opened, and every open and every Blink carries a signature from the
// StrongBox key that only a living fingerprint can use (src/eye/finger.ts).
// On in the lab build first (27.09); the lab proved it on Alex's Seekers on
// 27-28.09, so the store build carries it too from 2.0 (the server answers
// with EYE_REQUIRE_FINGER=1 in production).
export const EYE_FINGER_ENABLED = true;
