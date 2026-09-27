# The finger: an Eye only a living fingerprint can open and blink

Branch `eye-finger`. Everything here is behind `EYE_FINGER_ENABLED = false` in
`src/eye/config.ts`; with the flag off the app behaves exactly as on `eye-lab`.
Nothing on the VPS has been changed by this branch. This page says what the
phone does, what the attestor instances need, and how the eye-mint server
verifies what the phone sends.

## 1. What the phone does

A P-256 key is born inside the Seeker's StrongBox with three properties the
app cannot fake, because Google's attestation chain states them:

| Property | Set by | Proven by |
|---|---|---|
| lives in StrongBox (TEE fallback) | `setIsStrongBoxBacked(true)` | `attestationSecurityLevel` |
| signs only under a Class 3 biometric, every single time | `setUserAuthenticationRequired(true)`, `setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG)` | hardware-enforced `userAuthType` has the fingerprint bit, no `noAuthRequired`, `authTimeout` absent or 0 |
| dies when a new fingerprint is enrolled | `setInvalidatedByBiometricEnrollment(true)` | `KeyPermanentlyInvalidatedException` on the next use |

The chain also names the device (`solanamobile` / `Seeker`), the bootloader
state, and our package with its signing digest. The attestor reads all of
that; the app only carries the chain across.

### The module, `modules/seeker-witness`

Expo local module (Kotlin + TS, `expo-modules-core`), Android 12+, autolinked
like `skr-share`. Key alias `skr_eyes_witness` (SEEKIN uses `seekin_node`;
the two apps share a phone, never a key).

| Call | Does |
|---|---|
| `hasKey(): Promise<boolean>` | is the alias in AndroidKeyStore |
| `createKey(challengeBase64)` → `{ p256Compressed, chainPem, strongBox, fingerBound }` | deletes any old key, generates a finger-bound key with the challenge baked into the attestation, StrongBox → TEE → TEE without device ids; `p256Compressed` is 33 bytes hex (`02`/`03` + X) |
| `sign(messageBase64, { title, subtitle?, description?, cancel })` → `{ derSignatureBase64 }` | system fingerprint prompt, then one `SHA256withECDSA` signature over the message bytes, DER |
| `deleteKey(): Promise<void>` | removes the alias |
| constants `PACKAGE`, `KEY_ALIAS` | the application id this build runs under (`dev.alexkosa.skreyes` or `.lab`), read from the context |

Every rejection carries a stable `code` (mirrored in `WITNESS_ERROR` in
`index.ts`): `E_WITNESS_UNSUPPORTED`, `E_WITNESS_NO_BIOMETRICS`,
`E_WITNESS_NO_ACTIVITY`, `E_WITNESS_BAD_CHALLENGE`, `E_WITNESS_KEYGEN`,
`E_WITNESS_NO_KEY`, `E_WITNESS_KEY_INVALIDATED`, `E_WITNESS_CANCELLED`,
`E_WITNESS_LOCKOUT`, `E_WITNESS_FAILED`. The prompt uses the framework
`android.hardware.biometrics.BiometricPrompt`, not `androidx.biometric`
(seeker-grabli, build §8). A "Cancel" tap arrives at the negative button's
listener and nowhere else, so the cancel is raised from there.

The module's own `AndroidManifest.xml` declares `android.permission.USE_BIOMETRIC`
(a normal permission, no dialog), which the prompt requires; it merges into
the app manifest through autolinking, so `app.json` and the app's manifest are
untouched. The store's release JSON will list it under `permissions[]`.

### Which attestor (`attestorBaseUrl()` in `src/eye/witness.ts`)

| Build | `PACKAGE` | Signing cert SHA-256 | Attestor |
|---|---|---|---|
| store / `assembleRelease` with the keystore variables | `dev.alexkosa.skreyes` | `d90bb194498ee4dce0669aa5ddcc30c6a13d43750fac4768a240ade9228e4763` | `https://skr.alexkosa.dev/eye/attest` |
| lab / `assembleRelease -PskrLabId=true` | `dev.alexkosa.skreyes.lab` | `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` (debug key) | `https://skr.alexkosa.dev/eye/attest-lab` |

Picked by the module's `PACKAGE` constant: `.lab` goes to the lab attestor,
anything else to production. The release digest was read with `apksigner
verify --print-certs` from `builds\skr-eyes-1.3.0-release.apk` (identical on
1.2.0 and in `HANDOVER.md`); the debug digest from `skr-eyes-1.2.0-lab.apk`.

### Enrollment (`enrollWitness(wallet)`)

1. `GET {attestor}/challenge?wallet=<b58>` → `{ challenge: hex64 }` (32 bytes,
   single use, 10 minutes, bound to the wallet).
2. `createKey(base64(bytes(challenge)))`.
3. `POST {attestor}/verify { wallet, challenge, chain_pem }` → the verdict
   record. On `ok: false` the key is deleted and the reason is shown: the
   challenge is spent and the chain was born for it.
4. The record is kept in AsyncStorage under `skr-eyes:witness:<wallet>`
   (with a `checks` slice for the walkthrough and the raw verdict for step 5).
5. `POST {EYE_BASE_URL}/eye/witness { wallet, record }` with the verdict
   exactly as the attestor returned it. If this fails the record stays saved
   with `registered: false` and is handed over again before the next use
   (`ensureWitness`), without a second key or a second verdict.

### Signing (`witnessSign(bytes, purpose)`)

Shows the prompt with translated words (title "Open your Eye" or "Sign this
Blink") and returns the DER signature. The phone hashes with SHA-256
internally; the server verifies over the message, not over a hash.

### What rides in the requests (`src/eye/finger.ts`, `src/eye/api.ts`)

`EyePanel` calls `witnessBeforeOpen(wallet)` before `/eye/open` and
`witnessBeforeBlink(wallet)` before `/eye/blink`; both are no-ops while the
flag is off. Each one:

1. `ensureWitness(wallet)`: the record on file while `hasKey()` is true,
   otherwise a fresh enrollment; an unregistered record is posted first;
2. `GET {EYE_BASE_URL}/eye/witness/challenge?wallet=<b58>` → `{ challenge }`;
3. the key signs `SKR-EYES|BLINK|1|<wallet b58>|<challenge>` (UTF-8, exactly
   that string) under a finger;
4. the request body becomes `{ wallet, witness: { p256, signature, challenge } }`
   where `signature` is the DER ECDSA signature, base64, and `p256` the
   33-byte compressed key, hex.

A cancelled prompt is treated like a cancelled wallet: nothing is said. A
`KEY_INVALIDATED` (new fingerprint) or `NO_KEY` forgets the record so the
next attempt enrolls again.

### The walkthrough (`src/eye/WitnessWalkthrough.tsx`)

`WitnessWalkthrough({ wallet, onVerified, onCancel })` is the screen the Eyes
tab mounts before the first open when the flag is on and
`getWitnessState(wallet)` says `{ kind: 'none' }` (`'verified'` carries the
record; `'unavailable'` means no module in this build). This branch mounts
nothing itself.

Modelled on SEEKIN's joining screen: an intro with one button (Verify);
then four full-width cards that land 900 ms apart, each with a light haptic
that arrives with the card, each showing the object rather than describing
it: **This is a Seeker** (manufacturer · model as the certificate names
them, how many certificates up to a Google root, verified boot and locked
bootloader), **A key was born in the phone's vault** (the key's fingerprint,
StrongBox/TEE and Finger-bound pills, "It signs only with your finger."),
**Your Seeker Genesis Token** (the mint, found in this wallet), **Device
verified** (the attestor's signature and time). Then **Open my Eye**, which
calls `onVerified(record)` and hands over to the existing open flow, and a
quiet **Not now**. Reduced motion lands everything at once. A phone already
verified shows its cards with "Already verified on this phone." A refusal is
one calm card in the attestor's words: not a Seeker, no fingerprint enrolled,
or the reason it gave, with Try again and Not now.

## 2. What the attestor instances need (VPS, not done by this branch)

SEEKIN's attestor (`C:\seekin\attestor\attestor.py`, deployed at
`https://attestor.alexkosa.dev`) stays exactly as it is. SKR Eyes gets its own
instances of the same file, each with its own key, reverse-proxied under the
API host. The endpoints are SEEKIN's: `GET /attestor`, `GET /challenge?wallet=`,
`POST /verify`.

`attestor.py` routes on exact paths, so the proxy must strip the prefix:
`/eye/attest/challenge` → `127.0.0.1:<port>/challenge`. One instance per
package, because `SEEKIN_PACKAGE` takes one value:

| Instance | Prefix | Env |
|---|---|---|
| production | `/eye/attest` | `SEEKIN_PACKAGE=dev.alexkosa.skreyes` `SEEKIN_APK_DIGESTS=d90bb194498ee4dce0669aa5ddcc30c6a13d43750fac4768a240ade9228e4763` `SEEKIN_ATTESTOR_KEY=/etc/skreyes/attestor.json` `SEEKIN_REQUIRE_FINGER=1` `SEEKIN_RPC=https://api.mainnet-beta.solana.com` `SEEKIN_BIND=127.0.0.1` |
| lab | `/eye/attest-lab` | `SEEKIN_PACKAGE=dev.alexkosa.skreyes.lab` `SEEKIN_APK_DIGESTS=fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` `SEEKIN_ATTESTOR_KEY=/etc/skreyes/attestor-lab.json` (a **different** key), the rest as above |

Each instance writes its own `store/<p256>.json`. `curl {base}/attestor`
prints the instance's pubkey and package; the eye-mint server pins those two
pubkeys (§3.1).

Why the lab instance must sign with a different key: `fac61745…` is the
React Native template's debug keystore, public and shared by every RN project
on earth. Anyone can sign an APK named `dev.alexkosa.skreyes.lab` with it.
Such an app still cannot fake a Seeker, a StrongBox or a finger (Google's
chain, not the app, states those), but its verdicts must never count as
production Eyes. A separate key makes the two kinds of verdict impossible to
confuse; `record.checks.packages` says the same thing a second time.

If one instance for both packages is preferred instead, `attestor.py` needs
`SEEKIN_PACKAGE` to become a set (three lines: parse a comma list, test with
`set(checks["packages"]) & PACKAGES`, print the list in `/attestor`), and then
the pairing between package and digest is lost: the production package with
the debug digest would pass. Two instances avoid that.

The verdict's message prefix stays `SEEKIN|ATTEST|1|`; because these
instances sign with keys that are not `GZby31…`, SEEKIN's on-chain program
would refuse them in a JOIN, so SEEKIN is unaffected.

## 3. What the eye-mint server must do

Four things. No new dependency beyond `node:crypto` and a base58 decoder.

### 3.1 `POST /eye/witness { wallet, record }` — bind the key to the wallet

`record` is the attestor's `/verify` answer as it came:

```json
{
  "ok": true, "wallet": "b58", "p256": "02…33 bytes hex",
  "sgt_mint": "b58", "sgt_token_account": "b58",
  "attestation_hash": "hex32", "flags": 15,
  "attestor": "b58 ed25519", "attestor_sig": "hex64",
  "verified_at": "2026-…Z",
  "checks": { "securityLevel": "StrongBox", "brand": "solanamobile", "model": "Seeker",
              "deviceLocked": true, "verifiedBootState": "Verified", "fingerBound": true,
              "packages": ["dev.alexkosa.skreyes"], "signatureDigests": ["d90b…"], "chain_length": 5, "…": "…" }
}
```

`flags`: bit0 StrongBox, bit1 device locked, bit2 verified boot, bit3
finger-bound. `attestor_sig` is ed25519 over
`"SEEKIN|ATTEST|1|" ‖ p256(33) ‖ wallet(32) ‖ sgt_mint(32) ‖ attestation_hash(32) ‖ flags(1)`.

```js
import { createPublicKey, verify } from 'node:crypto';
import bs58 from 'bs58';

// From `GET /eye/attest/attestor` and `GET /eye/attest-lab/attestor`, pinned.
const ATTESTORS = { '<production pubkey b58>': 'production', '<lab pubkey b58>': 'lab' };
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');
const FLAG_STRONGBOX = 1, FLAG_LOCKED = 2, FLAG_VERIFIED = 4, FLAG_FINGER = 8;

export function verifyRecord(wallet, r) {
  if (r.ok !== true || r.wallet !== wallet) return null;
  const tier = ATTESTORS[r.attestor];
  if (!tier) return null;
  const required = FLAG_FINGER | FLAG_LOCKED | FLAG_VERIFIED;        // add FLAG_STRONGBOX to refuse TEE keys
  if ((r.flags & required) !== required) return null;
  const message = Buffer.concat([
    Buffer.from('SEEKIN|ATTEST|1|'),
    Buffer.from(r.p256, 'hex'),                 // 33
    bs58.decode(wallet),                        // 32
    bs58.decode(r.sgt_mint),                    // 32
    Buffer.from(r.attestation_hash, 'hex'),     // 32
    Buffer.from([r.flags]),                     // 1
  ]);
  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI, bs58.decode(r.attestor)]), format: 'der', type: 'spki' });
  if (!verify(null, message, key, Buffer.from(r.attestor_sig, 'hex'))) return null;
  return { tier, p256: r.p256.toLowerCase(), sgtMint: r.sgt_mint, verifiedAt: r.verified_at, packages: r.checks?.packages ?? [] };
}
```

On success store `wallet → { p256, sgt_mint, tier, verified_at, bound_at }`
and answer 200. Policy that falls out naturally:

- **One key per Seeker.** `sgt_mint` is the physical phone. Refuse (or flag)
  a second wallet binding a key attested against an SGT already bound to
  another wallet; this is the anti-Sybil rule for Eyes.
- **Lab is lab.** `tier === 'lab'` (equivalently `packages` contains `.lab`)
  never counts as a production Eye: test data, separate rows.
- **Re-binding** happens when a new fingerprint kills the key: the phone
  enrolls again and posts a new record with a newer `verified_at`. Accept it,
  keep the old row as history. Refuse a record older than the one on file.
- **Idempotent.** The phone re-posts the same record when a previous post
  failed; the same `attestation_hash` for the same wallet is a 200, not a
  duplicate.
- The verdict never expires on its own; the attestor keeps the chain under
  its `store/<p256>.json` for audit.

### 3.2 `GET /eye/witness/challenge?wallet=<b58>`

32 random bytes as hex. Remember `(challenge → wallet, issuedAt)`; single use,
ten minutes, popped by the first `/eye/open` or `/eye/blink` that presents it.
Refuse a proof whose challenge is unknown, expired, or was issued for another
wallet.

### 3.3 Verifying the proof on `/eye/open` and `/eye/blink`

`witness: { p256, signature, challenge }`. Message: `SKR-EYES|BLINK|1|<wallet>|<challenge>`
as UTF-8. Signature: DER ECDSA over that message with SHA-256, base64. The
phone does not normalise S, so about half of all signatures arrive high-S;
**normalise, do not reject**, or every second touch would bounce. A fresh
challenge per request makes malleability harmless, and the normalised
`r ‖ s` is exactly what the `Secp256r1SigVerify` precompile would take if a
Blink is ever put on chain.

Tested end to end with a Node-simulated key (200 signatures, all verify,
tampered wallet refused):

```js
import { createPublicKey, verify } from 'node:crypto';

const P256_SPKI = Buffer.from('3039301306072a8648ce3d020106082a8648ce3d030107032200', 'hex');
const N = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');

function p256PublicKey(compressedHex) {
  const point = Buffer.from(compressedHex, 'hex');
  if (point.length !== 33 || (point[0] !== 2 && point[0] !== 3)) throw new Error('bad p256');
  return createPublicKey({ key: Buffer.concat([P256_SPKI, point]), format: 'der', type: 'spki' });
}

// SEQUENCE { INTEGER r, INTEGER s } -> two 32-byte buffers
function derToRaw(der) {
  let i = 0;
  if (der[i++] !== 0x30) throw new Error('not DER');
  let len = der[i++];
  if (len & 0x80) { const n = len & 0x7f; len = 0; for (let k = 0; k < n; k++) len = (len << 8) | der[i++]; }
  if (i + len !== der.length) throw new Error('DER length');
  const int = () => {
    if (der[i++] !== 0x02) throw new Error('not INTEGER');
    const l = der[i++]; let v = der.subarray(i, i + l); i += l;
    while (v.length > 32 && v[0] === 0) v = v.subarray(1);
    if (v.length > 32) throw new Error('INTEGER too long');
    return Buffer.concat([Buffer.alloc(32 - v.length), v]);
  };
  const r = int(), s = int();
  if (i !== der.length) throw new Error('trailing bytes');
  return { r, s };
}

function lowS(s) {
  const v = BigInt('0x' + s.toString('hex'));
  return v <= N / 2n ? s : Buffer.from((N - v).toString(16).padStart(64, '0'), 'hex');
}

export function verifyProof({ wallet, challenge, p256, signature }) {
  const message = Buffer.from(`SKR-EYES|BLINK|1|${wallet}|${challenge}`, 'utf8');
  const { r, s } = derToRaw(Buffer.from(signature, 'base64'));
  return verify('sha256', message, { key: p256PublicKey(p256), dsaEncoding: 'ieee-p1363' }, Buffer.concat([r, lowS(s)]));
}
```

Order of checks on `/eye/open` and `/eye/blink` with a `witness`:

1. challenge known, unexpired, issued for `wallet`; pop it;
2. `witness.p256` equals the key bound to `wallet` by §3.1 (no binding: 4xx
   that tells the phone to enroll; the phone's `ensureWitness` will re-post an
   unregistered record on its own, but a wallet the server has never seen
   needs the walkthrough);
3. `verifyProof(...)`;
4. only then build the transaction as today.

Python equivalent, if the server side prefers it: `cryptography`'s
`ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), bytes.fromhex(p256))`,
`decode_dss_signature` → `(r, s)`, `s = n - s if s > n // 2`, then
`.verify(encode_dss_signature(r, s), message, ec.ECDSA(hashes.SHA256()))`.

## 4. Test plan on a Seeker (not run: the phone is on release duty)

Lab attestor live at `/eye/attest-lab`, eye-mint server with §3,
`EYE_FINGER_ENABLED = true`, the lab APK from this branch on the phone
(`android/app/build/outputs/apk/release/app-release.apk`, package
`dev.alexkosa.skreyes.lab`, debug-signed; `adb reverse tcp:8787 tcp:8787` for
the eye-mint server as before).

1. **Walkthrough.** Connect the wallet; the Eyes tab mounts the walkthrough
   (`getWitnessState` → `none`). Verify: no fingerprint prompt yet, key
   generation needs none. Expect the lab attestor log `VERIFIED … StrongBox
   Seeker`, `flags` 15, `checks.fingerBound: true`, `checks.packages:
   ["dev.alexkosa.skreyes.lab"]`; the server log shows `/eye/witness` bound.
   Four cards land ~0.9 s apart with a light buzz each; "Solana Mobile Inc. ·
   Seeker", "5 certificates, up to a Google root", the key fingerprint, the
   SGT mint, the attestor's signature and time. Switch language, reopen: the
   words follow.
2. **Open.** Open my Eye: fingerprint prompt titled "Open your Eye", then the
   wallet. Server log: challenge popped, proof verified.
3. **Blink.** Same, titled "Sign this Blink".
4. **Cancel** the prompt: no red line, the panel returns to rest.
5. **Lockout:** five wrong fingers, expect the lockout sentence.
6. **New fingerprint:** enroll another finger in Settings, Blink: expect the
   "key was reset" sentence once; the next open or Blink enrolls again (lab
   attestor shows a second `VERIFIED` for the wallet with a new `p256`), the
   server accepts the re-bind.
7. **Reinstall** the APK (the key survives, the record does not): the
   walkthrough appears again and enrolls again rather than failing.
8. **Emulator** or another Android: the walkthrough shows "This phone is not
   a Seeker" with the attestor's reason under it.
9. **Server down:** kill the eye-mint server after the attestor said yes:
   the walkthrough fails with the service message; restart the server, Verify
   again: no second attestor call, the saved record is posted and the cards
   land.
10. Turn the flag off, rebuild, confirm the open and blink bodies are
    `{ wallet }` again (server log).

## 5. Untested and open

- The Kotlin module has been compiled, not run: no key has been born or
  signed through it yet. The BiometricPrompt path in particular (cancel via
  the negative button, lockout codes, `KeyPermanentlyInvalidatedException`
  on the second finger) needs the phone.
- The `PACKAGE` constant is read from the react context at first access;
  if it ever came back empty the build would talk to the production attestor
  and be refused by package, which is the safe direction.
- Neither attestor instance nor the `/eye/witness` and `/eye/witness/challenge`
  endpoints exist yet; the phone code is written against the contract above.
- The walkthrough's layout has not been seen on a 400 dp Seeker screen.
- Whether SEEKIN's own `Biometric.kt` settles its coroutine on a "Cancel"
  tap: it passes an empty negative-button listener and waits for
  `onAuthenticationError`, which the framework does not send for that button
  as far as the AOSP source reads. Worth one tap on a Seeker.
