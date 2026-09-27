// Where the eye-mint service lives.
//
// Production: `https://skr.alexkosa.dev`, the same reviewed HTTPS host as the
// rest of the API; the service sits behind it under `/eye/*`.
//
// Lab build: point this at `http://127.0.0.1:8787` and run `adb reverse
// tcp:8787 tcp:8787`, so the phone talks to its own loopback and the reverse
// carries it across to the PC. The loopback is the one place the app may
// speak plain HTTP (`plugins/withLoopbackCleartext.js`).
export const EYE_BASE_URL = 'https://skr.alexkosa.dev';
