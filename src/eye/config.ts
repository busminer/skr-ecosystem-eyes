// Where the eye-mint service lives.
//
// Lab build: the phone reaches the PC over USB (`adb reverse tcp:8787
// tcp:8787`), so the app talks to its own loopback and the reverse carries it
// across. Production will be `https://skr.alexkosa.dev`, behind the same
// reviewed HTTPS host as the rest of the API.
export const EYE_BASE_URL = 'http://127.0.0.1:8787';
