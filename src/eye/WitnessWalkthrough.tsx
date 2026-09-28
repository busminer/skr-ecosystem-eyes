import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { lang, t } from '../i18n';
import { useReducedMotion } from '../useReducedMotion';
import { Button, Panel, Pill } from '../lab/kit';
import { colors, font, radius, spacing } from '../theme';
import { getSeekerWitness, WITNESS_ERROR } from '../../modules/seeker-witness';
import { ensureWitness, isFingerCancel } from './finger';
import { fontScale } from './fit';
import { Overline } from './glyphs';
import { readWitness, WitnessError, type WitnessRecord, type WitnessStage } from './witness';
import { BEAT_MS, Stepper, keyFingerprint, shorten, usePaced, type Failure, type StepModel } from './Stepper';
import { PortalEye } from './PortalEye';
import { ritual } from '../sound';

// Verifying the Seeker, as something a person is walked through rather than
// something that happens to them.
//
// One button starts it; what follows is four steps, one on screen at a time
// (Stepper.tsx), each saying in one line what the phone is doing while it
// does it, and each saying what it found the moment it is done: the key born
// in the StrongBox secure element, the phone Google's certificate names, the
// Genesis Token in the wallet, the attestor's signature under all of it.
// After each finished step a Next button, and the person moves on when they
// have read it. Then the one button that matters, and the person presses it
// themselves.
//
// The steps are turned by the enrollment itself (`WitnessStage` from
// witness.ts), never by a clock alone, and the enrollment waits where the
// person reads: after the key is born, before Google's chain goes to the
// attestor (the attestor's challenge is good for ten minutes, so a read is
// safe, and a much longer wait is refused by the attestor and shown as a
// plain failure with Try again); and after the attestor's verdict, before it
// is handed to the Eye service (the verdict is kept on the phone and the
// hand-over can be repeated, so this wait is safe for as long as it takes).
// The verdict carries the Seeker's facts and the Genesis Token in one
// answer, so steps two and three are read from it one after the other, each
// on its own card. Every call and its order is exactly as before.
//
// Nothing here is mounted by this file: the Eyes tab shows it before the
// first open when EYE_FINGER_ENABLED is on, and only when getWitnessState
// says the phone has not been through it yet.
//
// A refusal lands on the step it happened in, calm and in the attestor's own
// words; the steps after it stay as they were, still to come. Not a Seeker,
// no fingerprint enrolled, or a reason we did not foresee: the person is told
// what was read and what to do, and is never scolded for a phone.

export type WitnessState =
  // Not Android, or a build without the module: the Eye works unwitnessed.
  | { kind: 'unavailable' }
  // Never verified on this phone, or the key is gone (new fingerprint, reinstall).
  | { kind: 'none' }
  | { kind: 'verified'; record: WitnessRecord };

export async function getWitnessState(wallet: string): Promise<WitnessState> {
  const module = getSeekerWitness();
  if (!module) return { kind: 'unavailable' };
  const record = await readWitness(wallet);
  if (!record) return { kind: 'none' };
  const present = await module.hasKey().catch(() => false);
  return present ? { kind: 'verified', record } : { kind: 'none' };
}

const STEPS = 4;

type Phase = 'intro' | 'running' | 'landing' | 'failed';
// What the first step shows: known from the module the moment the key is
// born, and again from the record on an already-verified phone.
type BornKey = { p256: string; strongBox: boolean };
type Gate = { resolve: () => void; reject: (error: Error) => void };

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return date.toLocaleString(lang(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}

function buzz() {
  ritual('chime', 0.3);
}

// What went wrong, in words the person can act on. The attestor's own reason
// is kept underneath in mono, because it is the thing that was actually said.
function describe(error: unknown): Failure {
  if (error instanceof WitnessError) {
    if (error.code === WITNESS_ERROR.NO_BIOMETRICS) {
      return { title: error.message, body: t('The key signs only with a fingerprint, so the phone needs one enrolled before the key can be born.'), detail: null };
    }
    if (error.code === 'E_ATTESTOR_REJECTED' && error.detail && /seeker/i.test(error.detail)) {
      return { title: t('This phone is not a Seeker'), body: t("The attestor read the phone's own certificate, and it does not name a Seeker. An Eye opens only on a Solana Mobile Seeker."), detail: error.detail };
    }
    return { title: error.message, body: null, detail: error.detail };
  }
  return { title: error instanceof Error && error.message ? error.message : t('The attestor did not answer'), body: null, detail: null };
}

// Which step a failure belongs to, from the last stage the enrollment
// announced. Nothing announced: the module itself is missing, and no step had
// started. After the verdict: the hand-over to the Eye service, which is the
// fourth step's to report.
function stepFor(stage: WitnessStage['stage'] | null): number {
  if (stage === null) return 0;
  if (stage === 'challenge' || stage === 'vault') return 1;
  if (stage === 'key') return 2;
  return 4;
}

export function WitnessWalkthrough({ wallet, onVerified, onCancel }: { wallet: string; onVerified: (record: WitnessRecord) => void; onCancel: () => void }) {
  const reduced = useReducedMotion();
  const paced = usePaced(reduced ? 0 : BEAT_MS);
  const [phase, setPhase] = useState<Phase>('intro');
  // Steps 1..done are done; `active` is the one turning, 0 for none.
  const [done, setDone] = useState(0);
  const [active, setActive] = useState(0);
  // The step the failure is shown in; 0 is before any step.
  const [failedAt, setFailedAt] = useState(0);
  // The step on screen, 0-based. It follows the work, and the person moves it on.
  const [current, setCurrent] = useState(0);
  // Where the enrollment is being held for the person to read.
  const [held, setHeld] = useState<'key' | 'verdict' | null>(null);
  // The first step has two moments: the attestor's challenge, then the key.
  const [sub, setSub] = useState<'challenge' | 'vault'>('challenge');
  const [key, setKey] = useState<BornKey | null>(null);
  const [record, setRecord] = useState<WitnessRecord | null>(null);
  const [already, setAlready] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [ready, setReady] = useState(false);
  // A wallet change or an unmount under a running verification drops its answer.
  const ticket = useRef(0);
  // The last stage the running enrollment announced.
  const stage = useRef<WitnessStage['stage'] | null>(null);
  const gate = useRef<Gate | null>(null);

  // Lets a held enrollment go with a refusal nobody will show: whoever is
  // waiting on it has a ticket that no longer matches.
  const dropGate = useCallback(() => {
    const waiting = gate.current;
    gate.current = null;
    waiting?.reject(new Error('closed'));
  }, []);

  const reset = useCallback(() => {
    setPhase('intro');
    setDone(0);
    setActive(0);
    setFailedAt(0);
    setCurrent(0);
    setHeld(null);
    setSub('challenge');
    setKey(null);
    setRecord(null);
    setAlready(false);
    setFailure(null);
    setReady(false);
    stage.current = null;
  }, []);

  // A phone that has been through this once shows what it has, not the intro:
  // the last step, settled, with the button.
  useEffect(() => {
    ticket.current += 1;
    const mine = ticket.current;
    paced.clear();
    dropGate();
    reset();
    void getWitnessState(wallet).then((state) => {
      if (mine !== ticket.current || state.kind !== 'verified') return;
      setAlready(true);
      setRecord(state.record);
      setKey({ p256: state.record.p256, strongBox: state.record.strongBox });
      setDone(STEPS);
      setCurrent(STEPS - 1);
      setReady(true);
      setPhase('landing');
      buzz();
    });
    return () => { ticket.current += 1; paced.clear(); dropGate(); };
  }, [wallet, paced, reset, dropGate]);

  const verify = useCallback(async () => {
    const mine = ticket.current;
    paced.clear();
    // Trying again after the Eye service refused the hand-over: the attestor's
    // three answers stand, so their steps stay and only the fourth turns.
    const resume = phase === 'failed' && failedAt === STEPS && record !== null;
    setPhase('running');
    setFailure(null);
    setFailedAt(0);
    setReady(false);
    setAlready(false);
    setHeld(null);
    if (resume) {
      setDone(3);
      setActive(4);
      setCurrent(3);
      stage.current = 'verdict';
    } else {
      setDone(0);
      setActive(0);
      setCurrent(0);
      setKey(null);
      setRecord(null);
      setSub('challenge');
      stage.current = null;
    }

    const push = (fn: () => void) => paced.push(() => { if (mine === ticket.current) fn(); });
    const onStage = (event: WitnessStage): void | Promise<void> => {
      if (mine !== ticket.current) return;
      stage.current = event.stage;
      switch (event.stage) {
        case 'challenge':
          // A fresh key is on its way: whatever stood before is superseded,
          // and the checks start again from the first.
          push(() => { setKey(null); setRecord(null); setDone(0); setSub('challenge'); setActive(1); setCurrent(0); });
          return;
        case 'vault':
          push(() => setSub('vault'));
          return;
        case 'key': {
          // The key is born. The enrollment waits here until the person has
          // read the card; then Google's chain goes to the attestor.
          const born: BornKey = { p256: event.created.p256Compressed, strongBox: event.created.strongBox };
          push(() => { setKey(born); setDone(1); setActive(0); buzz(); setHeld('key'); });
          return new Promise<void>((resolve, reject) => { gate.current = { resolve, reject }; });
        }
        case 'verdict': {
          // The attestor read the phone and found the Genesis Token in one
          // answer. Steps two and three are read from it, each on its own
          // card, and the hand-over to the Eye service waits for the person.
          const found = event.record;
          push(() => { setRecord(found); setDone(3); setActive(0); buzz(); setHeld('verdict'); });
          return new Promise<void>((resolve, reject) => { gate.current = { resolve, reject }; });
        }
      }
    };

    try {
      const next = await ensureWitness(wallet, onStage);
      if (mine !== ticket.current) return;
      push(() => {
        setRecord(next);
        setKey({ p256: next.p256, strongBox: next.strongBox });
        setDone(STEPS);
        setActive(0);
        setCurrent(STEPS - 1);
        setPhase('landing');
        buzz();
      });
      push(() => setReady(true));
    } catch (caught) {
      if (mine !== ticket.current) return;
      // The finger came off a prompt: nothing went wrong, so nothing is said.
      if (isFingerCancel(caught)) { paced.clear(); reset(); return; }
      const at = stepFor(stage.current);
      const told = describe(caught);
      push(() => {
        setFailure(told);
        setFailedAt(at);
        setCurrent(Math.max(0, at - 1));
        setActive(0);
        setHeld(null);
        setPhase('failed');
        // One soft pulse, once. A refusal is information, not a telling-off.
        buzz();
      });
    }
  }, [wallet, phase, failedAt, record, paced, reset]);

  // The person has read the card and taps on. After the key: let Google's
  // chain go to the attestor. After the verdict: the Genesis Token card
  // first, then the hand-over to the Eye service.
  const proceed = useCallback(() => {
    if (held === 'key') {
      const waiting = gate.current;
      gate.current = null;
      setHeld(null);
      setCurrent(1);
      setActive(2);
      waiting?.resolve();
      return;
    }
    if (held === 'verdict') {
      if (current < 2) { setCurrent(2); return; }
      const waiting = gate.current;
      gate.current = null;
      setHeld(null);
      setCurrent(3);
      setActive(4);
      waiting?.resolve();
    }
  }, [held, current]);

  const cancel = useCallback(() => {
    ticket.current += 1;
    dropGate();
    onCancel();
  }, [dropGate, onCancel]);

  const statusOf = (step: number): StepModel['status'] => {
    if (failedAt === step) return 'failed';
    if (done >= step) return 'done';
    return active === step ? 'working' : 'pending';
  };
  const checks = record?.checks ?? null;

  const steps: StepModel[] = [
    {
      key: 'vault',
      icon: 'key',
      name: t('Vault key'),
      doing: sub === 'challenge'
        ? t('Asking the attestor for a one-time challenge.')
        : t("Asking your Solana Mobile Seeker's StrongBox secure element for a new key. It will answer only to your fingerprint."),
      done: t('A key was born in the StrongBox secure element. It signs only with your fingerprint.'),
      status: statusOf(1),
      failure,
      result: key ? (
        <>
          <Text style={styles.mono}>{keyFingerprint(key.p256)}</Text>
          <View style={styles.pills}>
            <Pill label={key.strongBox ? 'StrongBox' : 'TEE'} tone={colors.accent} />
            <Pill label={t('Fingerprint-bound')} tone={colors.positive} />
          </View>
        </>
      ) : null,
    },
    {
      key: 'seeker',
      icon: 'cert',
      name: t('Seeker'),
      doing: t("Sending Google's certificate chain to the attestor. It checks the secure element, the bootloader and this app."),
      done: t('This is a Solana Mobile Seeker.'),
      status: statusOf(2),
      failure,
      result: checks ? (
        <>
          <Text style={styles.mono}>{[checks.manufacturer ?? checks.brand, checks.model].filter(Boolean).join(' ')}</Text>
          {checks.chainLength != null ? <Text style={styles.line}>{t('{count} certificates, up to a Google root', { count: checks.chainLength })}</Text> : null}
          {checks.deviceLocked && checks.verifiedBootState === 'Verified' ? <Text style={styles.line}>{t('Verified boot, bootloader locked')}</Text> : null}
        </>
      ) : null,
    },
    {
      key: 'sgt',
      icon: 'token',
      name: t('Genesis Token'),
      doing: t('Looking for the Seeker Genesis Token in your wallet.'),
      done: t('Your Seeker Genesis Token is in this wallet.'),
      status: statusOf(3),
      failure,
      result: record ? (
        <>
          <Text style={styles.mono}>{shorten(record.attestation.sgt_mint)}</Text>
          <Text style={styles.line}>{t('The token, and the wallet that holds it')}</Text>
          <Text style={styles.monoDim}>{shorten(wallet)}</Text>
        </>
      ) : null,
    },
    {
      key: 'verdict',
      icon: 'check',
      name: t('Verified'),
      doing: t('The attestor signed its verdict. Handing it to the Eye service.'),
      done: t('Device verified. The Eye service knows this phone now.'),
      status: statusOf(4),
      failure,
      result: record ? (
        <>
          <Text style={styles.line}>{t('Signed by the attestor at {time}', { time: when(record.attestation.verified_at) })}</Text>
          <Text style={styles.monoDim}>{shorten(record.attestation.attestor)}</Text>
          <Text style={styles.monoDim}>{shorten(record.attestation.attestor_sig, 8)}</Text>
        </>
      ) : null,
    },
  ];

  let action: ReactNode = null;
  if (phase === 'intro') {
    action = (
      <>
        <Button label={t('Verify')} onPress={() => void verify()} hero />
        <Button label={t('Not now')} onPress={cancel} quiet />
      </>
    );
  } else if (phase === 'failed') {
    action = (
      <>
        <Button label={t('Try again')} onPress={() => void verify()} ghost />
        <Button label={t('Not now')} onPress={cancel} quiet />
      </>
    );
  } else if (held) {
    action = <Button label={t('Next')} onPress={proceed} hero />;
  } else if (phase === 'landing' && record && ready) {
    action = (
      <>
        <Button label={t('Open my Eye')} onPress={() => onVerified(record)} hero />
        <Button label={t('Not now')} onPress={cancel} quiet />
      </>
    );
  }

  const eye = Math.round(120 / Math.pow(fontScale(), 0.5));
  return (
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.eyeTop}>
          <PortalEye size={eye} open={false} instant />
        </View>
        <Overline>{t('Verify my Seeker')}</Overline>
        <Text maxFontSizeMultiplier={1.3} style={styles.title}>{phase === 'landing' && record ? t('Device verified') : t('Verify this Solana Mobile Seeker')}</Text>

        {phase === 'intro' ? (
          <>
            <Text style={styles.body}>{t('Before your Eye opens, this phone proves itself once. It shows that it is a Solana Mobile Seeker, that it holds a key only your fingerprint can use, and that your wallet holds a Seeker Genesis Token.')}</Text>
            <Text style={styles.body}>{t("Google's certificate does the proving, not this app. Nothing leaves your wallet.")}</Text>
          </>
        ) : null}

        {already && phase === 'landing' ? <Text style={styles.note}>{t('Already verified on this phone.')}</Text> : null}

        {phase !== 'intro' ? <Stepper steps={steps} current={current} reduced={reduced} /> : null}

        {/* A failure before any step: the module itself is missing from this build. */}
        {phase === 'failed' && failedAt === 0 && failure ? (
          <Panel style={styles.card} tone={colors.negative}>
            <Text style={styles.cardTitle}>{failure.title}</Text>
            {failure.body ? <Text style={styles.line}>{failure.body}</Text> : null}
            {failure.detail ? <Text style={styles.mono}>{failure.detail}</Text> : null}
          </Panel>
        ) : null}
      </ScrollView>
      {/* The buttons stay under the words, never behind them. */}
      {action ? <View style={styles.actions}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  title: { color: colors.text, fontFamily: font.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.5 },
  body: { color: colors.muted, fontFamily: font.regular, fontSize: 15.5, lineHeight: 23 },
  note: { color: colors.faint, fontFamily: font.regular, fontSize: 14, lineHeight: 20 },
  card: { padding: spacing.md, gap: spacing.sm },
  cardTitle: { color: colors.text, fontFamily: font.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.3 },
  line: { color: colors.muted, fontFamily: font.regular, fontSize: 14.5, lineHeight: 21 },
  mono: { color: colors.text, fontFamily: font.mono, fontSize: 13, lineHeight: 19, letterSpacing: 0.3 },
  monoDim: { color: colors.faint, fontFamily: font.mono, fontSize: 12, lineHeight: 17, letterSpacing: 0.3 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  actions: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, borderRadius: radius.card },
  eyeTop: { alignItems: 'center', marginTop: spacing.sm },
});
