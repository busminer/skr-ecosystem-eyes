import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { lang, t } from '../i18n';
import { integer } from '../format';
import { Button, Eyebrow, Panel } from '../lab/kit';
import { colors, font, spacing, type } from '../theme';
import { eyeImageUrl, fetchEyeStatus, type EyePrices, type EyeStatus, type EyeSubmitResult } from './api';
import { EyePicture, type Motion } from './EyePicture';
import { clock, epochMs } from './time';
import { MoveSheet } from './MoveSheet';
import type { MoveKind } from './move';
import { CORE_CREATE_FEE, blinkSkrOf, cooldownHours, depositOf, leftAtPrice, openSkrAfterOf, openSkrOf, rentOf, skr, sol } from './money';
import { askForEyeRemindersOnce, syncEyeReminders } from './reminders';
import { shareEye, type ShareMoment } from './shareEye';

// Your Eye, at the top of the Eyes tab: the one card on the tab.
//
// Three states and nothing hidden between them: no wallet, so what an Eye
// costs and the one button that connects; a wallet with no Eye, so the
// price and the one button that opens it; an Eye, so the everyday view a
// person comes back to between Blinks. Each move is the same road, the
// finger, the wallet, the network, and it is walked in the open, on a sheet
// that rises over the card and turns one step at a time (MoveSheet.tsx,
// move.ts). The card opens the door, takes what the sheet hands back, and
// re-reads its status afterwards rather than guessing at what changed.
//
// The everyday view is meant to be calm and worth a look: the picture and
// the number, the day the streak is on and how far the next ring and gold
// are, the clock to the next Blink (the Blink button takes the clock's place
// when the Blink is ready), who looked at your Eye today when anybody did,
// and one nudge: share right after a Blink, or look at somebody's Eye on
// the Iris on any other visit. After a share, a quiet line stays that says
// so and counts down to the next Blink. Nothing here says a zero.
//
// The Eye moves twice and only twice: its lids part the once it is opened,
// and shut and open again on every Blink. The picture itself does that, in
// EyePicture; this card only says when.

// The streak a ring needs, outermost first (the service's src/iris.mjs):
// the next of these above the day is the next ring, and thirty is gold.
const RING_DAYS = [2, 3, 5, 7, 10, 14, 21, 30];
const GOLD_DAY = 30;

// What an Eye costs right now, in plain sentences and in SOL: the first
// thousand at the opening price, how many of them are left, and the price
// after; then what the mint is made of and who gets each part. True to the
// server's numbers, and only the sentences the numbers allow.
export function offerLines(prices: EyePrices, nextSerial: number | null, eyesNow: number | null): string[] {
  const units = openSkrOf(prices);
  if (units == null) return [];
  const price = skr(units);
  const after = openSkrAfterOf(prices);
  const tier = prices.tier;
  // The live count when the network has been read, the server's word otherwise.
  const left = tier ? (eyesNow != null ? Math.max(0, tier.serial - eyesNow) : leftAtPrice(prices, nextSerial)) : null;
  const cost = [
    t('From your SOL only the network: a storage deposit of about {rent} SOL that stays inside your Eye on Solana, a {fee} SOL fee to Metaplex, the NFT standard it is built on, and a tiny network fee set by your wallet.', { rent: sol(depositOf(prices)), fee: sol(CORE_CREATE_FEE) }),
    t('{skr} SKR and about {sol} SOL in all.', { skr: price, sol: sol(rentOf(prices)) }),
  ].join(' ');
  if (!tier || left === 0 || after == null) {
    return [t('An Eye mints for {skr} SKR.', { skr: price }), cost];
  }
  const first = t('The first {count} Eyes mint for {skr} SKR each.', { count: integer(tier.serial), skr: price });
  const rest = [
    left == null ? null : left === 1 ? t('1 of them left.') : t('{count} of them left.', { count: integer(left) }),
    t('After them, {skr} SKR.', { skr: skr(after) }),
  ].filter((line): line is string => Boolean(line)).join(' ');
  return [first, rest, cost];
}

// How far the next step and gold are from this day of the streak.
function milestones(day: number): string[] {
  const next = RING_DAYS.find((floor) => floor > day) ?? null;
  if (next == null) return [t('On the gold step')];
  const toGold = GOLD_DAY - day;
  const gold = toGold === 1 ? t('1 day to gold') : t('{count} days to gold', { count: toGold });
  if (next === GOLD_DAY) return [gold];
  const toNext = next - day;
  return [toNext === 1 ? t('1 day to the next step') : t('{count} days to the next step', { count: toNext }), gold];
}

function Offer({ lines }: { lines: string[] }) {
  return (
    <View style={styles.offer}>
      <Text style={styles.offerLead}>{lines[0]}</Text>
      {lines.slice(1).map((line) => <Text key={line} style={styles.offerRest}>{line}</Text>)}
    </View>
  );
}

// `onStatus` hands every status this card reads to the tab around it, so
// the tab has the same numbers without a second read. `onBlinked` fires once
// a Blink has gone through, for the Eye on the Iris that is yours. `onConnect`
// is the tab's connect: with no wallet the card is where the one button to
// get one lives. `onBeforeOpen` is asked once before the first open: the tab
// shows the Seeker walk-through there when the finger is on and this phone
// has not been through it. A false answer ends the open quietly.
// `onHowItWorks` brings the tab's walk-through of the Eye back up, and
// `openRequest` is how that walk-through's last button reaches this one: each
// new number is one press of Open my Eye. `nextSerial` is the number the next
// Eye will carry and `eyesNow` how many are open, for the line that says how
// many are left at this price; `prices` are the tab's own, for the same line
// before there is a wallet. `onOpenCard` shows the Eye's full card; the card
// itself keeps the picture small, so the Iris is on screen too. `looked` is
// how many people looked at your Eye today, `lookNudge` whether to suggest
// looking at somebody's, and `onLook` takes the person to the Iris.
export function EyePanel({ wallet, meName = null, onStatus, onBlinked, onConnect, onBeforeOpen, onHowItWorks, onOpenCard, onLook, openRequest = 0, nextSerial = null, eyesNow = null, prices: tabPrices = null, looked = 0, lookNudge = false, connecting = false, connectError = null }: { wallet: string | null; meName?: string | null; onStatus?: (status: EyeStatus) => void; onBlinked?: () => void; onConnect?: () => void; onBeforeOpen?: () => Promise<boolean>; onHowItWorks?: () => void; onOpenCard?: () => void; onLook?: () => void; openRequest?: number; nextSerial?: number | null; eyesNow?: number | null; prices?: EyePrices | null; looked?: number; lookNudge?: boolean; connecting?: boolean; connectError?: string | null }) {
  const [status, setStatus] = useState<EyeStatus | null>(null);
  const [reading, setReading] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  // The move on the sheet right now, if any; and whether the walk-through is
  // being shown before a first open, while the button waits on its answer.
  const [move, setMove] = useState<MoveKind | null>(null);
  const [gate, setGate] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Which moment the share button speaks for: the open or the Blink just
  // made, or simply the Eye as it stands. And whether the card has been
  // shared since the last move, for the line that stays.
  const [moment, setMoment] = useState<ShareMoment>('any');
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Which of the two motions the picture is in, if any. Null is the rule.
  const [motion, setMotion] = useState<Motion | null>(null);
  // Disconnect or a change of wallet moves the ticket on, and an answer that
  // set out for the old wallet is dropped when it lands.
  const ticket = useRef(0);
  // Whether a status has ever been drawn for this wallet. A status already on
  // screen outlives one missed poll; only an empty card says the service is gone.
  const known = useRef(false);
  // The window edge the card last re-read the status for, so the clock
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
    setMoment('any');
    setShared(false);
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

  const settle = useCallback(() => setMotion(null), []);

  useEffect(() => { if (status) onStatus?.(status); }, [status, onStatus]);

  // The phone's reminders follow the server's clock: when this wallet may
  // blink again, and whether today still needs its Blink (src/eye/reminders.ts).
  // Only a change in those moves them, not every poll.
  const reminderKey = status?.eye ? `${status.eye.serial}|${status.blink?.nextAt ?? ''}|${status.blink?.ready ?? ''}|${status.blink?.doneToday ?? ''}|${status.blink?.day ?? ''}|${status.eye.streak}` : 'none';
  const latestStatus = useRef(status);
  latestStatus.current = status;
  useEffect(() => {
    if (!wallet || !latestStatus.current) return;
    void syncEyeReminders(latestStatus.current);
  }, [reminderKey, wallet]);

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
    // The first Eye is when reminders start to matter: ask once if they are off.
    if (kind === 'open') void askForEyeRemindersOnce();
    // The moment belongs to the person, not to the ledger (Alex, 30.09): the
    // app speaks to them by their own name, says what the day now holds, and
    // promises the reminder so nobody has to watch a clock.
    const known = latestStatus.current;
    const cooldownMs = (known?.blink?.cooldownSeconds ?? known?.prices.blinkCooldownSeconds ?? 28_800) * 1_000;
    const nextMs = Date.now() + cooldownMs;
    const dayEndMs = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1);
    const moreToday = cooldownMs > 0 && nextMs < dayEndMs ? 1 + Math.floor((dayEndMs - nextMs) / cooldownMs) : 0;
    let nextTime: string;
    try { nextTime = new Date(nextMs).toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit' }); } catch { nextTime = new Date(nextMs).toISOString().slice(11, 16); }
    const who = meName ?? null;
    if (kind === 'open') {
      setNote(who
        ? t('{name} — {eye} is yours. You are one of {count} who keep watch.', { name: who, eye: result.eye.name, count: result.eye.serial.toLocaleString('en-US') })
        : t('{name} is open. You are one of {count} who keep watch.', { name: result.eye.name, count: result.eye.serial.toLocaleString('en-US') }));
    } else {
      const kept = who
        ? t('{name}, day {count} is kept.', { name: who, count: result.eye.streak })
        : t('Day {count} is kept.', { count: result.eye.streak });
      const rest = moreToday > 1
        ? t('You can blink {count} more times today — a reminder will come right on time.', { count: moreToday })
        : moreToday === 1
          ? t('You can blink once more today — a reminder will come right on time.')
          : t('Your next Blink opens at {time} — a reminder will come right on time.', { time: nextTime });
      setNote(`${kept} ${rest}`);
    }
    setMoment(kind);
    setShared(false);
    if (kind === 'blink') onBlinked?.();
    void read(true);
  }, [read, onBlinked, meName]);

  // The Eye's picture and a caption, out to X (or wherever the person picks).
  // Once the share sheet has closed the card says so, and keeps saying so
  // until the next move.
  const share = useCallback(async () => {
    const eye = status?.eye;
    if (!eye || sharing) return;
    setSharing(true);
    setError(null);
    try {
      await shareEye(eye, moment, t('Share my Eye'), {
        eyes: status?.network?.eyes ?? null,
        left: status?.prices?.tier?.left ?? null,
        firstTier: status?.prices?.tier?.serial ?? null,
      });
      setShared(true);
      setNote(null);
      setMoment('any');
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : t('The Eye service did not answer'));
    } finally {
      setSharing(false);
    }
  }, [status?.eye, status?.network?.eyes, status?.prices?.tier, moment, sharing]);

  if (!wallet) {
    return (
      <Panel style={styles.panel}>
        <Eyebrow>{t('Your Eye')}</Eyebrow>
        <Text style={styles.lead}>{t('Your Eye opens once the wallet is connected.')}</Text>
        {tabPrices ? <Offer lines={offerLines(tabPrices, nextSerial, eyesNow)} /> : null}
        {onConnect ? (
          <View style={styles.button}>
            <Button label={connecting ? t('Connecting…') : t('Connect wallet')} onPress={onConnect} disabled={connecting} />
          </View>
        ) : null}
        {onHowItWorks ? <Button label={t('See what happens first')} onPress={onHowItWorks} ghost /> : null}
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
  // is keyed by the move so a Blink after an open starts from nothing. It is
  // told what this card shows for the move, the SOL to the maker and the Eye
  // a Blink is for, and holds the transaction to that before the wallet sees
  // it. Closed without a result, the card reads its status again, so a price
  // that moved under it (the first thousand running out) is on screen before
  // the next try.
  const sheet = move ? (
    <MoveSheet
      key={move}
      kind={move}
      wallet={wallet}
      expect={{ shownSkr: move === 'open' ? openSkrOf(prices) : blinkSkrOf(prices), asset: eye?.asset ?? null }}
      onDone={(result) => onMoved(move, result)}
      onClose={() => { setMove(null); void read(true); }}
    />
  ) : null;

  const hours = cooldownHours(prices, blink?.cooldownSeconds);

  if (!eye) {
    return (
      <Panel style={styles.panel}>
        <Eyebrow>{t('Your Eye')}</Eyebrow>
        <Text style={styles.title}>{t('Open your Eye')}</Text>
        <Offer lines={offerLines(prices, nextSerial, eyesNow)} />
        {gates.staked ? null : <Text style={styles.hint}>{t('For SKR stakers')}</Text>}
        <View style={styles.button}>
          <Button label={move === 'open' || gate ? t('Opening…') : t('Open my Eye')} onPress={() => void act('open')} disabled={!gates.staked || move != null || gate} />
        </View>
        {onHowItWorks ? <Button label={t('See what happens first')} onPress={onHowItWorks} ghost /> : null}
        {feedback}
        {sheet}
      </Panel>
    );
  }

  const canBlink = paced ? Boolean(blink?.ready) : Boolean(blink?.open && !blink.doneToday);
  const time = remaining != null ? clock(Math.max(0, remaining)) : null;
  // The line about the next Blink: the clock while it runs, the word when it
  // is ready. The button takes its place only when there is a Blink to make.
  const clockLine = !blink
    ? null
    : canBlink
      ? (paced || !time ? t('Your Blink is ready') : t('Blink is open. It closes in {time}.', { time }))
      : !paced && blink.doneToday
        ? t('Blinked today')
        : time
          ? t('Next Blink in {time}', { time })
          : null;
  const sharedLine = !shared
    ? null
    : canBlink
      ? t('Shared. Your Blink is ready.')
      : time
        ? t('Shared. Your next Blink opens in {time}.', { time })
        : t('Shared.');
  const blinkUnits = blinkSkrOf(prices);
  // The everyday card keeps the number and drops the ledger (Alex, 30.09):
  // who receives what lives on the mint breakdown and in the transaction
  // check, not under a person's streak.
  const priceLine = blinkUnits == null
    ? null
    : paced
      ? t('{skr} SKR per Blink, every {hours} hours', { skr: skr(blinkUnits), hours })
      : t('{skr} SKR per Blink.', { skr: skr(blinkUnits) });
  // One nudge, never two: the share right after a move, or a look at
  // somebody's Eye on any other visit while the person has not looked today.
  const shareLoud = moment !== 'any';
  const nudgeLook = !shareLoud && lookNudge && Boolean(onLook);

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
          <Text style={styles.streak}>{t('Day {count}', { count: eye.streak })}</Text>
          <View style={styles.facts}>
            <Text style={styles.fact}>{eye.blinks === 1 ? t('1 Blink so far') : t('{count} Blinks so far', { count: integer(eye.blinks) })}</Text>
            {milestones(eye.streak).map((line) => <Text key={line} style={styles.fact}>{line}</Text>)}
          </View>
          {clockLine ? <Text style={[styles.clock, canBlink && styles.clockReady]}>{clockLine}</Text> : null}
          {blink && paced && !blink.doneToday && !canBlink ? <Text style={styles.hint}>{t('Blink today to keep the streak')}</Text> : null}
          {looked > 0 ? <Text style={styles.looked}>{looked === 1 ? t('1 person looked at your Eye today') : t('{count} people looked at your Eye today', { count: looked })}</Text> : null}
        </View>
      </View>
      {canBlink ? (
        <View style={styles.button}>
          <Button label={move === 'blink' ? t('Blinking…') : t('Blink')} onPress={() => void act('blink')} disabled={move != null} tone={colors.metal} />
        </View>
      ) : null}
      {feedback}
      {sharedLine ? <Text style={styles.shared}>{sharedLine}</Text> : null}
      <View style={shareLoud ? styles.shareLoud : null}>
        <Button label={sharing ? t('Opening the share sheet…') : t('Share my Eye on X')} onPress={() => void share()} disabled={sharing} ghost={!shareLoud} />
      </View>
      {nudgeLook ? <Button label={t('Look at someone\'s Eye on the Iris')} onPress={onLook} quiet /> : null}
      <Text style={styles.micro}>{priceLine}</Text>
      {sheet}
    </Panel>
  );
}

const styles = StyleSheet.create({
  // The card's inner padding is the page gutter, so what is inside it lines
  // up one step in from the sections under the Iris.
  panel: { padding: spacing.lg, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, minHeight: 20 },
  serial: { color: colors.metal, fontFamily: font.monoBold, fontSize: 12, letterSpacing: 0.8, flexShrink: 1 },
  title: { color: colors.text, fontFamily: font.bold, fontSize: 21, lineHeight: 26, letterSpacing: -0.3 },
  clock: { color: colors.text, fontFamily: font.semibold, fontSize: 16, lineHeight: 22, fontVariant: ['tabular-nums'] },
  clockReady: { color: colors.positive },
  // The Eye small on the left, what it has done and what is next on the right.
  eyeRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  thumb: { width: 112 },
  eyeInfo: { flex: 1, gap: 4 },
  streak: { color: colors.metal, fontFamily: font.bold, fontSize: 26, lineHeight: 31, letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  facts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: 2 },
  fact: { color: colors.muted, fontFamily: font.medium, ...type.small, fontVariant: ['tabular-nums'] },
  looked: { color: colors.text, fontFamily: font.medium, ...type.small },
  lead: { color: colors.muted, fontFamily: font.regular, fontSize: 14, lineHeight: 20, fontVariant: ['tabular-nums'] },
  // What an Eye costs, for anyone without one: one gold line and a plain one.
  offer: { gap: 2 },
  offerLead: { color: colors.metal, fontFamily: font.semibold, fontSize: 15, lineHeight: 21, fontVariant: ['tabular-nums'] },
  offerRest: { color: colors.muted, fontFamily: font.regular, ...type.small, fontVariant: ['tabular-nums'] },
  micro: { color: colors.faint, fontFamily: font.regular, fontSize: 13, lineHeight: 18 },
  hint: { color: colors.pending, fontFamily: font.medium, fontSize: 14, lineHeight: 20 },
  button: { marginTop: spacing.xs },
  actions: { flexDirection: 'row' },
  note: { color: colors.positive, fontFamily: font.semibold, fontSize: 15, lineHeight: 21 },
  shared: { color: colors.positive, fontFamily: font.medium, fontSize: 14, lineHeight: 20, fontVariant: ['tabular-nums'] },
  error: { color: colors.negative, fontFamily: font.medium, fontSize: 14, lineHeight: 20 },
  // Right after an open or a Blink the share button stands out.
  shareLoud: { marginTop: spacing.xs },
});
