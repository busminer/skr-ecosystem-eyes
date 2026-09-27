import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { Button, Eyebrow, Panel } from '../lab/kit';
import { colors, font, spacing, type } from '../theme';
import { eyeImageUrl, fetchEyeStatus, type EyeStatus, type EyeSubmitResult } from './api';
import { EyePicture, type Motion } from './EyePicture';
import { clock, epochMs } from './time';
import { MoveSheet } from './MoveSheet';
import type { MoveKind } from './move';
import { cooldownHours, leftAtPrice, sol, usd } from './money';
import { shareEye, type ShareMoment } from './shareEye';

// Your Eye, at the top of the Eyes tab.
//
// Three states and nothing hidden between them: no wallet, so one line; a
// wallet with no Eye, so the price and the one button that opens it; an Eye,
// so its picture, its streak, the clock to the next Blink and the button that
// blinks. Each move is the same road — the finger, the wallet, the network —
// and it is walked in the open, on a sheet that rises over the panel and
// turns one step at a time (MoveSheet.tsx, move.ts). The panel opens the
// door, takes what the sheet hands back, and re-reads its status afterwards
// rather than guessing at what changed.
//
// The Eye moves twice and only twice: its lids part the once it is opened,
// and shut and open again on every Blink. The picture itself does that, in
// EyePicture; this panel only says when.

// One step of the witnesses count on its way up. Usually the way up is one,
// after our own Blink; a poll that finds a crowd arrived takes at most a
// dozen steps to get there rather than counting every head.
const TICK_MS = 90;
const step = (from: number, to: number) => Math.min(to, from + Math.max(1, Math.ceil((to - from) / 12)));

// `onStatus` hands every status this panel reads to the tab around it, so
// the pupil under it can count down from the same window without a second
// read. `onBlinked` fires once a Blink has gone through, for the ring on the
// Iris that is yours. `onConnect` is the tab's connect: with no wallet the
// panel is where the one button to get one lives.
// `onBeforeOpen` is asked once before the first open: the tab shows the
// Seeker walk-through there when the finger is on and this phone has not
// been through it. A false answer ends the open quietly.
// `onHowItWorks` brings the tab's walk-through of the Eye back up, and
// `openRequest` is how that walk-through's last button reaches this one: each
// new number is one press of Open my Eye. `nextSerial` is the number the next
// Eye will carry, for the line that says how many are left at this price.
// `onOpenCard` shows the Eye's full card; the panel itself keeps it small, so
// the Iris and the other Eyes are on screen too.
export function EyePanel({ wallet, onStatus, onBlinked, onConnect, onBeforeOpen, onHowItWorks, onOpenCard, openRequest = 0, nextSerial = null, connecting = false, connectError = null }: { wallet: string | null; onStatus?: (status: EyeStatus) => void; onBlinked?: () => void; onConnect?: () => void; onBeforeOpen?: () => Promise<boolean>; onHowItWorks?: () => void; onOpenCard?: () => void; openRequest?: number; nextSerial?: number | null; connecting?: boolean; connectError?: string | null }) {
  const [status, setStatus] = useState<EyeStatus | null>(null);
  const [reading, setReading] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  // The move on the sheet right now, if any; and whether the walk-through is
  // being shown before a first open, while the button waits on its answer.
  const [move, setMove] = useState<MoveKind | null>(null);
  const [gate, setGate] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Which moment the share button speaks for: the open or the Blink just
  // made, or simply the Eye as it stands.
  const [moment, setMoment] = useState<ShareMoment>('any');
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Which of the two motions the picture is in, if any. Null is the rule.
  const [motion, setMotion] = useState<Motion | null>(null);
  // The witnesses number as drawn, which follows the real one up in steps.
  const [shownWitnesses, setShownWitnesses] = useState<number | null>(null);
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
    setMove(null);
    setGate(false);
    setMotion(null);
    setShownWitnesses(null);
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
  // A Blink every eight hours when the server says so (it sends `ready`); the
  // day's window otherwise, as before.
  const paced = typeof blink?.ready === 'boolean';
  const edge = !blink ? null : paced ? (blink.nextAt ? epochMs(blink.nextAt) : null) : epochMs(blink.open ? blink.closesAt : blink.opensAt);
  const remaining = edge != null ? edge - now : null;

  // The window opened or closed under the clock, or the rest after a Blink
  // ran out: ask the server what is true now. One second of grace so the
  // server has flipped before we ask.
  useEffect(() => {
    if (edge == null || remaining == null || remaining > -1_000 || boundary.current === edge) return;
    boundary.current = edge;
    void read(true);
  }, [edge, remaining, read]);

  // The witnesses number ticks up to what the server says, and snaps to
  // anything else: the first reading, or a number that went down.
  const witnesses = blink?.witnesses ?? null;
  useEffect(() => {
    if (witnesses == null) { setShownWitnesses(null); return; }
    setShownWitnesses((shown) => (shown == null || witnesses < shown ? witnesses : shown));
  }, [witnesses]);
  useEffect(() => {
    if (witnesses == null || shownWitnesses == null || shownWitnesses >= witnesses) return;
    const timer = setTimeout(() => setShownWitnesses((shown) => (shown == null ? witnesses : step(shown, witnesses))), TICK_MS);
    return () => clearTimeout(timer);
  }, [witnesses, shownWitnesses]);

  const settle = useCallback(() => setMotion(null), []);

  useEffect(() => { if (status) onStatus?.(status); }, [status, onStatus]);

  // The button: before a first open, the walk-through has its say; then the
  // sheet rises and the move runs on it, step by step, where it can be seen.
  const act = useCallback(async (kind: MoveKind) => {
    if (!wallet || move || gate) return;
    const mine = ticket.current;
    setError(null);
    setNote(null);
    if (kind === 'open' && onBeforeOpen) {
      setGate(true);
      try {
        const go = await onBeforeOpen();
        if (mine !== ticket.current || !go) return;
      } finally {
        if (mine === ticket.current) setGate(false);
      }
    }
    setMove(kind);
  }, [wallet, move, gate, onBeforeOpen]);

  // The tab's walk-through pressed Open my Eye on its last page.
  const handled = useRef(openRequest);
  useEffect(() => {
    if (openRequest === handled.current) return;
    handled.current = openRequest;
    if (status && !status.eye) void act('open');
  }, [openRequest, status, act]);

  // The sheet's last step has landed. What the server just handed back is
  // truer than what it said a minute ago, so the Eye it returned goes on
  // screen now and the lids move on it; the full status follows and fills
  // in the rest.
  const onMoved = useCallback((kind: MoveKind, result: EyeSubmitResult) => {
    setMove(null);
    setStatus((previous) => {
      if (!previous) return previous;
      const was = previous.blink;
      const rest = (was?.cooldownSeconds ?? previous.prices.blinkCooldownSeconds ?? 0) * 1_000;
      // An open includes the first Blink, so either move starts the rest.
      const blinkNow = was ? {
        ...was,
        doneToday: true,
        ...(typeof was.ready === 'boolean' ? { ready: false, lastAt: new Date().toISOString(), nextAt: rest ? new Date(Date.now() + rest).toISOString() : was.nextAt ?? null } : {}),
      } : was;
      return { ...previous, eye: result.eye ?? previous.eye, blink: blinkNow };
    });
    setMotion(kind === 'open' ? 'opening' : 'blink');
    setNote(kind === 'open'
      ? t('{name} is open. You are one of {count} who keep watch.', { name: result.eye.name, count: result.eye.serial.toLocaleString('en-US') })
      : t('Day {count} is kept.', { count: result.eye.streak }));
    setMoment(kind);
    if (kind === 'blink') onBlinked?.();
    void read(true);
  }, [read, onBlinked]);

  // The Eye's picture and a caption, out to X (or wherever the person picks).
  const share = useCallback(async () => {
    const eye = status?.eye;
    if (!eye || sharing) return;
    setSharing(true);
    setError(null);
    try {
      await shareEye(eye, moment, t('Share my Eye'));
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : t('The Eye service did not answer'));
    } finally {
      setSharing(false);
    }
  }, [status?.eye, moment, sharing]);

  if (!wallet) {
    return (
      <Panel style={styles.panel}>
        <Eyebrow>{t('Your Eye')}</Eyebrow>
        <Text style={styles.lead}>{t('Your Eye opens once the wallet is connected.')}</Text>
        {onConnect ? (
          <View style={styles.button}>
            <Button label={connecting ? t('Connecting…') : t('Connect Solana Mobile')} onPress={onConnect} disabled={connecting} />
          </View>
        ) : null}
        {onHowItWorks ? <Button label={t('How it works')} onPress={onHowItWorks} quiet /> : null}
        {connectError ? <Text style={styles.error}>{connectError}</Text> : null}
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
  // The sheet is a Modal, so where it sits in the tree does not matter; it
  // is keyed by the move so a Blink after an open starts from nothing.
  const sheet = move ? <MoveSheet key={move} kind={move} wallet={wallet} onDone={(result) => onMoved(move, result)} onClose={() => setMove(null)} /> : null;

  const solUsd = prices.solUsd ?? null;
  const hours = cooldownHours(prices, blink?.cooldownSeconds);

  if (!eye) {
    const left = leftAtPrice(prices, nextSerial);
    const openUsd = usd(prices.openLamports, solUsd);
    return (
      <Panel style={styles.panel}>
        <Eyebrow>{t('Your Eye')}</Eyebrow>
        <Text style={styles.title}>{t('Open your Eye')}</Text>
        <Text style={styles.line}>{`${t('{sol} SOL to open', { sol: sol(prices.openLamports) })}${openUsd ? ` · ${openUsd}` : ''}`}</Text>
        {left != null && prices.tier ? (
          <Text style={styles.micro}>{t('{count} left at this price, then {sol} SOL', { count: left.toLocaleString('en-US'), sol: sol(prices.tier.afterLamports) })}</Text>
        ) : null}
        {gates.staked ? null : <Text style={styles.hint}>{t('Needs an active SKR position')}</Text>}
        <View style={styles.button}>
          <Button label={move === 'open' || gate ? t('Opening…') : t('Open my Eye')} onPress={() => void act('open')} disabled={!gates.staked || move != null || gate} />
        </View>
        {onHowItWorks ? <Button label={t('How it works')} onPress={onHowItWorks} quiet /> : null}
        {feedback}
        {sheet}
      </Panel>
    );
  }

  const canBlink = paced ? Boolean(blink?.ready) : Boolean(blink?.open && !blink.doneToday);
  const blinkLabel = move === 'blink'
    ? t('Blinking…')
    : paced
      ? t('Blink')
      : blink?.doneToday
        ? t('Blinked today')
        : blink?.open
          ? t('Blink')
          : t('Blink is closed');
  const count = shownWitnesses ?? blink?.witnesses ?? 0;
  const blinkUsd = usd(prices.blinkLamports, solUsd);

  return (
    <Panel style={styles.panel}>
      <View style={styles.head}>
        <Eyebrow>{t('Your Eye')}</Eyebrow>
        <Text numberOfLines={1} style={styles.serial}>{eye.name}</Text>
      </View>
      <View style={styles.eyeRow}>
        <Pressable style={styles.thumb} onPress={onOpenCard} disabled={!onOpenCard} accessibilityRole="imagebutton" accessibilityLabel={eye.name}>
          <EyePicture uri={eyeImageUrl(eye.image)} label={eye.name} motion={motion} onSettled={settle} />
        </Pressable>
        <View style={styles.eyeInfo}>
          <Text style={styles.streak}>{eye.streak === 1 ? t('1 day') : t('{count} days', { count: eye.streak })}</Text>
          <Text style={styles.line}>
            {eye.blinks === 1
              ? t('Streak {streak} · 1 Blink', { streak: eye.streak })
              : t('Streak {streak} · {blinks} Blinks', { streak: eye.streak, blinks: eye.blinks })}
          </Text>
          {blink && paced ? (
            <>
              <Text style={[styles.clock, blink.ready && styles.clockReady]}>
                {blink.ready
                  ? t('Your Blink is ready')
                  : t('Next Blink in {time}', { time: remaining != null ? clock(Math.max(0, remaining)) : '—' })}
              </Text>
              {!blink.doneToday ? <Text style={styles.hint}>{t('Blink today to keep the streak')}</Text> : null}
              <Text style={styles.lead}>{t('{count} blinked today', { count })}</Text>
            </>
          ) : blink ? (
            <>
              <Text style={styles.clock}>
                {blink.open
                  ? t('Blink is open · closes in {time}', { time: remaining != null ? clock(remaining) : '—' })
                  : t('Next Blink in {time}', { time: remaining != null ? clock(remaining) : '—' })}
              </Text>
              <Text style={styles.lead}>{t('{count} blinked today', { count })}</Text>
            </>
          ) : null}
        </View>
      </View>
      <View style={styles.button}>
        <Button label={blinkLabel} onPress={() => void act('blink')} disabled={!canBlink || move != null} tone={colors.metal} />
      </View>
      <Text style={styles.micro}>
        {[
          t('{sol} SOL per Blink', { sol: sol(prices.blinkLamports) }) + (blinkUsd ? ` · ${blinkUsd}` : ''),
          paced ? t('every {hours} hours', { hours }) : null,
        ].filter(Boolean).join(' · ')}
      </Text>
      {feedback}
      <View style={moment === 'any' ? null : styles.shareLoud}>
        <Button label={sharing ? t('Opening the share sheet…') : t('Share my Eye on X')} onPress={() => void share()} disabled={sharing} ghost={moment === 'any'} />
      </View>
      {sheet}
    </Panel>
  );
}

const styles = StyleSheet.create({
  panel: { padding: spacing.md, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, minHeight: 20 },
  serial: { color: colors.metal, fontFamily: font.monoBold, fontSize: 12, letterSpacing: 0.8, flexShrink: 1 },
  title: { color: colors.text, fontFamily: font.bold, fontSize: 21, lineHeight: 26, letterSpacing: -0.3 },
  line: { color: colors.text, fontFamily: font.medium, fontSize: 14.5, lineHeight: 20, fontVariant: ['tabular-nums'] },
  clock: { color: colors.text, fontFamily: font.semibold, fontSize: 16, lineHeight: 22, fontVariant: ['tabular-nums'] },
  clockReady: { color: colors.positive },
  // The Eye small on the left, what it has done and what is next on the right.
  eyeRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  thumb: { width: 124 },
  eyeInfo: { flex: 1, gap: 3 },
  streak: { color: colors.metal, fontFamily: font.bold, fontSize: 26, lineHeight: 31, letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  event: { color: colors.muted, fontFamily: font.regular, ...type.small },
  lead: { color: colors.muted, fontFamily: font.regular, fontSize: 14, lineHeight: 20, fontVariant: ['tabular-nums'] },
  micro: { color: colors.faint, fontFamily: font.regular, fontSize: 13, lineHeight: 18 },
  hint: { color: colors.pending, fontFamily: font.medium, fontSize: 14, lineHeight: 20 },
  button: { marginTop: spacing.xs },
  actions: { flexDirection: 'row' },
  note: { color: colors.positive, fontFamily: font.semibold, fontSize: 15, lineHeight: 21 },
  error: { color: colors.negative, fontFamily: font.medium, fontSize: 14, lineHeight: 20 },
  // Right after an open or a Blink the share button stands out.
  shareLoud: { marginTop: spacing.xs },
});
