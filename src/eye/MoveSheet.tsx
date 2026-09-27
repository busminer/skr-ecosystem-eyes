import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { isWalletCancel } from '../mwa';
import { lang, t } from '../i18n';
import { prefValue } from '../prefs';
import { useReducedMotion } from '../useReducedMotion';
import { Button } from '../lab/kit';
import { colors, font, radius, spacing, type } from '../theme';
import { EyeApiError, type EyeIntent, type EyeSubmitResult } from './api';
import { EYE_FINGER_ENABLED } from './config';
import { isFingerCancel } from './finger';
import { intentFresh, runMove, stepFor, type MoveKind, type MoveResume, type MoveStage, type MoveStep } from './move';
import { BEAT_MS, Stepper, keyFingerprint, shorten, usePaced, type Failure, type StepModel } from './Stepper';
import { epochMs } from './time';
import { PortalEye } from './PortalEye';
import { ritual } from '../sound';

// The sheet that shows a move as it happens: opening the Eye, or one Blink.
//
// It rises over the panel the moment the button is pressed and runs the move
// itself (move.ts), turning one ring at a time: Finger, Wallet, Network, and
// for an open, Eye opens. Each step says in one line what the phone is doing
// right now, and shows what came back once it is done: the key that signed,
// the wallet's approval, the transaction's signature, the Eye's name. When
// the last step has landed the sheet hands back to the panel, which parts
// the lids or blinks them; the sheet is gone before the lids move.
//
// A failure lands on the step it happened in, in the words of whoever
// refused: the server, the wallet, or the phone. Try again picks the move up
// where it stopped when that is possible (move.ts says when); Not now closes
// the sheet. The wallet closed or the finger came off the prompt is not a
// failure: the step stops, amber, and says so without a red line.

type Key = MoveStep | 'eye';
type Sub = 'challenge' | 'finger' | 'intent' | 'wallet';

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
  if (error instanceof EyeApiError) return { title: error.message, body: null, detail: error.code };
  return { title: error instanceof Error && error.message ? error.message : t('The Eye service did not answer'), body: null, detail: null };
}

export function MoveSheet({ kind, wallet, onDone, onClose }: { kind: MoveKind; wallet: string; onDone: (result: EyeSubmitResult) => void; onClose: () => void }) {
  const reduced = useReducedMotion();
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
  const [p256, setP256] = useState<string | null>(null);
  const [intent, setIntent] = useState<EyeIntent | null>(null);
  const [signed, setSigned] = useState<string | null>(null);
  const [result, setResult] = useState<EyeSubmitResult | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  // The Eye on top of the sheet: shut until an open lands, blinking when a
  // Blink does.
  const [eyeOpen, setEyeOpen] = useState(kind === 'blink');
  const [eyeBlink, setEyeBlink] = useState(0);
  // Each run has its own ticket; an unmount moves it on and drops the answer.
  const ticket = useRef(0);
  const stage = useRef<MoveStage['stage'] | null>(null);
  // Whether the last failure was the network between us and the server,
  // rather than the server's own no: only then may the same bytes go again.
  const transport = useRef(false);
  // The panel's callbacks, always the latest ones, read through a ref so
  // the panel redrawing around the sheet (its clock ticks once a second)
  // never restarts the move.
  const handlers = useRef({ onDone, onClose });
  handlers.current = { onDone, onClose };

  const run = useCallback(async (resume: MoveResume | null) => {
    ticket.current += 1;
    const mine = ticket.current;
    paced.clear();
    setFailure(null);
    setFailedAt(-1);
    setStopped(false);
    setResult(null);
    const from: Key = resume ? (resume.signed ? 'network' : 'wallet') : keys[0] ?? 'wallet';
    setDone(idx(from));
    setActive(idx(from));
    setSub(resume ? 'wallet' : finger ? 'challenge' : 'intent');
    stage.current = resume ? (resume.signed ? 'network' : 'wallet') : null;

    const push = (fn: () => void) => paced.push(() => { if (mine === ticket.current) fn(); });
    const onStage = (event: MoveStage) => {
      if (mine !== ticket.current) return;
      stage.current = event.stage;
      switch (event.stage) {
        case 'challenge':
          push(() => { setActive(idx('finger')); setSub('challenge'); });
          break;
        case 'finger':
          push(() => setSub('finger'));
          break;
        case 'signed': {
          const key = event.p256;
          push(() => { setP256(key); setDone(idx('finger') + 1); buzz(); });
          push(() => { setActive(idx('wallet')); setSub('intent'); });
          break;
        }
        case 'intent':
          if (!finger) push(() => { setActive(idx('wallet')); setSub('intent'); });
          break;
        case 'wallet': {
          const built = event.intent;
          push(() => { setIntent(built); setSub('wallet'); });
          break;
        }
        case 'network': {
          const { intent: built, signed: bytes } = event;
          push(() => { setIntent(built); setSigned(bytes); setDone(idx('wallet') + 1); buzz(); });
          push(() => setActive(idx('network')));
          break;
        }
      }
    };

    try {
      const answer = await runMove(kind, wallet, onStage, resume);
      if (mine !== ticket.current) return;
      push(() => { setResult(answer); setDone(idx('network') + 1); buzz(); });
      if (kind === 'open') {
        push(() => { setActive(idx('eye')); ritual('heart', 0.5); });
        push(() => { setDone(keys.length); setActive(-1); setEyeOpen(true); thud(); });
        // A beat to watch the lids part before the sheet gives way.
        push(() => undefined);
        push(() => undefined);
      } else {
        push(() => { setActive(-1); setEyeBlink((count) => count + 1); });
      }
      // The lids are the panel's to move; the sheet is gone before they do.
      push(() => handlers.current.onDone(answer));
    } catch (caught) {
      if (mine !== ticket.current) return;
      let step = stepFor(stage.current);
      if (step === 'finger' && !finger) step = 'wallet';
      const quiet = isWalletCancel(caught) || isFingerCancel(caught);
      transport.current = !(caught instanceof EyeApiError);
      const told: Failure = quiet
        ? { title: step === 'finger' ? t('The fingerprint prompt was closed') : t('The wallet request was cancelled'), body: null, detail: null }
        : describe(caught);
      push(() => {
        setFailure(told);
        setFailedAt(idx(step));
        setStopped(quiet);
        setActive(-1);
        if (!quiet) buzz();
      });
    }
  }, [kind, wallet, finger, keys, idx, paced]);

  useEffect(() => {
    void run(null);
    return () => { ticket.current += 1; };
  }, [run]);

  // Where the retry starts from: the wallet again with the same transaction
  // while it is still good; the same signed bytes again when only the network
  // between us and the server gave out; otherwise from the top.
  const retry = useCallback(() => {
    const step = keys[failedAt];
    let resume: MoveResume | null = null;
    if (step === 'wallet' && intent && intentFresh(intent)) resume = { intent, signed: null };
    else if (step === 'network' && intent && signed && transport.current && intentFresh(intent)) resume = { intent, signed };
    void run(resume);
  }, [keys, failedAt, intent, signed, run]);

  const idle = failedAt >= 0;
  const statusOf = (key: Key): StepModel['status'] => {
    const at = idx(key);
    if (failedAt === at) return stopped ? 'stopped' : 'failed';
    if (done > at) return 'done';
    return active === at ? 'working' : 'pending';
  };

  const steps: StepModel[] = [];
  if (finger) {
    steps.push({
      key: 'finger',
      title: t('Finger'),
      copy: sub === 'challenge' ? t('Asking the Eye service for a one-time challenge.') : t("Touch the sensor: the key in your Seeker's secure chip signs the challenge."),
      status: statusOf('finger'),
      failure,
      result: p256 ? (
        <>
          <Text style={styles.mono}>{keyFingerprint(p256)}</Text>
          <Text style={styles.line}>{t('Signed with your finger')}</Text>
        </>
      ) : null,
    });
  }
  steps.push({
    key: 'wallet',
    title: t('Wallet'),
    copy: sub === 'wallet' ? t('Approve the transaction in your Seeker wallet.') : t('Asking the Eye service for the transaction.'),
    status: statusOf('wallet'),
    failure,
    result: <Text style={styles.line}>{t('Approved in the wallet')}</Text>,
  });
  steps.push({
    key: 'network',
    title: t('Network'),
    copy: t('Sending the transaction to Solana and waiting for it to confirm.'),
    status: statusOf('network'),
    failure,
    result: result ? (
      <>
        <Text style={styles.mono}>{shorten(result.signature, 8)}</Text>
        <Text style={styles.line}>{t('Confirmed on Solana')}</Text>
      </>
    ) : null,
  });
  if (kind === 'open') {
    steps.push({
      key: 'eye',
      title: t('Eye opens'),
      copy: t('Your Eye is about to open.'),
      status: statusOf('eye'),
      failure,
      result: result ? <Text style={styles.serial}>{result.eye.name}</Text> : null,
    });
  }

  return (
    <Modal transparent statusBarTranslucent animationType="fade" visible onRequestClose={() => { if (idle) onClose(); }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.backdrop} onPress={() => { if (idle) onClose(); }} />
      <View style={styles.sheet}>
        <View style={styles.grip} />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.eyeTop}>
            <PortalEye size={120} open={eyeOpen} blink={eyeBlink} instant={reduced} />
          </View>
          <Stepper steps={steps} reduced={reduced} eyebrow={kind === 'open' ? t('Open your Eye') : t('Blink')} />
          {idle ? (
            <View style={styles.actions}>
              <Button label={t('Try again')} onPress={retry} ghost />
              <Button label={t('Not now')} onPress={onClose} quiet />
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(2, 4, 7, 0.72)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '88%', backgroundColor: colors.panel, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderWidth: 1, borderColor: '#111B24', paddingTop: spacing.sm },
  grip: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong, marginBottom: spacing.sm },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  actions: { gap: spacing.sm, marginTop: spacing.xs },
  eyeTop: { alignItems: 'center', marginBottom: -spacing.xs },
  line: { color: colors.muted, fontFamily: font.regular, ...type.small },
  mono: { color: colors.text, fontFamily: font.mono, ...type.small, letterSpacing: 0.3 },
  serial: { color: colors.metal, fontFamily: font.monoBold, fontSize: 12, letterSpacing: 0.8 },
});
