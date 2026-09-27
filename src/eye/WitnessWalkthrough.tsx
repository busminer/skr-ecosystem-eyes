import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { lang, t } from '../i18n';
import { prefValue } from '../prefs';
import { useReducedMotion } from '../useReducedMotion';
import { Button, Eyebrow, Panel, Pill } from '../lab/kit';
import { colors, font, radius, spacing, type } from '../theme';
import { getSeekerWitness, WITNESS_ERROR } from '../../modules/seeker-witness';
import { ensureWitness } from './finger';
import { readWitness, WitnessError, type WitnessRecord } from './witness';

// Verifying the Seeker, as something a person is walked through rather than
// something that happens to them.
//
// Modelled on SEEKIN's joining screen. One button starts it; what comes back
// is not a verdict but four things, shown as objects and each given one
// sentence: the phone Google's certificate names, the key that was born in
// its vault, the Genesis Token found in the wallet, the attestor's signature
// under all of it. The cards land one after another, each with a small buzz
// that arrives with the card and not before it, at a pace the words can be
// read. Then the one button that matters, and the person presses it
// themselves. Nothing here is mounted by this file: the Eyes tab shows it
// before the first open when EYE_FINGER_ENABLED is on, and only when
// getWitnessState says the phone has not been through it yet.
//
// A refusal is a card too, calm and in the attestor's own words. Not a
// Seeker, no fingerprint enrolled, or a reason we did not foresee: the person
// is told what was read and what to do, and is never scolded for a phone.

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

const CARDS = 4;
// Slower than SEEKIN's 220 ms check rows: each card here is a title and two
// lines, and a card that lands before the last one was read is noise.
const LAND_MS = 900;

type Phase = 'intro' | 'working' | 'landing' | 'failed';
type Failure = { title: string; body: string | null; detail: string | null };

const shorten = (value: string, edge = 6) => (value.length > edge * 2 + 1 ? `${value.slice(0, edge)}…${value.slice(-edge)}` : value);

// The key as a fingerprint a person can compare by eye: first and last four
// pairs of the compressed point, grouped in fours.
function keyFingerprint(p256: string): string {
  const hex = p256.toLowerCase();
  return `${hex.slice(0, 4)} ${hex.slice(4, 8)} ${hex.slice(8, 12)} … ${hex.slice(-12, -8)} ${hex.slice(-8, -4)} ${hex.slice(-4)}`;
}

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
  if (prefValue('buzz', true)) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

// What went wrong, in words the person can act on. The attestor's own reason
// is kept underneath in mono, because it is the thing that was actually said.
function describe(error: unknown): Failure {
  if (error instanceof WitnessError) {
    if (error.code === WITNESS_ERROR.NO_BIOMETRICS) {
      return { title: error.message, body: t('The key signs only with a fingerprint, so the phone needs one enrolled before the key can be born.'), detail: null };
    }
    if (error.code === 'E_ATTESTOR_REJECTED' && error.detail && /seeker/i.test(error.detail)) {
      return { title: t('This phone is not a Seeker'), body: t("The attestor read the phone's own certificate, and it does not name a Seeker. An Eye opens only on a Seeker."), detail: error.detail };
    }
    return { title: error.message, body: null, detail: error.detail };
  }
  return { title: error instanceof Error && error.message ? error.message : t('The attestor did not answer'), body: null, detail: null };
}

export function WitnessWalkthrough({ wallet, onVerified, onCancel }: { wallet: string; onVerified: (record: WitnessRecord) => void; onCancel: () => void }) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('intro');
  const [record, setRecord] = useState<WitnessRecord | null>(null);
  const [already, setAlready] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [landed, setLanded] = useState(0);
  const [ready, setReady] = useState(false);
  // A wallet change or an unmount under a running verification drops its answer.
  const ticket = useRef(0);

  // A phone that has been through this once shows what it has, not the intro.
  useEffect(() => {
    ticket.current += 1;
    const mine = ticket.current;
    setPhase('intro');
    setRecord(null);
    setAlready(false);
    setFailure(null);
    void getWitnessState(wallet).then((state) => {
      if (mine !== ticket.current || state.kind !== 'verified') return;
      setAlready(true);
      setRecord(state.record);
      setPhase('landing');
    });
    return () => { ticket.current += 1; };
  }, [wallet]);

  const verify = useCallback(async () => {
    const mine = ticket.current;
    setPhase('working');
    setFailure(null);
    try {
      const next = await ensureWitness(wallet);
      if (mine !== ticket.current) return;
      setAlready(false);
      setRecord(next);
      setPhase('landing');
    } catch (caught) {
      if (mine !== ticket.current) return;
      setFailure(describe(caught));
      setPhase('failed');
      // One soft pulse, once. A refusal is information, not a telling-off.
      buzz();
    }
  }, [wallet]);

  // The cards land one after another, and the buzz lands with each card.
  useEffect(() => {
    if (phase !== 'landing' || !record) return;
    if (reduced) {
      setLanded(CARDS);
      setReady(true);
      buzz();
      return;
    }
    setLanded(0);
    setReady(false);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= CARDS; i += 1) {
      timers.push(setTimeout(() => { setLanded(i); buzz(); }, 200 + (i - 1) * LAND_MS));
    }
    timers.push(setTimeout(() => setReady(true), 200 + CARDS * LAND_MS));
    return () => timers.forEach(clearTimeout);
  }, [phase, record, reduced]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Eyebrow>{t('Your Eye')}</Eyebrow>
      <Text style={styles.title}>{phase === 'landing' && record ? t('Device verified') : t('Verify this Seeker')}</Text>

      {phase === 'intro' ? (
        <>
          <Text style={styles.body}>{t('Before your Eye opens, this phone proves itself once: that it is a Seeker, that it holds a key only your finger can use, and that your wallet holds a Seeker Genesis Token.')}</Text>
          <Text style={styles.body}>{t("Google's certificate does the proving, not this app. Nothing leaves your wallet.")}</Text>
          <View style={styles.actions}>
            <Button label={t('Verify')} onPress={() => void verify()} hero />
            <Button label={t('Not now')} onPress={onCancel} quiet />
          </View>
        </>
      ) : null}

      {phase === 'working' ? (
        <Panel style={styles.card}>
          <View style={styles.working}>
            <ActivityIndicator size="small" color={colors.faint} />
            <Text style={styles.line}>{t('Verifying…')}</Text>
          </View>
        </Panel>
      ) : null}

      {phase === 'failed' && failure ? (
        <>
          <Panel style={styles.card} tone={colors.negative}>
            <Text style={styles.cardTitle}>{failure.title}</Text>
            {failure.body ? <Text style={styles.line}>{failure.body}</Text> : null}
            {failure.detail ? <Text style={styles.mono}>{failure.detail}</Text> : null}
          </Panel>
          <View style={styles.actions}>
            <Button label={t('Try again')} onPress={() => void verify()} ghost />
            <Button label={t('Not now')} onPress={onCancel} quiet />
          </View>
        </>
      ) : null}

      {phase === 'landing' && record ? (
        <>
          {already ? <Text style={styles.note}>{t('Already verified on this phone.')}</Text> : null}

          {landed >= 1 ? (
            <Card step={1} title={t('This is a Seeker')}>
              <Text style={styles.mono}>{[record.checks.manufacturer ?? record.checks.brand, record.checks.model].filter(Boolean).join(' · ')}</Text>
              {record.checks.chainLength != null ? <Text style={styles.line}>{t('{count} certificates, up to a Google root', { count: record.checks.chainLength })}</Text> : null}
              {record.checks.deviceLocked && record.checks.verifiedBootState === 'Verified' ? <Text style={styles.line}>{t('Verified boot, bootloader locked')}</Text> : null}
            </Card>
          ) : null}

          {landed >= 2 ? (
            <Card step={2} title={t("A key was born in the phone's vault")}>
              <Text style={styles.mono}>{keyFingerprint(record.p256)}</Text>
              <Text style={styles.line}>{t('It signs only with your finger.')}</Text>
              <View style={styles.pills}>
                <Pill label={record.strongBox ? 'StrongBox' : 'TEE'} tone={colors.accent} />
                <Pill label={t('Finger-bound')} tone={colors.positive} />
              </View>
            </Card>
          ) : null}

          {landed >= 3 ? (
            <Card step={3} title={t('Your Seeker Genesis Token')}>
              <Text style={styles.mono}>{shorten(record.attestation.sgt_mint)}</Text>
              <Text style={styles.line}>{t('Found in your wallet')}</Text>
              <Text style={styles.monoDim}>{shorten(wallet)}</Text>
            </Card>
          ) : null}

          {landed >= 4 ? (
            <Card step={4} title={t('Device verified')}>
              <Text style={styles.line}>{t('Signed by the attestor at {time}', { time: when(record.attestation.verified_at) })}</Text>
              <Text style={styles.monoDim}>{`${shorten(record.attestation.attestor)} · ${shorten(record.attestation.attestor_sig, 8)}`}</Text>
            </Card>
          ) : null}

          {ready ? (
            <Animated.View entering={FadeInDown.duration(320)} style={styles.actions}>
              <Button label={t('Open my Eye')} onPress={() => onVerified(record)} hero />
              <Button label={t('Not now')} onPress={onCancel} quiet />
            </Animated.View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

// The thing that was made, shown as an object rather than described.
function Card({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <Animated.View entering={FadeInDown.duration(360)}>
      <Panel style={styles.card}>
        <Eyebrow>{t('Step {step} of {total}', { step, total: CARDS })}</Eyebrow>
        <Text style={styles.cardTitle}>{title}</Text>
        {children}
      </Panel>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.md },
  title: { color: colors.text, fontFamily: font.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.5 },
  body: { color: colors.muted, fontFamily: font.regular, ...type.body },
  note: { color: colors.faint, fontFamily: font.regular, ...type.small },
  card: { padding: spacing.md, gap: spacing.sm },
  cardTitle: { color: colors.text, fontFamily: font.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.3 },
  line: { color: colors.muted, fontFamily: font.regular, ...type.small },
  mono: { color: colors.text, fontFamily: font.mono, ...type.small, letterSpacing: 0.3 },
  monoDim: { color: colors.faint, fontFamily: font.mono, ...type.micro, letterSpacing: 0.3 },
  pills: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  working: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 28 },
  actions: { gap: spacing.sm, marginTop: spacing.sm, borderRadius: radius.card },
});
