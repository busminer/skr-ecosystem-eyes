import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isWalletCancel } from '../mwa';
import { lang, t } from '../i18n';
import { prefValue } from '../prefs';
import { useReducedMotion } from '../useReducedMotion';
import { Button } from '../lab/kit';
import { colors, font, radius, spacing } from '../theme';
import { EyeApiError, type EyeIntent, type EyeSubmitResult } from './api';
import { EYE_FINGER_ENABLED } from './config';
import { isFingerCancel } from './finger';
import { fontScale } from './fit';
import { intentFresh, MoveRefused, runMove, stepFor, type MoveExpect, type MoveKind, type MoveResume, type MoveStage, type MoveStep } from './move';
import { skr, sol } from './money';
import type { EyeTxSummary } from './txCheck';
import { BEAT_MS, Stepper, keyFingerprint, shorten, usePaced, type Failure, type StepModel, type StepStatus } from './Stepper';
import { epochMs } from './time';
import { PortalEye } from './PortalEye';
import { ritual } from '../sound';

// The sheet that shows a move as it happens: opening the Eye, or one Blink.
//
// It rises over the panel the moment the button is pressed and runs the move
// itself (move.ts), one step on screen at a time: Finger, Wallet, Network,
// and for an open, Eye opens. Each card says in one plain sentence what the
// phone is doing right now, and when the step is done, what was done, with
// the check and what came back: the key that signed, the transaction's
// signature, the Eye's name. Then a button, and the person moves on when
// they have read it.
//
// Where the pauses are is decided by what can expire, not by the screen.
// The one-time challenge the finger signs is spent at once by asking for the
// transaction, so the Finger card runs through both and stops only when the
// transaction is in hand. That transaction is good until the server's
// `expiresAt`, so the pause before the wallet is safe while it is fresh, and
// if the person read past it the sheet says so and starts again from the
// top. After the wallet has signed nothing waits: the signed bytes go to the
// server at once, because a signed transaction goes stale in about a minute.
// The last pause, before the lids part, costs nothing. The wallet itself is
// opened by the person's own tap on the button, which is what the wallet
// expects.
//
// Every call move.ts makes, and the order of the calls, is exactly as
// before; the sheet only holds the listener between two of them.
//
// While it holds at the wallet, the sheet says what the wallet is about to
// be asked for, read from the transaction itself rather than from the price
// the server quoted: the SOL to the maker and, for an open, what goes into
// the new Eye's own account. A transaction the app would not sign never gets
// that far; the Wallet card says so in red and the wallet is never opened.
//
// A failure lands on the step it happened in, in the words of whoever
// refused: the server, the wallet, or the phone. Try again picks the move up
// where it stopped when that is possible (move.ts says when); Not now closes
// the sheet. The wallet closed or the finger came off the prompt is not a
// failure: the step stops, amber, and says so without a red line.

type Key = MoveStep | 'eye';
type Sub = 'challenge' | 'finger' | 'intent' | 'ready' | 'wallet';
type Gate = { resolve: () => void; reject: (error: Error) => void };

// Every step that lands is struck like glass, with its touch.
function buzz() {
  ritual('chime', 0.3);
}

function thud() {
  if (prefValue('buzz', true)) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
}

function describe(error: unknown): Failure {
  // Asked too early: the Eye rests eight hours between Blinks. Said as the
  // phone's own time of day, not as an error.
  if (error instanceof EyeApiError && error.code === 'cooling') {
    const at = epochMs(error.extra.nextAt);
    let time: string | null = null;
    if (at != null) {
      try { time = new Date(at).toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit' }); } catch { time = new Date(at).toISOString().slice(11, 16); }
    }
    return { title: t('Your Eye is resting'), body: time ? t('The next Blink opens at {time}.', { time }) : null, detail: null };
  }
  // Not enough in the wallet: said plainly, with what is missing.
  if (error instanceof EyeApiError && error.code === 'not_enough_skr') {
    const needed = Number(error.extra.skrNeeded);
    const held = Number(error.extra.skrHeld);
    return {
      title: t('Not enough SKR in this wallet'),
      body: Number.isFinite(needed) && Number.isFinite(held) ? t('This needs {need} SKR. The wallet holds {have} SKR.', { need: skr(needed), have: skr(held) }) : null,
      detail: null,
    };
  }
  if (error instanceof EyeApiError && error.code === 'not_enough_sol') {
    const needed = Number(error.extra.lamportsNeeded);
    return {
      title: t('Not enough SOL for the network'),
      body: Number.isFinite(needed) ? t('Keep about {sol} SOL in this wallet for the network fee and the storage of your Eye.', { sol: sol(needed) }) : null,
      detail: null,
    };
  }
  if (error instanceof EyeApiError) return { title: error.message, body: null, detail: error.code };
  if (error instanceof MoveRefused) return { title: error.message, body: null, detail: error.code };
  return { title: error instanceof Error && error.message ? error.message : t('The Eye service did not answer'), body: null, detail: null };
}

// What the wallet will be asked for, in one sentence, from the transaction's
// own bytes.
function askLine(summary: EyeTxSummary): string {
  if (summary.pay === 'skr') {
    return summary.storage > 0
      ? t("Read from the transaction: {skr} SKR to the maker of SKR Eyes, about {rent} SOL into your Eye's own account on Solana, and the network fee your wallet sets.", { skr: skr(summary.toMakerSkr), rent: sol(summary.storage) })
      : t('Read from the transaction: {skr} SKR to the maker of SKR Eyes, and the network fee your wallet sets.', { skr: skr(summary.toMakerSkr) });
  }
  const toMaker = sol(summary.toMaker + summary.priorityFee);
  return summary.storage > 0
    ? t("Read from the transaction: {sol} SOL to the maker of SKR Eyes, about {rent} SOL into your Eye's own account on Solana, and the network fee your wallet sets.", { sol: toMaker, rent: sol(summary.storage) })
    : t('Read from the transaction: {sol} SOL to the maker of SKR Eyes, and the network fee your wallet sets.', { sol: toMaker });
}

// `expect` is what the card showed before the move (move.ts MoveExpect): the
// transaction is held to it.
export function MoveSheet({ kind, wallet, expect, onDone, onClose }: { kind: MoveKind; wallet: string; expect: MoveExpect; onDone: (result: EyeSubmitResult) => void; onClose: () => void }) {
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const paced = usePaced(reduced ? 0 : BEAT_MS);
  const finger = EYE_FINGER_ENABLED;
  // The steps this move has, in order. No Finger while the flag is off; no
  // Eye opens for a Blink, whose picture is the blink itself.
  const keys = useRef<Key[]>([...(finger ? ['finger' as const] : []), 'wallet', 'network', ...(kind === 'open' ? ['eye' as const] : [])]).current;
  const idx = useCallback((key: Key) => keys.indexOf(key), [keys]);

  // Steps 0..done-1 are done; `active` is the one turning, -1 for none.
  const [done, setDone] = useState(0);
  const [active, setActive] = useState(-1);
  const [failedAt, setFailedAt] = useState(-1);
  const [stopped, setStopped] = useState(false);
  const [sub, setSub] = useState<Sub>(finger ? 'challenge' : 'intent');
  // The step on screen. It follows the work, and the person moves it on.
  const [current, setCurrent] = useState(0);
  // Waiting at the wallet: the transaction is in hand and the move is held
  // until the person taps.
  const [held, setHeld] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [p256, setP256] = useState<string | null>(null);
  const [intent, setIntent] = useState<EyeIntent | null>(null);
  const [summary, setSummary] = useState<EyeTxSummary | null>(null);
  const [signed, setSigned] = useState<string | null>(null);
  const [result, setResult] = useState<EyeSubmitResult | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  // The Eye on top of the sheet: shut until an open lands, blinking when a
  // Blink does.
  const [eyeOpen, setEyeOpen] = useState(kind === 'blink');
  const [eyeBlink, setEyeBlink] = useState(0);
  const [opened, setOpened] = useState(false);
  // Each run has its own ticket; an unmount moves it on and drops the answer.
  const ticket = useRef(0);
  const stage = useRef<MoveStage['stage'] | null>(null);
  // Whether the last failure was the network between us and the server,
  // rather than the server's own no: only then may the same bytes go again.
  const transport = useRef(false);
  // The hold at the wallet, and whether the next one may be skipped because
  // the person's tap on Try again is itself the go-ahead.
  const gate = useRef<Gate | null>(null);
  const skipGate = useRef(false);
  const lids = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The panel's callbacks, always the latest ones, read through a ref so
  // the panel redrawing around the sheet (its clock ticks once a second)
  // never restarts the move. What the card showed is read the same way.
  const handlers = useRef({ onDone, onClose });
  handlers.current = { onDone, onClose };
  const expected = useRef(expect);
  expected.current = expect;

  // Lets a held move go, with a refusal it will never show: whoever is
  // waiting on it has a ticket that no longer matches.
  const dropGate = useCallback(() => {
    const waiting = gate.current;
    gate.current = null;
    waiting?.reject(new Error('closed'));
  }, []);

  const run = useCallback(async (resume: MoveResume | null) => {
    ticket.current += 1;
    const mine = ticket.current;
    paced.clear();
    dropGate();
    setFailure(null);
    setFailedAt(-1);
    setStopped(false);
    setResult(null);
    setSummary(null);
    setHeld(false);
    setOpened(false);
    const from: Key = resume ? (resume.signed ? 'network' : 'wallet') : keys[0] ?? 'wallet';
    setDone(idx(from));
    setActive(idx(from));
    setCurrent(idx(from));
    setSub(resume ? 'wallet' : finger ? 'challenge' : 'intent');
    stage.current = resume ? (resume.signed ? 'network' : 'wallet') : null;

    const push = (fn: () => void) => paced.push(() => { if (mine === ticket.current) fn(); });
    const onStage = (event: MoveStage): void | Promise<void> => {
      if (mine !== ticket.current) return;
      stage.current = event.stage;
      switch (event.stage) {
        case 'challenge':
          push(() => { setActive(idx('finger')); setCurrent(idx('finger')); setSub('challenge'); });
          return;
        case 'finger':
          push(() => setSub('finger'));
          return;
        case 'signed': {
          // The Finger card keeps running while the transaction is fetched:
          // the challenge it signed is spent by that very request.
          const key = event.p256;
          push(() => { setP256(key); setSub('intent'); });
          return;
        }
        case 'intent':
          if (!finger) push(() => { setActive(idx('wallet')); setCurrent(idx('wallet')); setSub('intent'); });
          return;
        case 'wallet': {
          const built = event.intent;
          const asked = event.summary;
          if (skipGate.current) {
            skipGate.current = false;
            push(() => { setIntent(built); setSummary(asked); setActive(idx('wallet')); setCurrent(idx('wallet')); setSub('wallet'); });
            return;
          }
          // The transaction is in hand. The move waits here for the person.
          push(() => {
            setIntent(built);
            setSummary(asked);
            if (finger) { setDone(idx('finger') + 1); setActive(-1); buzz(); }
            setSub('ready');
            setHeld(true);
          });
          return new Promise<void>((resolve, reject) => { gate.current = { resolve, reject }; });
        }
        case 'network': {
          const { intent: built, signed: bytes } = event;
          push(() => { setIntent(built); setSigned(bytes); setDone(idx('wallet') + 1); buzz(); });
          push(() => { setActive(idx('network')); setCurrent(idx('network')); });
          return;
        }
      }
    };

    try {
      const answer = await runMove(kind, wallet, onStage, resume, expected.current);
      if (mine !== ticket.current) return;
      push(() => {
        setResult(answer);
        setDone(idx('network') + 1);
        setActive(-1);
        buzz();
        if (kind === 'blink') setEyeBlink((count) => count + 1);
      });
    } catch (caught) {
      if (mine !== ticket.current) return;
      let step = stepFor(stage.current);
      if (step === 'finger' && !finger) step = 'wallet';
      const quiet = !(caught instanceof MoveRefused) && (isWalletCancel(caught) || isFingerCancel(caught));
      transport.current = !(caught instanceof EyeApiError);
      const told: Failure = quiet
        ? { title: step === 'finger' ? t('The fingerprint prompt was closed') : t('The wallet request was cancelled'), body: null, detail: null }
        : describe(caught);
      push(() => {
        setFailure(told);
        setFailedAt(idx(step));
        setCurrent(idx(step));
        setStopped(quiet);
        setActive(-1);
        setHeld(false);
        if (!quiet) buzz();
      });
    }
  }, [kind, wallet, finger, keys, idx, paced, dropGate]);

  useEffect(() => {
    void run(null);
    return () => {
      ticket.current += 1;
      dropGate();
      if (lids.current) clearTimeout(lids.current);
    };
  }, [run, dropGate]);

  // The person has read the card and taps on. At the wallet: let the move
  // go if the transaction is still fresh, and start again, saying so, if it
  // is not. After the network: the lids, then the panel.
  const proceed = useCallback(() => {
    if (held) {
      const waiting = gate.current;
      if (intent && intentFresh(intent) && waiting) {
        gate.current = null;
        setHeld(false);
        setNote(null);
        setActive(idx('wallet'));
        setCurrent(idx('wallet'));
        setSub('wallet');
        waiting.resolve();
        return;
      }
      setNote(t('The transaction expired while you were reading. Starting again.'));
      void run(null);
      return;
    }
    if (!result) return;
    if (kind === 'open' && current === idx('network')) {
      setCurrent(idx('eye'));
      setActive(idx('eye'));
      ritual('heart', 0.4);
      lids.current = setTimeout(() => {
        setDone(keys.length);
        setActive(-1);
        setEyeOpen(true);
        setOpened(true);
        thud();
        ritual('wake', 0.35);
      }, reduced ? 0 : 1_000);
      return;
    }
    handlers.current.onDone(result);
  }, [held, intent, idx, run, result, kind, current, keys.length, reduced]);

  // Where the retry starts from: the wallet again with the same transaction
  // while it is still good; the same signed bytes again when only the network
  // between us and the server gave out; otherwise from the top. A retry at
  // the wallet opens it at once: the tap on Try again is the go-ahead.
  const retry = useCallback(() => {
    const step = keys[failedAt];
    let resume: MoveResume | null = null;
    if (step === 'wallet' && intent && intentFresh(intent)) resume = { intent, signed: null };
    else if (step === 'network' && intent && signed && transport.current && intentFresh(intent)) resume = { intent, signed };
    skipGate.current = resume !== null && resume.signed === null;
    setNote(null);
    void run(resume);
  }, [keys, failedAt, intent, signed, run]);

  const close = useCallback(() => {
    ticket.current += 1;
    dropGate();
    handlers.current.onClose();
  }, [dropGate]);

  const idle = failedAt >= 0;
  const statusOf = (key: Key): StepStatus => {
    const at = idx(key);
    if (failedAt === at) return stopped ? 'stopped' : 'failed';
    if (done > at) return 'done';
    if (held && !finger && at === idx('wallet')) return 'ready';
    return active === at ? 'working' : 'pending';
  };

  const steps: StepModel[] = [];
  if (finger) {
    steps.push({
      key: 'finger',
      icon: 'finger',
      name: t('Finger'),
      doing: sub === 'challenge'
        ? t('Asking the Eye service for a one-time challenge.')
        : sub === 'finger'
          ? t("Touch the sensor. The key in your Solana Mobile Seeker's StrongBox secure element signs the challenge.")
          : t('Signed. Asking the Eye service for the transaction.'),
      done: t('Signed with your fingerprint. The transaction is ready.'),
      status: statusOf('finger'),
      failure,
      result: p256 ? (
        <>
          <Text style={styles.mono}>{keyFingerprint(p256)}</Text>
          <Text style={styles.line}>{t('The key that signed')}</Text>
        </>
      ) : null,
    });
  }
  steps.push({
    key: 'wallet',
    icon: 'wallet',
    name: t('Wallet'),
    doing: sub === 'ready'
      ? t('The transaction is ready. Your Seed Vault wallet will ask you to approve it.')
      : sub === 'wallet'
        ? t('Approve the transaction in your Seed Vault wallet.')
        : t('Asking the Eye service for the transaction.'),
    done: t('Approved in the wallet.'),
    status: statusOf('wallet'),
    failure,
  });
  steps.push({
    key: 'network',
    icon: 'network',
    name: t('Network'),
    doing: t('Sending the signed transaction to Solana and waiting for it to confirm.'),
    done: kind === 'blink' && result ? t('Confirmed on Solana. Day {count} is kept.', { count: result.eye.streak }) : t('Confirmed on Solana.'),
    status: statusOf('network'),
    failure,
    result: result ? (
      <>
        <Text style={styles.mono}>{shorten(result.signature, 8)}</Text>
        <Text style={styles.line}>{t('The signature of the transaction')}</Text>
      </>
    ) : null,
  });
  if (kind === 'open') {
    steps.push({
      key: 'eye',
      icon: 'eye',
      name: t('Eye opens'),
      doing: t('Your Eye is about to open.'),
      done: result ? t('{name} is yours.', { name: result.eye.name }) : null,
      status: statusOf('eye'),
      failure,
    });
  }

  let action: ReactNode = null;
  if (idle) {
    action = (
      <>
        <Button label={t('Try again')} onPress={retry} ghost />
        <Button label={t('Not now')} onPress={close} quiet />
      </>
    );
  } else if (held) {
    action = <Button label={finger ? t('Next') : t('Open my wallet')} onPress={proceed} hero />;
  } else if (result && current === idx('network')) {
    action = <Button label={kind === 'open' ? t('Next') : t('Done')} onPress={proceed} hero />;
  } else if (opened) {
    action = <Button label={t('See my Eye')} onPress={proceed} hero />;
  }

  const canClose = idle || held || result !== null;
  const eye = Math.round(104 / Math.pow(fontScale(), 0.5));
  return (
    <Modal transparent statusBarTranslucent animationType="fade" visible onRequestClose={() => { if (canClose) close(); }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.backdrop} onPress={() => { if (canClose) close(); }} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm }]}>
        <View style={styles.grip} />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.eyeTop}>
            <PortalEye size={eye} open={eyeOpen} blink={eyeBlink} instant={reduced} />
          </View>
          <Stepper steps={steps} current={current} reduced={reduced} eyebrow={kind === 'open' ? t('Open my Eye') : t('Blink')} note={note} />
          {held && summary ? <Text style={styles.ask}>{askLine(summary)}</Text> : null}
        </ScrollView>
        {action ? <View style={styles.actions}>{action}</View> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(2, 4, 7, 0.72)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '92%', backgroundColor: colors.panelSolid, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderWidth: 1, borderColor: '#111B24', paddingTop: spacing.sm },
  grip: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong, marginBottom: spacing.sm },
  // The words scroll if they must; the buttons under them never do.
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md },
  actions: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  eyeTop: { alignItems: 'center', marginBottom: -spacing.xs },
  line: { color: colors.muted, fontFamily: font.regular, fontSize: 14.5, lineHeight: 21 },
  mono: { color: colors.text, fontFamily: font.mono, fontSize: 13, lineHeight: 19, letterSpacing: 0.3 },
  // What the wallet will be asked for, just above the button that opens it.
  ask: { color: colors.text, fontFamily: font.medium, fontSize: 14.5, lineHeight: 21, fontVariant: ['tabular-nums'] },
});
