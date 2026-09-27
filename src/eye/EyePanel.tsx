import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { t } from '../i18n';
import { isWalletCancel, signTransactionBase64 } from '../mwa';
import { Button, Eyebrow, Panel } from '../lab/kit';
import { colors, font, radius, spacing, type } from '../theme';
import { blinkEye, eyeImageUrl, fetchEyeStatus, openEye, submitEye, type EyeStatus } from './api';

// Your Eye, under the card on Me.
//
// Three states and nothing hidden between them: no wallet, so one line; a
// wallet with no Eye, so the price and the one button that opens it; an Eye,
// so its picture, its streak, the clock to the next Blink and the button that
// blinks. Each move is the same three steps — the server builds a
// transaction, the wallet signs it, the server submits it — and the panel
// re-reads its status afterwards rather than guessing at what changed.

// Lamports to SOL, three places: the prices are small round numbers and a
// nine-digit tail would only hide them.
const sol = (lamports: number) => (lamports / 1_000_000_000).toFixed(3);

// The server says when the window opens and closes. Whether it says it as an
// ISO string, epoch seconds or epoch millis is not this screen's business.
function epochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1_000 : value;
  if (typeof value === 'string' && value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1_000 : numeric;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

// HH:MM:SS, hours left to grow past 24 rather than folded into days: the
// window is daily, so the number is never large and a "1d" would read as an
// error beside the seconds ticking under it.
function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1_000));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

export function EyePanel({ wallet }: { wallet: string | null }) {
  const [status, setStatus] = useState<EyeStatus | null>(null);
  const [reading, setReading] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const [busy, setBusy] = useState<'open' | 'blink' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Disconnect or a change of wallet moves the ticket on, and an answer that
  // set out for the old wallet is dropped when it lands.
  const ticket = useRef(0);
  // Whether a status has ever been drawn for this wallet. A status already on
  // screen outlives one missed poll; only an empty panel says the service is gone.
  const known = useRef(false);
  // The window edge the panel last re-read the status for, so the clock
  // reaching zero asks the server once and not on every tick after.
  const boundary = useRef<number | null>(null);

  const read = useCallback(async (quiet = false) => {
    if (!wallet) return;
    const mine = ticket.current;
    if (!quiet) setReading(true);
    try {
      const next = await fetchEyeStatus(wallet);
      if (mine !== ticket.current) return;
      known.current = true;
      setStatus(next);
      setUnreachable(false);
    } catch {
      if (mine !== ticket.current) return;
      if (!known.current) setUnreachable(true);
    } finally {
      if (mine === ticket.current) setReading(false);
    }
  }, [wallet]);

  // A new wallet starts from nothing: no status, no note, no error left over
  // from the last one.
  useEffect(() => {
    ticket.current += 1;
    known.current = false;
    boundary.current = null;
    setStatus(null);
    setUnreachable(false);
    setNote(null);
    setError(null);
    setBusy(null);
    void read();
  }, [read]);

  // Re-read once a minute while the app is in front, and the moment it comes back.
  useEffect(() => {
    if (!wallet) return;
    const timer = setInterval(() => { if (AppState.currentState === 'active') void read(true); }, 60_000);
    const subscription = AppState.addEventListener('change', (next) => { if (next === 'active') void read(true); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [wallet, read]);

  // The clock ticks only while there is a clock to show.
  const hasEye = Boolean(status?.eye);
  useEffect(() => {
    if (!hasEye) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [hasEye]);

  const blink = status?.blink;
  const edge = blink ? epochMs(blink.open ? blink.closesAt : blink.opensAt) : null;
  const remaining = edge != null ? edge - now : null;

  // The window opened or closed under the clock: ask the server what is true
  // now. One second of grace so the server has flipped before we ask.
  useEffect(() => {
    if (edge == null || remaining == null || remaining > -1_000 || boundary.current === edge) return;
    boundary.current = edge;
    void read(true);
  }, [edge, remaining, read]);

  const act = useCallback(async (kind: 'open' | 'blink') => {
    if (!wallet || busy) return;
    const mine = ticket.current;
    setBusy(kind);
    setError(null);
    setNote(null);
    try {
      const intent = kind === 'open' ? await openEye(wallet) : await blinkEye(wallet);
      const signed = await signTransactionBase64(intent.transaction);
      await submitEye(intent.intent, signed);
      if (mine !== ticket.current) return;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNote(kind === 'open' ? t('Your Eye is open.') : t('Blink witnessed.'));
      await read(true);
    } catch (caught) {
      if (mine !== ticket.current) return;
      // The finger came off the wallet: nothing went wrong, so nothing is said.
      if (isWalletCancel(caught)) return;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(caught instanceof Error && caught.message ? caught.message : t('The Eye service did not answer'));
    } finally {
      if (mine === ticket.current) setBusy(null);
    }
  }, [wallet, busy, read]);

  if (!wallet) {
    return (
      <Panel style={styles.panel}>
        <Eyebrow>{t('Your Eye')}</Eyebrow>
        <Text style={styles.lead}>{t('Your Eye opens once the wallet is connected.')}</Text>
      </Panel>
    );
  }

  if (!status) {
    return (
      <Panel style={styles.panel}>
        <View style={styles.head}>
          <Eyebrow>{t('Your Eye')}</Eyebrow>
          {reading ? <ActivityIndicator size="small" color={colors.faint} /> : null}
        </View>
        {unreachable ? (
          <>
            <Text style={styles.lead}>{t('Eye service unreachable')}</Text>
            <View style={styles.actions}><Button label={t('Try again')} onPress={() => void read()} disabled={reading} quiet /></View>
          </>
        ) : <Text style={styles.lead}>{t('Reading your Eye…')}</Text>}
      </Panel>
    );
  }

  const { eye, gates, prices } = status;
  const feedback = (
    <>
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {error ? <Pressable onPress={() => setError(null)}><Text style={styles.error}>{error}</Text></Pressable> : null}
    </>
  );

  if (!eye) {
    return (
      <Panel style={styles.panel}>
        <Eyebrow>{t('Your Eye')}</Eyebrow>
        <Text style={styles.title}>{t('Open your Eye')}</Text>
        <Text style={styles.line}>{t('{sol} SOL to open', { sol: sol(prices.openLamports) })}</Text>
        {gates.staked ? null : <Text style={styles.hint}>{t('Stake SKR first')}</Text>}
        <View style={styles.button}>
          <Button label={busy === 'open' ? t('Opening…') : t('Open my Eye')} onPress={() => void act('open')} disabled={!gates.staked || busy != null} />
        </View>
        {feedback}
      </Panel>
    );
  }

  const canBlink = Boolean(blink?.open && !blink.doneToday);
  const blinkLabel = busy === 'blink'
    ? t('Blinking…')
    : blink?.doneToday
      ? t('Blinked today')
      : blink?.open
        ? t('Blink')
        : t('Blink is closed');

  return (
    <Panel style={styles.panel}>
      <View style={styles.head}>
        <Eyebrow>{t('Your Eye')}</Eyebrow>
        <Text numberOfLines={1} style={styles.serial}>{eye.name}</Text>
      </View>
      <Image source={{ uri: eyeImageUrl(eye.image) }} style={styles.image} resizeMode="cover" accessibilityLabel={eye.name} />
      <Text style={styles.line}>
        {eye.blinks === 1
          ? t('Streak {streak} · 1 Blink', { streak: eye.streak })
          : t('Streak {streak} · {blinks} Blinks', { streak: eye.streak, blinks: eye.blinks })}
      </Text>
      {blink ? (
        <>
          <Text style={styles.clock}>
            {blink.open
              ? t('Blink is open · closes in {time}', { time: remaining != null ? clock(remaining) : '—' })
              : t('Next Blink in {time}', { time: remaining != null ? clock(remaining) : '—' })}
            {blink.event?.label ? <Text style={styles.event}>{`  ${blink.event.label}`}</Text> : null}
          </Text>
          <Text style={styles.lead}>
            {blink.witnesses === 1
              ? t("1 Eye witnessed today's Blink")
              : t("{count} Eyes witnessed today's Blink", { count: blink.witnesses })}
          </Text>
        </>
      ) : null}
      <View style={styles.button}>
        <Button label={blinkLabel} onPress={() => void act('blink')} disabled={!canBlink || busy != null} tone={colors.metal} />
      </View>
      <Text style={styles.micro}>{t('{sol} SOL per Blink', { sol: sol(prices.blinkLamports) })}</Text>
      {feedback}
    </Panel>
  );
}

const styles = StyleSheet.create({
  panel: { padding: spacing.md, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, minHeight: 20 },
  serial: { color: colors.metal, fontFamily: font.monoBold, fontSize: 12, letterSpacing: 0.8, flexShrink: 1 },
  image: { width: '100%', aspectRatio: 1, borderRadius: radius.inner, backgroundColor: colors.inset },
  title: { color: colors.text, fontFamily: font.bold, fontSize: 18, letterSpacing: -0.3 },
  line: { color: colors.text, fontFamily: font.medium, ...type.small, fontVariant: ['tabular-nums'] },
  clock: { color: colors.text, fontFamily: font.semibold, ...type.body, fontVariant: ['tabular-nums'] },
  event: { color: colors.muted, fontFamily: font.regular, ...type.small },
  lead: { color: colors.muted, fontFamily: font.regular, ...type.small },
  micro: { color: colors.faint, fontFamily: font.regular, ...type.micro },
  hint: { color: colors.pending, fontFamily: font.medium, ...type.small },
  button: { marginTop: spacing.xs },
  actions: { flexDirection: 'row' },
  note: { color: colors.positive, fontFamily: font.medium, ...type.small },
  error: { color: colors.negative, fontFamily: font.medium, ...type.small },
});
