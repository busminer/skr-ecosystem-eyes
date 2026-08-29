import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Buffer } from 'buffer';
import { PublicKey, VersionedMessage, VersionedTransaction } from '@solana/web3.js';
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { getSeedVault, type SeedVaultAccount, type SeedVaultLimits } from '../../../modules/skr-seedvault';
import { anchorRent, readAnchors, readAnchorsAndBalance, type AnchorState } from './anchors';
import { buildAnchorCreation, buildDeferredStake, deriveAnchors, type DeferredPart } from './deferred';
import { fetchBlockhash, sendWire } from './gateway';
import { DEFAULT_GUARDIAN_POOL } from './stakeTx';

// The whole of deferred staking, in the order a person meets it.
//
// 1. The vault is opened once, and it stays open until they close it.
// 2. Anchors are made once. The wallet sends that one itself, so this step
//    needs nothing from our server.
// 3. Every morning the day is approved: the parts are built against the
//    anchors' current values and signed in batches, one fingerprint per batch.
// 4. The parts wait on this phone. Nothing is uploaded, and nothing can be
//    sent that was not approved with the amount already written into it.
//
// The one thing this cannot do is sign in the background: the vault is a screen,
// so approval is always a moment the person is present for. Sending is not, and
// that asymmetry is the entire feature.

const PLAN_KEY = 'skr-eyes.deferred-plan';
const APP_IDENTITY = { name: 'SKR Eyes', uri: 'https://skr.alexkosa.dev', icon: 'favicon.ico' };

export type VaultStatus = {
  present: boolean;
  permission: boolean;
  authToken: string | null;
  seedName: string | null;
  account: SeedVaultAccount | null;
  limits: SeedVaultLimits | null;
};

const EMPTY: VaultStatus = { present: false, permission: false, authToken: null, seedName: null, account: null, limits: null };

export function useDeferredStaking(wallet: string) {
  const [vault, setVault] = useState<VaultStatus>(EMPTY);
  const [anchors, setAnchors] = useState<AnchorState[]>([]);
  const [parts, setParts] = useState<DeferredPart[]>([]);
  const [lamports, setLamports] = useState<number | null>(null);
  const [rent, setRent] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // How many anchors the phone keeps ready. Three is the vault's batch, so
  // three parts is what one fingerprint buys; more anchors simply means more
  // fingerprints, not a different mechanism.
  const [anchorCount, setAnchorCount] = useState(3);

  const persist = useCallback(async (next: DeferredPart[]) => {
    setParts(next);
    await AsyncStorage.setItem(PLAN_KEY, JSON.stringify({ wallet, parts: next })).catch(() => undefined);
  }, [wallet]);

  useEffect(() => {
    let gone = false;
    AsyncStorage.getItem(PLAN_KEY)
      .then((raw) => {
        if (gone || !raw) return;
        const saved = JSON.parse(raw) as { wallet: string; parts: DeferredPart[] };
        // A plan belongs to the wallet that approved it. Showing another
        // wallet's parts would be showing signatures that cannot be sent.
        if (saved.wallet === wallet) setParts(saved.parts);
      })
      .catch(() => undefined);
    return () => { gone = true; };
  }, [wallet]);

  const refresh = useCallback(async () => {
    setError(null);
    const sdk = getSeedVault();
    if (!sdk) {
      setVault({ ...EMPTY, present: false });
      return;
    }

    try {
      const present = sdk.isAvailable();
      const permission = sdk.hasPermission();
      let authToken: string | null = null;
      let seedName: string | null = null;
      let account: SeedVaultAccount | null = null;
      let limits: SeedVaultLimits | null = null;

      if (present && permission) {
        limits = sdk.limits();
        const seeds = sdk.authorizedSeeds();
        const seed = seeds[0];
        if (seed) {
          authToken = seed.authToken;
          seedName = seed.name;
          // The vault offers a hundred derived accounts and flags several as
          // wallets. Only one of them is the address this app is connected to,
          // and signing with any other would produce a valid signature for the
          // wrong person.
          account = sdk.accounts(authToken).find((candidate) => candidate.address === wallet) ?? null;
        }
      }

      setVault({ present, permission, authToken, seedName, account, limits });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The vault did not answer.');
    }

    // The addresses are derived on the phone and need no network, so they go up
    // on screen straight away. Without this a failed read leaves the previous
    // list standing, and changing the number of parts appears to do nothing.
    let derived;
    try {
      derived = await deriveAnchors(new PublicKey(wallet), anchorCount);
      setAnchors(derived.map((anchor) => ({ ...anchor, exists: false, value: null, authority: null, usable: false })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The anchor addresses could not be derived.');
      return;
    }

    setRent(anchorRent());
    try {
      const read = await readAnchorsAndBalance(derived, wallet);
      setAnchors(read.anchors);
      setLamports(read.lamports);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The anchors could not be read.');
    }
  }, [anchorCount, wallet]);

  useEffect(() => { void refresh(); }, [refresh]);

  /**
   * Everything the person has to do once, behind a single button.
   *
   * Access, the vault, and the anchors used to be three steps on screen with
   * three explanations. They are one decision — "let this phone stake for me on
   * a schedule" — and splitting it made the person do the app's bookkeeping.
   */
  const turnOn = useCallback(async () => {
    const sdk = getSeedVault();
    if (!sdk) return;
    setBusy('setup');
    setError(null);
    try {
      if (!sdk.hasPermission()) {
        const granted = await sdk.requestPermission();
        if (!granted) throw new Error('Without access to the Seed Vault a schedule cannot be signed.');
      }
      if (sdk.authorizedSeeds().length === 0) await sdk.authorize();
      await refresh();

      const derived = await deriveAnchors(new PublicKey(wallet), anchorCount);
      const state = await readAnchors(derived, wallet);
      const missing = state.filter((anchor) => !anchor.exists);
      if (missing.length > 0) {
        const { blockhash, slot } = await fetchBlockhash();
        const transaction = buildAnchorCreation({
          user: new PublicKey(wallet),
          anchors: missing,
          rentLamports: anchorRent(),
          blockhash,
        });
        await transact(async (adapter) => {
          await adapter.authorize({ chain: 'solana:mainnet', identity: APP_IDENTITY });
          return adapter.signAndSendTransactions({ transactions: [transaction], minContextSlot: slot });
        });
      }
      setNote('Ready. Set the amount and approve the day.');
      setTimeout(() => { void refresh(); }, 4_000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Setup did not finish.');
    } finally {
      setBusy(null);
    }
  }, [anchorCount, refresh, wallet]);

  const enterVault = useCallback(async () => {
    const sdk = getSeedVault();
    if (!sdk) return;
    setBusy('vault');
    setError(null);
    try {
      if (!sdk.hasPermission()) {
        const granted = await sdk.requestPermission();
        if (!granted) throw new Error('Without access to the Seed Vault a schedule cannot be signed.');
      }
      await sdk.authorize();
      await refresh();
      setNote('The vault is open. It stays open until you close it in Seed Vault settings.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The vault refused.');
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  /**
   * Makes the anchors that do not exist yet. The wallet signs and sends this
   * one, so it needs nothing from our gateway — and it is the only step in the
   * whole feature that touches a wallet at all.
   */
  const createAnchors = useCallback(async () => {
    setBusy('anchors');
    setError(null);
    try {
      const missing = anchors.filter((anchor) => !anchor.exists);
      if (missing.length === 0) {
        setNote('Every anchor is already there.');
        return;
      }
      const rentLamports = rent ?? anchorRent();
      const { blockhash, slot } = await fetchBlockhash();
      const transaction = buildAnchorCreation({
        user: new PublicKey(wallet),
        anchors: missing,
        rentLamports,
        blockhash,
      });

      await transact(async (adapter) => {
        await adapter.authorize({ chain: 'solana:mainnet', identity: APP_IDENTITY });
        return adapter.signAndSendTransactions({ transactions: [transaction], minContextSlot: slot });
      });

      setNote(`${missing.length} anchor(s) requested. They appear a moment after the wallet sends them.`);
      // The chain needs a beat before the new accounts can be read back.
      setTimeout(() => { void refresh(); }, 4_000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The anchors were not made.');
    } finally {
      setBusy(null);
    }
  }, [anchors, refresh, rent, wallet]);

  /**
   * The morning approval.
   *
   * Every part is built against the value its anchor holds right now, then the
   * parts are handed to the vault in batches of whatever it allows. One batch
   * is one fingerprint, and nothing is sent.
   */
  const approveDay = useCallback(async ({ perPartRaw, count, spacingMinutes }: {
    perPartRaw: bigint;
    count: number;
    spacingMinutes: number;
  }) => {
    const sdk = getSeedVault();
    if (!sdk || !vault.authToken || !vault.account) {
      setError('Open the vault first.');
      return;
    }

    setBusy('signing');
    setError(null);
    try {
      const derived = await deriveAnchors(new PublicKey(wallet), count);
      const state = await readAnchors(derived, wallet);
      const unusable = state.filter((anchor) => !anchor.usable);
      if (unusable.length > 0) {
        throw new Error(`${unusable.length} anchor(s) are missing or not yours. Make the anchors first.`);
      }

      const user = new PublicKey(wallet);
      const now = Date.now();
      const drafts: DeferredPart[] = state.map((anchor, index) => {
        const transaction = buildDeferredStake({
          user,
          guardianPool: DEFAULT_GUARDIAN_POOL,
          amountRaw: perPartRaw,
          anchorAddress: anchor.address,
          anchorValue: anchor.value!,
        });
        const openAt = now + index * spacingMinutes * 60_000;
        return {
          index,
          amountRaw: perPartRaw.toString(),
          anchorAddress: anchor.address,
          anchorValue: anchor.value!,
          messageBase64: Buffer.from(transaction.message.serialize()).toString('base64'),
          signatureBase64: null,
          // A window, not a moment: Android will not wake an ordinary app to
          // the minute, and a promise it cannot keep is worse than a window.
          sendAfter: openAt,
          sendBefore: openAt + 60 * 60_000,
          state: 'unsigned',
          signature: null,
        };
      });

      const batch = Math.max(1, vault.limits?.maxSigningRequests ?? 3);
      const signed: DeferredPart[] = [];
      for (let start = 0; start < drafts.length; start += batch) {
        const slice = drafts.slice(start, start + batch);
        const signatures = await sdk.signMessages(
          vault.authToken,
          vault.account.derivationPath,
          slice.map((part) => part.messageBase64),
        );
        if (signatures.length !== slice.length) throw new Error('The vault signed only part of the batch.');
        slice.forEach((part, offset) => {
          signed.push({ ...part, signatureBase64: signatures[offset] ?? null, state: 'ready' });
        });
        // Keep whatever was approved: a refusal halfway through must not throw
        // away the fingerprints already given.
        await persist([...signed]);
      }

      setNote(`${signed.length} part(s) approved with ${Math.ceil(drafts.length / batch)} fingerprint(s).`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The day was not approved.');
    } finally {
      setBusy(null);
    }
  }, [persist, vault, wallet]);

  /**
   * Posts one approved part. No signature is created here — this step can only
   * publish bytes that already exist, which is why it is safe to run without
   * the person watching.
   */
  const sendPart = useCallback(async (index: number) => {
    const part = parts.find((candidate) => candidate.index === index);
    if (!part || !part.signatureBase64) return;

    setBusy(`send-${index}`);
    setError(null);
    try {
      const message = VersionedMessage.deserialize(Buffer.from(part.messageBase64, 'base64'));
      const transaction = new VersionedTransaction(message);
      transaction.addSignature(new PublicKey(wallet), Buffer.from(part.signatureBase64, 'base64'));
      const { slot } = await fetchBlockhash();

      const signature = await sendWire(Buffer.from(transaction.serialize()).toString('base64'), slot);
      await persist(parts.map((candidate) => (
        candidate.index === index ? { ...candidate, state: 'sent', signature } : candidate
      )));
      setNote(`Part ${index + 1} is on the chain.`);
    } catch (caught) {
      // A part that was refused is not a part to retry blindly: if it reached
      // execution it burned its anchor, and the anchor is what says so.
      setError(caught instanceof Error ? caught.message : 'The part was refused.');
      await persist(parts.map((candidate) => (
        candidate.index === index ? { ...candidate, state: 'unknown' } : candidate
      )));
    } finally {
      setBusy(null);
      void refresh();
    }
  }, [parts, persist, refresh, wallet]);

  // A part goes out when its window opens, on its own.
  //
  // This is the whole promise of the feature: approve in the morning, and the
  // day happens without you. While the app is on screen this timer does it; the
  // same call belongs on an alarm so it also happens with the app closed, and
  // until that lands a part can only go out while the app is open.
  useEffect(() => {
    const timer = setInterval(() => {
      if (busy != null) return;
      const now = Date.now();
      const due = parts.find((part) => (
        part.state === 'ready' && part.signatureBase64 != null && now >= part.sendAfter && now <= part.sendBefore
      ));
      if (due) void sendPart(due.index);
    }, 15_000);
    return () => clearInterval(timer);
  }, [busy, parts, sendPart]);

  const clearPlan = useCallback(async () => {
    await AsyncStorage.removeItem(PLAN_KEY).catch(() => undefined);
    setParts([]);
    setNote('The plan is gone from this phone. Close the anchors to make sure nothing can be sent.');
  }, []);

  return {
    vault, anchors, parts, lamports, rent, busy, error, note,
    anchorCount, setAnchorCount,
    refresh, turnOn, enterVault, createAnchors, approveDay, sendPart, clearPlan,
  };
}
