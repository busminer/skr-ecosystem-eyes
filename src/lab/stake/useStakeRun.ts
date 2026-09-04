import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { t } from '../../i18n';
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

// One question at a time, and never faster than the gateway's sixty reads a
// minute. Asking about all sixteen parts at once would be 384 requests a
// minute and the gateway would start refusing us halfway through a run.
const POLL_SPACING_MS = 1_200;

// How long the app keeps asking before it stops and says so. Three minutes is
// long past the point where a live transaction confirms; anything still silent
// after that is a question for the chain later, not a spinner now.
const POLL_DEADLINE_MS = 180_000;

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
  // Set the moment the wallet has the transactions. From then on the app
  // cannot know what reached the chain until it asks, even after a restart.
  handed?: boolean;
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
  // One sweep at a time. Returning from the background must not start a second
  // one alongside the first and double our questions to the gateway.
  const drainingRef = useRef(false);

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
        // A run without a single signature never reached the chain, unless the
        // app died while the wallet held it: then it may have been broadcast
        // and the person must be told before they stake the same amount twice.
        if (!saved.parts.some((part) => part.signature)) {
          if (!saved.handed) return void forget();
          setUncertain(true);
          setError(t('The app was closed while the wallet had this stake. Check your position on the Me screen before staking again.'));
          setPhase('error');
          return void forget();
        }
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

  // Android throttles an app's timers once it is out of sight, and the wallet
  // approval puts this app out of sight by design. A run that was half asked
  // about could sit there frozen, showing "landing" over transactions that
  // reached the chain minutes ago — which reads as the staking having stopped.
  //
  // Nothing was ever lost: every signature is written to disk the moment the
  // wallet returns it, and the chain is the judge. What was lost was the
  // asking. So the moment the app is looked at again, the asking resumes.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const parts = runRef.current?.parts ?? [];
      const open = parts.some((part) => part.state !== 'confirmed' && part.state !== 'failed');
      if (open) void drainRef.current?.();
    });
    return () => subscription.remove();
  }, []);

  const patchPart = useCallback((index: number, patch: Partial<StakePart>) => {
    const current = runRef.current;
    if (!current) return;
    const parts = current.parts.map((part) => (part.index === index ? { ...part, ...patch } : part));
    commit({ ...current, parts });
  }, [commit]);

  const askOnce = useCallback(async (signature: string): Promise<'confirmed' | 'failed' | null> => {
    try {
      const status = await fetchStatus(signature);
      if (status?.err) return 'failed';
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return 'confirmed';
    } catch {
      // A dropped status read says nothing about the transaction. Ask again.
    }
    return null;
  }, []);

  // Asking about the parts, round by round.
  //
  // This used to walk the parts in order and sit on each one for up to a
  // hundred seconds before moving to the next. With sixteen parts that is
  // twenty-six minutes in the worst case, and one slow part froze every part
  // behind it — which is what "the staking stopped" looked like from outside.
  //
  // Now every unresolved part is asked about once per round, in turn, so a
  // silent one costs the others one question each and nothing more. The pace
  // is deliberately slow: the gateway allows sixty reads a minute and refuses
  // the rest, so the run has to stay inside that on its own.
  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    setPhase('sending');

    try {
      const started = Date.now();

      for (;;) {
        const parts = runRef.current?.parts ?? [];
        const open = parts.filter((part) => part.state !== 'confirmed' && part.state !== 'failed');
        if (open.length === 0) break;

        let answered = false;
        for (const part of open) {
          // A part with no signature never left the phone, and no amount of
          // asking the chain will change that.
          if (!part.signature) {
            patchPart(part.index, { state: 'failed', error: 'This part was never broadcast.' });
            answered = true;
            continue;
          }
          if (part.state === 'pending') patchPart(part.index, { state: 'sent' });

          const outcome = await askOnce(part.signature);
          if (outcome) {
            answered = true;
            patchPart(part.index, {
              state: outcome,
              error: outcome === 'failed' ? 'The chain rejected this part.' : null,
            });
            void Haptics.notificationAsync(
              outcome === 'confirmed'
                ? Haptics.NotificationFeedbackType.Success
                : Haptics.NotificationFeedbackType.Warning,
            ).catch(() => undefined);
          }
          await new Promise((resolve) => setTimeout(resolve, POLL_SPACING_MS));
        }

        if (Date.now() - started > POLL_DEADLINE_MS) {
          for (const part of runRef.current?.parts ?? []) {
            if (part.state === 'confirmed' || part.state === 'failed') continue;
            patchPart(part.index, {
              state: 'unknown',
              error: 'The chain has not answered about this part yet. Its signature is saved — ask again before staking it a second time.',
            });
          }
          break;
        }

        // Nothing moved this round and nothing is left to ask: stop rather
        // than spin.
        if (!answered && open.every((part) => !part.signature)) break;
      }

      const finished = runRef.current?.parts ?? [];
      const failed = finished.filter((part) => part.state === 'failed').length;
      const unknown = finished.filter((part) => part.state === 'unknown').length;
      if (failed > 0 || unknown > 0) {
        const summary = [
          failed > 0 ? `${failed} rejected by the chain` : '',
          unknown > 0 ? `${unknown} still unanswered` : '',
        ].filter(Boolean).join(', ');
        setError(`Of ${finished.length} parts: ${summary}. Every signature is saved. Ask again before you stake the same amount a second time.`);
        setPhase('error');
        return;
      }
      setPhase('done');
    } finally {
      drainingRef.current = false;
    }
  }, [askOnce, patchPart]);

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
      const signatures = await transact(async (adapter) => {
        await adapter.authorize({ chain: 'solana:mainnet', identity: APP_IDENTITY });
        // Only past this line can anything have reached the chain. Authorising
        // does not broadcast, so a wallet that is missing, refuses the app or
        // refuses the batch size fails here — and the person deserves to be
        // told plainly that nothing was sent, not warned about money that
        // never moved.
        handedToWallet = true;
        if (runRef.current) commit({ ...runRef.current, handed: true });
        return adapter.signAndSendTransactions({ transactions: unsigned, minContextSlot: slot });
      }) as string[];

      if (!Array.isArray(signatures) || signatures.length === 0) throw new Error('The wallet returned no signatures.');

      if (signatures.length !== unsigned.length) {
        // A short answer is the dangerous one: the wallet broadcasts as it
        // signs, so the signatures it did return are probably already on the
        // chain. Throwing them away would leave the person with a warning and
        // no way to check. Save them first, then say what happened — the run
        // survives the restart and the app resumes asking the chain about it.
        const answered: StakePart[] = [];
        signatures.forEach((signature, index) => {
          const amountRaw = slices[index];
          if (typeof signature !== 'string' || !signature || amountRaw == null) return;
          answered.push({ index, amountRaw: amountRaw.toString(), wire: null, signature, state: 'sent' as PartState });
        });
        if (answered.length > 0) {
          commit({ wallet, guardianPool: guardianPool.toBase58(), createdAt: Date.now(), parts: answered });
        }
        throw new Error('The wallet handled only part of the request.');
      }

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
  // A wallet that refuses the number of payloads refuses the whole batch: the
  // protocol answers before it signs anything, so this one can be said plainly.
  if (text.includes('too_many') || text.includes('too many') || text.includes('payload')) {
    return 'Your wallet accepts fewer transactions in one approval. Choose 8 or 4 and try again. Nothing was sent.';
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
