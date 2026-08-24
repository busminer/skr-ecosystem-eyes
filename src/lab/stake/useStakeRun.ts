import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { PublicKey } from '@solana/web3.js';
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { fetchBlockhash, fetchStatus, GatewayError } from './gateway';
import { buildStakeTransaction, DEFAULT_GUARDIAN_POOL, equalParts } from './stakeTx';

// One stake run, start to finish.
//
// The app builds every part itself, the wallet signs and broadcasts them in
// one approval, and the returned signatures are written down before anything
// else happens. From that moment a part can always be asked about: the chain
// is the judge, and a saved signature is re-checked, never replaced.
//
// Sending through the wallet rather than our own gateway is deliberate. On a
// real Seeker the wallet adds its own priority-fee instruction, which the
// gateway's exact one-instruction policy refuses, and the gateway allows six
// submissions a minute, which a sixteen-part run exceeds at once.

const RUN_KEY = 'skr.lab.stake.run';
const POLL_MS = 2_500;
const POLL_ATTEMPTS = 40;

const APP_IDENTITY = { name: 'SKR Eyes', uri: 'https://skr.alexkosa.dev', icon: 'favicon.ico' };

export type PartState = 'pending' | 'sending' | 'sent' | 'confirmed' | 'failed' | 'unknown';

export type StakePart = {
  index: number;
  amountRaw: string;
  signature: string | null;
  wire: string | null;
  state: PartState;
  error?: string | null;
};

export type StakeRun = {
  wallet: string;
  guardianPool: string;
  createdAt: number;
  parts: StakePart[];
};

export type RunPhase = 'idle' | 'preparing' | 'signing' | 'sending' | 'done' | 'error';

async function saveRun(run: StakeRun | null) {
  if (!run) return AsyncStorage.removeItem(RUN_KEY).catch(() => undefined);
  return AsyncStorage.setItem(RUN_KEY, JSON.stringify(run)).catch(() => undefined);
}

// Disconnect promises to erase the saved run too, so the key has to be
// reachable from outside this hook.
export async function forgetStakeRun(): Promise<void> {
  await AsyncStorage.removeItem(RUN_KEY).catch(() => undefined);
}

export function useStakeRun(wallet: string | null) {
  const [run, setRun] = useState<StakeRun | null>(null);
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  // True when the wallet had the batch and we cannot know what it did with it.
  const [uncertain, setUncertain] = useState(false);
  const runRef = useRef<StakeRun | null>(null);
  const drainRef = useRef<(() => Promise<void>) | null>(null);

  const commit = useCallback((next: StakeRun | null) => {
    runRef.current = next;
    setRun(next);
    void saveRun(next);
  }, []);

  // An unfinished run from a previous launch is resumed, never rebuilt.
  //
  // Only an unfinished one. A run whose every part is confirmed or failed has
  // already been asked about and the chain has answered; keeping it on screen
  // does not protect anything, it only stands between the person and their
  // next stake. A run belonging to another wallet is not ours to resume.
  useEffect(() => {
    AsyncStorage.getItem(RUN_KEY).then((raw) => {
      if (!raw) return;
      const forget = () => AsyncStorage.removeItem(RUN_KEY).catch(() => undefined);
      try {
        const saved = JSON.parse(raw) as StakeRun;
        if (!saved?.parts?.length) return void forget();
        if (wallet && saved.wallet !== wallet) return void forget();
        // A run without a single signature never reached the chain: there is
        // nothing to resume and nothing to be careful about.
        if (!saved.parts.some((part) => part.signature)) return void forget();
        const unsettled = saved.parts.some((part) => part.state !== 'confirmed' && part.state !== 'failed');
        if (!unsettled) return void forget();
        runRef.current = saved;
        setRun(saved);
        setPhase('sending');
        // Restoring a run and then sitting still is the worst of both worlds:
        // the screen says "landing" forever and nobody asks the chain. Ask.
        void drainRef.current?.();
      } catch {
        void forget();
      }
    }).catch(() => undefined);
  }, [wallet]);

  const patchPart = useCallback((index: number, patch: Partial<StakePart>) => {
    const current = runRef.current;
    if (!current) return;
    const parts = current.parts.map((part) => (part.index === index ? { ...part, ...patch } : part));
    commit({ ...current, parts });
  }, [commit]);

  const awaitConfirmation = useCallback(async (signature: string): Promise<'confirmed' | 'failed' | 'unknown'> => {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      try {
        const status = await fetchStatus(signature);
        if (status?.err) return 'failed';
        if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return 'confirmed';
      } catch {
        // A dropped status read says nothing about the transaction; keep asking.
      }
    }
    // We ran out of patience, not out of chain. Saying "failed" here would
    // invite the person to stake again on top of a transaction that may well
    // have landed.
    return 'unknown';
  }, []);

  const drain = useCallback(async () => {
    const current = runRef.current;
    if (!current) return;
    setPhase('sending');

    for (const part of current.parts) {
      const live = runRef.current?.parts.find((item) => item.index === part.index);
      if (!live || live.state === 'confirmed' || live.state === 'failed') continue;
      // An unknown part is exactly the one worth asking about again.
      if (!live.signature) {
        patchPart(part.index, { state: 'failed', error: 'This part was never broadcast.' });
        continue;
      }

      patchPart(part.index, { state: 'sent' });
      const outcome = await awaitConfirmation(live.signature);
      patchPart(part.index, {
        state: outcome,
        error: outcome === 'failed'
          ? 'The chain rejected this part.'
          : outcome === 'unknown'
            ? 'The chain has not answered about this part yet. Its signature is saved — ask again before staking it a second time.'
            : null,
      });
      if (outcome === 'confirmed') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      else void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    }

    const finished = runRef.current?.parts ?? [];
    const failed = finished.filter((part) => part.state === 'failed').length;
    const unknown = finished.filter((part) => part.state === 'unknown').length;
    if (failed > 0 || unknown > 0) {
      const parts = [
        failed > 0 ? `${failed} rejected by the chain` : '',
        unknown > 0 ? `${unknown} still unanswered` : '',
      ].filter(Boolean).join(', ');
      setError(`Of ${finished.length} parts: ${parts}. Every signature is saved. Ask again before you stake the same amount a second time.`);
      setPhase('error');
      return;
    }
    setPhase('done');
  }, [awaitConfirmation, patchPart]);

  const start = useCallback(async (perPartRaw: bigint, parts: number) => {
    if (!wallet) return;
    setError(null);
    setUncertain(false);
    setPhase('preparing');
    const user = new PublicKey(wallet);
    const guardianPool = DEFAULT_GUARDIAN_POOL;
    const slices = equalParts(perPartRaw, parts);

    // Show the run immediately: every part exists on screen before the wallet
    // is even opened, so the progress is visible from the first tap.
    commit({
      wallet,
      guardianPool: guardianPool.toBase58(),
      createdAt: Date.now(),
      parts: slices.map((amountRaw, index) => ({
        index,
        amountRaw: amountRaw.toString(),
        signature: null,
        wire: null,
        state: 'pending' as PartState,
      })),
    });

    let handedToWallet = false;
    try {
      const { blockhash, slot } = await fetchBlockhash();
      const unsigned = slices.map((amountRaw, index) => buildStakeTransaction({ user, guardianPool, amountRaw, blockhash, nonce: index }));

      setPhase('signing');
      handedToWallet = true;
      const signatures = await transact(async (adapter) => {
        await adapter.authorize({ chain: 'solana:mainnet', identity: APP_IDENTITY });
        return adapter.signAndSendTransactions({ transactions: unsigned, minContextSlot: slot });
      }) as string[];

      if (!Array.isArray(signatures) || signatures.length === 0) throw new Error('The wallet returned no signatures.');
      if (signatures.length !== unsigned.length) throw new Error('The wallet handled only part of the request.');

      const prepared: StakePart[] = signatures.map((signature, index) => {
        const amountRaw = slices[index];
        if (amountRaw == null || typeof signature !== 'string') throw new Error('The wallet returned an incomplete answer.');
        return {
          index,
          amountRaw: amountRaw.toString(),
          wire: null,
          signature,
          state: 'sent' as PartState,
        };
      });

      commit({ wallet, guardianPool: guardianPool.toBase58(), createdAt: Date.now(), parts: prepared });
      await drain();
    } catch (caught) {
      // Before the wallet was involved we can say plainly that nothing was
      // sent. After it, we cannot: the wallet broadcasts as it signs, and a
      // failure part-way through the batch comes back without telling us how
      // many already left. Saying "nothing was sent" there would be the one
      // lie that costs real money, because the person would stake it twice.
      setUncertain(handedToWallet);
      setError(handedToWallet ? explainAfterWallet(caught) : explain(caught));
      setPhase('error');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    }
  }, [commit, drain, wallet]);

  useEffect(() => { drainRef.current = drain; }, [drain]);

  const resume = useCallback(() => { void drain(); }, [drain]);

  const clear = useCallback(() => {
    commit(null);
    setPhase('idle');
    setError(null);
    setUncertain(false);
  }, [commit]);

  const confirmed = run?.parts.filter((part) => part.state === 'confirmed').length ?? 0;
  const total = run?.parts.length ?? 0;

  return { run, phase, error, uncertain, start, resume, clear, confirmed, total };
}

// After the wallet has the batch, every answer has to leave room for the
// possibility that some of it already reached the chain.
function explainAfterWallet(caught: unknown): string {
  const raw = caught instanceof Error ? caught.message : String(caught ?? '');
  const text = raw.toLowerCase();
  if (text.includes('declin') || text.includes('cancel') || text.includes('reject') || text.includes('user_declin')) {
    return 'You cancelled in the wallet. If you had already approved a batch before cancelling, check your position below before staking the same amount again.';
  }
  return 'The wallet stopped part way through and did not say how much it had already sent. Refresh your position before staking this amount again — some of it may already be on the chain.';
}

// Errors reach the person, not just the log. A cancelled wallet is not a
// failure of the app and should not read like one.
function explain(caught: unknown): string {
  const raw = caught instanceof Error ? caught.message : String(caught ?? '');
  const text = raw.toLowerCase();
  if (text.includes('declin') || text.includes('cancel') || text.includes('reject') || text.includes('user_declin')) {
    return 'You cancelled the request in the wallet. Nothing was sent.';
  }
  if (text.includes('too_many') || text.includes('too many') || text.includes('payload')) {
    return 'Your wallet accepts fewer transactions in one approval. Choose 8 or 4 and try again.';
  }
  if (text.includes('not authorized') || text.includes('auth_token')) {
    return 'The wallet did not authorise this app. Try connecting again.';
  }
  if (text.includes('no installed wallet') || text.includes('no wallet') || text.includes('activity')) {
    return 'No Solana wallet answered on this phone.';
  }
  if (text.includes('network') || text.includes('fetch') || text.includes('timeout') || text.includes('abort')) {
    return 'The network dropped before anything was sent. Nothing left your wallet.';
  }
  return raw || 'The stake could not be prepared.';
}
