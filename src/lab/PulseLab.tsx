import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL, fetchEcosystemState, fetchWalletProfile } from '../api';
import { useReducedMotion } from '../useReducedMotion';
import { t } from '../i18n';
import { compact, integer, relativeTime, shortAddress } from '../format';
import { prefValue, usePref } from '../prefs';
import { SESSION_KEY } from '../session';
import { colors, font, gold, numeric, spacing, type } from '../theme';
import type { EcosystemState } from '../types';
import { DayHeat } from './DayHeat';
import { FlipNumber } from './FlipNumber';
import { Button, Evidence, Eyebrow, Hairline, HorizonRail, Inset, Panel, RangeSwitch } from './kit';
import { VaultScene, type SceneHandle, type SceneTap } from './VaultScene';
import { fetchEvents, subscribeFeed } from './feed';

// The Vault tab: the living scene on top, the numbers under it, and the exit
// queue at the bottom — one screen for the whole vault, where there used to be
// two (Pulse and Queue) showing the same rail twice.

const REFRESH_MS = 30_000;
const RANGES = ['24h', '7d', '30d'] as const;
type Range = typeof RANGES[number];
const RANGE_DAYS: Record<Range, number> = { '24h': 1, '7d': 7, '30d': 30 };
const RANGE_TITLE: Record<Range, string> = { '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days' };
const RANGE_NOTE: Record<Range, string> = { '24h': 'over the last 24 hours', '7d': 'over the last 7 days', '30d': 'over the last 30 days' };
// Classic is the fourth position: no scene at all, the main screen the way
// 1.0.4 drew it, with the day as a heat strip and the figure on its board.
// Asked for by people who wanted the old screen back; the switch is where the
// other three already were.
const MOTIONS = ['live', 'calm', 'off', 'classic'] as const;
const QUEUE_SHORT = 8;


function splitCompact(value: number): { figure: string; unit: string } {
  const text = compact(value);
  const suffix = text.slice(-1);
  if (suffix === 'B' || suffix === 'M' || suffix === 'K') return { figure: text.slice(0, -1), unit: `${suffix} SKR` };
  return { figure: text, unit: 'SKR' };
}

function who(name: string | null | undefined, wallet: string): string {
  return name ? `${name}.skr` : shortAddress(wallet);
}

function remaining(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${String(hours % 24).padStart(2, '0')}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m ${String(safe % 60).padStart(2, '0')}s`;
}

type QueueRow = NonNullable<EcosystemState['metrics']>['queue'][number];

// The exit list keeps its own clock. Counting down every second used to
// redraw the whole tab, cards and rail and scene wrapper alike, and that
// one-second hitch showed in the scene as a stutter. Now only these rows tick —
// and because the rows own the clock, the panel they now live inside, with its
// heading and its totals, does not tick with them.
function QueueList({ queue, shown, allQueue, onToggle }: { queue: QueueRow[]; shown: QueueRow[]; allQueue: boolean; onToggle: () => void }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1_000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1_000)), 1_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <View>
      {shown.map((position, index) => {
        const ready = position.status === 'withdrawable' || position.unlockAt <= now;
        return (
          <View key={position.stakeAccount} style={[styles.row, index > 0 && styles.rowDivided]}>
            <View style={[styles.rowMark, { backgroundColor: ready ? colors.positive : colors.pending }]} />
            <View style={styles.rowBody}>
              <Text style={styles.rowAmount}>{compact(position.amount)} SKR</Text>
              <Text numberOfLines={1} style={position.name ? styles.rowName : styles.rowWallet}>{who(position.name, position.wallet)}</Text>
            </View>
            <Text style={[styles.rowTime, { color: ready ? colors.positive : colors.text }]}>{ready ? t('ready') : remaining(position.unlockAt - now)}</Text>
          </View>
        );
      })}
      {queue.length === 0 ? <Text style={styles.empty}>{t('Nothing is queued to leave right now.')}</Text> : null}
      {queue.length > QUEUE_SHORT ? (
        <Pressable accessibilityRole="button" onPress={onToggle} style={styles.more}>
          <Text style={styles.moreText}>{allQueue ? t('Show fewer') : t('Show all {count}', { count: queue.length })}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function PulseLab({ frozen, topInset = 0, onAtTop }: { frozen: boolean; topInset?: number; onAtTop?: (atTop: boolean) => void }) {
  const { width, height } = useWindowDimensions();
  const [state, setState] = useState<EcosystemState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<Range>('24h');
  const [receipt, setReceipt] = useState<SceneTap | null>(null);
  const [allQueue, setAllQueue] = useState(false);
  // The maturity bands are the same queue, bucketed. They were a panel of their
  // own, sitting between the two tiles that summed them and the list that spells
  // them out — the same fact three times down one screen. Now they are one line
  // inside the queue's own panel, opened by whoever wants the shape of it.
  const [horizonOpen, setHorizonOpen] = useState(false);
  const [motionCalm, setMotionCalm] = usePref('motion:calm', false);
  const [motionOff, setMotionOff] = usePref('motion:off', false);
  const [motionClassic, setMotionClassic] = usePref('motion:classic', false);
  const scene = useRef<SceneHandle>(null);
  const seen = useRef<Set<string>>(new Set());
  const page = useRef<ScrollView>(null);
  const queueY = useRef(0);
  const openQueue = useCallback(() => {
    setAllQueue(true);
    // The list grows first, then the page scrolls to where its heading is.
    setTimeout(() => page.current?.scrollTo({ y: Math.max(0, queueY.current - spacing.md), animated: true }), 60);
  }, []);
  const reducedMotion = useReducedMotion();
  const motion = motionClassic ? 'classic' : motionOff ? 'off' : motionCalm ? 'calm' : 'live';
  const classic = motion === 'classic';
  // With no scene the header has nothing to float over, so it keeps its ground.
  useEffect(() => { if (classic) onAtTop?.(false); }, [classic, onAtTop]);

  const load = useCallback(async (visible = false) => {
    if (visible) setRefreshing(true);
    try {
      const next = await fetchEcosystemState();
      setState(next);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('Network unavailable'));
    } finally {
      if (visible) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void load(); }, REFRESH_MS);
    const subscription = AppState.addEventListener('change', (next) => { if (next === 'active') void load(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [load]);


  // Every finalized move reaches the scene within seconds, from the one feed
  // the whole app listens to. The first page seeds what has been seen and is
  // replayed once, oldest first and spread over most of a minute, so the vault
  // is alive from the first look and every phone in it is a real move.
  useEffect(() => subscribeFeed((items, first) => {
    if (first) {
      items.forEach((item) => seen.current.add(item.id));
      scene.current?.push({ type: 'events', replay: true, items: [...items].reverse().map((item) => ({ kind: item.type, amount: item.amount ?? 0, who: who(item.name, item.wallet), sig: item.signature })) });
      return;
    }
    const arrived = items.filter((item) => item.id && !seen.current.has(item.id));
    if (arrived.length === 0) return;
    arrived.forEach((item) => seen.current.add(item.id));
    if (seen.current.size > 600) seen.current = new Set([...seen.current].slice(-200));
    scene.current?.push({ type: 'events', items: arrived.reverse().map((item) => ({ kind: item.type, amount: item.amount ?? 0, who: who(item.name, item.wallet), sig: item.signature })) });
  }), []);

  // The day's largest stakes rest on the pile, lit, as the counterweight to
  // the exits hanging above: the vault takes in more than it lets go most
  // days, and the picture should say so with real events, not with a mood.
  useEffect(() => {
    let alive = true;
    const read = async () => {
      if (AppState.currentState !== 'active') return;
      try {
        const items = await fetchEvents(40, 10_000, 'stake');
        if (!alive) return;
        const dayAgo = Math.floor(Date.now() / 1_000) - 86_400;
        const top = items.filter((item) => item.blockTime >= dayAgo && (item.amount ?? 0) > 0).sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).slice(0, 3);
        scene.current?.push({ type: 'landmarks', items: top.map((item) => ({ amount: item.amount ?? 0, who: who(item.name, item.wallet), sig: item.signature })) });
      } catch {
        // The nests keep their last shape.
      }
    };
    void read();
    const timer = setInterval(() => void read(), 120_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  // The person's own place in the pile, from the same session the Me tab keeps.
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(SESSION_KEY).then(async (raw) => {
      if (!raw || !alive) return;
      const saved = JSON.parse(raw) as { address?: string; label?: string };
      if (!saved.address) return;
      const profile = await fetchWalletProfile(saved.address).catch(() => null);
      if (!alive || !profile?.found) return;
      scene.current?.push({ type: 'me', me: { name: profile.name ? `${profile.name}.skr` : saved.label ?? shortAddress(saved.address), amount: profile.totals.activeStaked, days: null } });
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  useEffect(() => { scene.current?.push({ type: 'freeze', on: frozen }); }, [frozen]);
  useEffect(() => { scene.current?.push({ type: 'inset', top: topInset }); }, [topInset]);
  useEffect(() => { scene.current?.push({ type: 'motion', mode: reducedMotion || motion === 'classic' ? 'off' : motion }); }, [motion, reducedMotion]);

  // The first time this phone opens the vault, it watches it being built:
  // the pile grows from nothing to today over six seconds. Once.
  useEffect(() => {
    AsyncStorage.getItem('skr-eyes:vault-story').then((raw) => {
      if (raw) return;
      scene.current?.push({ type: 'story' });
      void AsyncStorage.setItem('skr-eyes:vault-story', '1').catch(() => undefined);
    }).catch(() => undefined);
  }, []);

  const metrics = state?.metrics;
  const period = state?.analytics?.windows?.[range];
  const day = state?.analytics?.windows?.['24h'];
  const hours = state?.analytics?.hourly ?? [];

  useEffect(() => {
    if (!metrics) return;
    const queue = [...metrics.queue].sort((left, right) => right.amount - left.amount).slice(0, 6).map((item) => ({
      k: item.stakeAccount,
      amount: item.amount,
      who: item.name ? `${item.name}.skr` : null,
      unlockAt: item.unlockAt,
      startAt: item.unstakeTimestamp,
    }));
    scene.current?.push({
      type: 'state',
      percent: metrics.stakedPercent,
      pending: metrics.pendingUnstake,
      held: metrics.activeStaked,
      positions: metrics.totalPositions,
      todayIn: day?.staked ?? 0,
      todayOut: day?.unstaked ?? 0,
      eventsLastHour: hours[hours.length - 1]?.events ?? 0,
      now: Math.floor(Date.now() / 1_000),
      queue,
    });
    // After nine in the evening the pile becomes a city: the lit windows are
    // the share of positions whose wallet staked today, from the same window.
    const hour = new Date().getHours();
    const lit = day && metrics.totalPositions > 0 ? Math.min(0.5, (day.wallets / metrics.totalPositions) * 3) : 0.1;
    scene.current?.push({ type: 'night', on: hour >= 21 || hour < 6, lit });
  }, [metrics, day, hours]);

  const coverageDays = state?.analytics?.coverageFrom ? (state.analytics.generatedAt - state.analytics.coverageFrom) / 86_400 : 0;
  const partial = coverageDays > 0 && coverageDays < RANGE_DAYS[range] * 0.98;
  const horizon = metrics?.unlockHorizon;
  const note = t(RANGE_NOTE[range]);
  const inner = width - spacing.lg * 2;
  const hero = metrics ? splitCompact(metrics.activeStaked) : null;
  // The sky runs up behind the header, so the header floats over the scene
  // instead of sitting on a black band above it.
  // The scene is drawn in proportions, not in pixels — the pile, the sky and
  // the horizon are all fractions of the height it is given — so it can give a
  // little back. 0.36 of the screen instead of 0.4 puts the figure and the
  // day's two numbers above the fold on a phone held at a large system font,
  // and costs the vault about thirty points of sky.
  const sceneHeight = Math.round(Math.min(400, Math.max(280, height * 0.36))) + topInset;
  const queue = [...(metrics?.queue ?? [])].sort((left, right) => left.unlockAt - right.unlockAt);
  const shownQueue = allQueue ? queue : queue.slice(0, QUEUE_SHORT);

  return (
    <ScrollView
      ref={page}
      style={styles.screen}
      contentContainerStyle={[styles.content, classic && { paddingTop: topInset + spacing.md }]}
      onScroll={(event) => { if (!classic) onAtTop?.(event.nativeEvent.contentOffset.y < 6); }}
      scrollEventThrottle={48}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.accent} />}
    >
      {/* The scene and the line under it are one thing, so they are one group
          with a gap of its own. They used to be two children of a list with a
          16 gap and a −8 margin pulling the second one back up: the same
          distance, written as a correction. */}
      <View style={styles.top}>
        {classic ? (
          /* Classic: the board that flips, large, where the scene would be. */
          <View style={styles.classicHero}>
            <Eyebrow>{t('Active stake')}</Eyebrow>
            <View style={styles.classicRow}>
              <FlipNumber value={hero ? hero.figure : '—'} size={64} />
              <Text style={styles.classicUnit}>{hero ? hero.unit : 'SKR'}</Text>
            </View>
          </View>
        ) : (
          <View style={[styles.sceneWrap, { height: sceneHeight, marginHorizontal: -spacing.lg }]}>
            {/* the header's own height is the scene's top inset: nothing is drawn under the wordmark */}
            <VaultScene ref={scene} height={sceneHeight} onTap={setReceipt} />
          </View>
        )}

        {/* One number owns this tab, at full size under the sky. It used to
            sit at 40 on the right of a row it shared with two caption lines;
            the day's own figures now live in the band below, said once. */}
        {classic ? (
          <Text numberOfLines={1} style={styles.hudNote}>
            {metrics ? t('{percent}% of all SKR is staked', { percent: metrics.stakedPercent.toFixed(2) }) : error ? t('Waiting for a finalized answer') : t('Reading the vault')}
          </Text>
        ) : (
          <View style={styles.heroBlock}>
            <Eyebrow>{t('Active stake')}</Eyebrow>
            <View style={styles.classicRow}>
              <FlipNumber value={hero ? hero.figure : '—'} size={56} />
              <Text style={styles.classicUnit}>{hero ? hero.unit : 'SKR'}</Text>
            </View>
            <Text numberOfLines={1} style={styles.hudNote}>
              {metrics ? t('{percent}% of all SKR is staked', { percent: metrics.stakedPercent.toFixed(2) }) : error ? t('Waiting for a finalized answer') : t('Reading the vault')}
            </Text>
          </View>
        )}
      </View>

      {receipt ? (
        <Panel style={styles.receipt} tone={receipt.kind === 'stake' ? colors.positive : colors.pending}>
          <View style={styles.receiptHead}>
            <Eyebrow tone={receipt.kind === 'stake' ? colors.positive : colors.pending}>{t('Receipt')}</Eyebrow>
            <Pressable accessibilityRole="button" hitSlop={10} onPress={() => setReceipt(null)}><Text style={styles.close}>×</Text></Pressable>
          </View>

          <Text style={styles.receiptTitle}>{compact(receipt.amount)} SKR {receipt.kind === 'stake' ? t('staked') : receipt.ready ? t('ready to withdraw') : t('cooling down')}</Text>
          {receipt.who ? <Text style={styles.receiptWho}>{receipt.who}</Text> : null}
          <Text style={styles.receiptMono}>
            {receipt.sig ? `signature  ${shortAddress(receipt.sig)}\n` : ''}
            {receipt.unlockAt ? `${receipt.ready ? 'unlocked  ' : 'unlock at '} ${new Date(receipt.unlockAt * 1000).toLocaleString()}\n` : ''}
            commitment finalized
          </Text>
          {receipt.sig ? <Button ghost label={t('Open on Solscan')} onPress={() => void Linking.openURL(`https://solscan.io/tx/${receipt.sig}`)} /> : null}
        </Panel>
      ) : null}

      {/* The heat strip is what the scene replaced. It comes back only when the
          person has switched the scene off. */}
      {motion === 'off' || classic || reducedMotion ? <DayHeat width={inner} hours={hours} percent={metrics?.stakedPercent ?? null} /> : null}

      {/* Heading, cards and the coverage note are one block with a tight gap of
          its own, instead of three list children pulled together by negative
          margins. */}
      <View style={styles.period}>
        <View style={styles.periodHead}>
          <Eyebrow>{t(RANGE_TITLE[range])}</Eyebrow>
          <RangeSwitch value={range} options={[...RANGES]} onChange={(next) => setRange(next as Range)} />
        </View>

        {/* Three figures parted by hairlines, where four boxed cards used
            to take turns in a carousel nobody span. */}
        <View style={styles.band}>
          <View style={styles.bandCell}>
            <Text numberOfLines={1} style={styles.bandLabel}>{t('staked').toUpperCase()}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={[styles.bandValue, { color: colors.positive }]}>{period ? `+${compact(period.staked)}` : '—'}</Text>
          </View>
          <View style={styles.bandRule} />
          <View style={styles.bandCell}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.bandLabel}>{t('asked out').toUpperCase()}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={[styles.bandValue, { color: colors.negative }]}>{period ? `−${compact(period.unstaked)}` : '—'}</Text>
          </View>
          <View style={styles.bandRule} />
          <View style={styles.bandCell}>
            <Text numberOfLines={1} style={styles.bandLabel}>{t('net').toUpperCase()}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={[styles.bandValue, { color: (period?.netFlow ?? 0) >= 0 ? colors.positive : colors.negative }]}>{period ? `${period.netFlow >= 0 ? '+' : '−'}${compact(Math.abs(period.netFlow))}` : '—'}</Text>
          </View>
        </View>
        <Text style={styles.bandNote}>{period ? `${integer(period.wallets)} ${t('wallets')} · ${note}` : note}</Text>

        {partial ? <Text style={styles.partial}>{t('history covers {days}d', { days: Math.floor(coverageDays) })}</Text> : null}
      </View>

      {/* One queue, one panel.
          It used to be said three times running: two tiles that both opened the
          list, then five bands that bucketed the same SKR, then the list. Now
          the two totals are a recessed header on the list they summarise — a
          touch still opens the whole queue, as the tiles did — the bands live
          behind their own heading for whoever wants the shape of the next
          forty-eight hours, and the rows underneath are the queue itself: who,
          how much, how long. */}
      <View onLayout={(event) => { queueY.current = event.nativeEvent.layout.y; }}>
        <Panel style={[styles.queue, styles.queueGold]} tone={colors.metal}>
          <View style={styles.queueHead}>
            <Eyebrow tone={colors.metal}>{t('Exits in flight, soonest first')}</Eyebrow>
            <Text style={styles.listCount}>{t('{count} shown', { count: shownQueue.length })}</Text>
          </View>

          <Pressable accessibilityRole="button" onPress={openQueue}>
            {/* The queue's one figure, written in the metal the panel wears. */}
            <View style={styles.leaving}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={styles.leavingValue}>{metrics ? compact(metrics.pendingUnstake) : '—'}<Text style={styles.leavingUnit}> SKR</Text></Text>
              {metrics ? <Text style={styles.leavingNote}>{t('{count} positions waiting out the 48 hours', { count: integer(metrics.pendingPositions) })}</Text> : null}
            </View>
            <Inset style={styles.totals}>
              <View style={styles.total}>
                <View style={styles.totalHead}>
                  <View style={[styles.totalMark, { backgroundColor: colors.positive }]} />
                  <Text style={styles.totalLabel}>{t('Ready to exit')}</Text>
                  <Text style={[styles.totalValue, { color: colors.positive }]}>{metrics ? compact(metrics.withdrawable) : '—'} SKR</Text>
                </View>
                <Text style={styles.totalNote}>{t('Cooldown finished, not yet withdrawn')}</Text>
              </View>
            </Inset>
          </Pressable>

          <View style={styles.horizon}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: horizonOpen }}
              onPress={() => setHorizonOpen((open) => !open)}
              style={styles.horizonHead}
            >
              <Eyebrow tone={horizonOpen ? colors.accent : colors.faint}>{t('When the queue matures')}</Eyebrow>
              <Text style={[styles.caret, horizonOpen && styles.caretOpen]}>›</Text>
            </Pressable>
            {horizonOpen ? (
              <Inset style={styles.horizonBody}>
                <HorizonRail
                  bands={[
                    { label: t('ready'), value: horizon?.ready ?? 0, tone: colors.positive, display: horizon ? compact(horizon.ready) : '—' },
                    { label: '0–6h', value: horizon?.next6h ?? 0, tone: colors.pending, display: horizon ? compact(horizon.next6h) : '—' },
                    { label: '6–12h', value: horizon?.next12h ?? 0, tone: colors.pending, display: horizon ? compact(horizon.next12h) : '—' },
                    { label: '12–24h', value: horizon?.next24h ?? 0, tone: colors.accent, display: horizon ? compact(horizon.next24h) : '—' },
                    { label: '24–48h', value: horizon?.next48h ?? 0, tone: colors.accent, display: horizon ? compact(horizon.next48h) : '—' },
                  ]}
                />
              </Inset>
            ) : null}
          </View>

          <QueueList queue={queue} shown={shownQueue} allQueue={allQueue} onToggle={() => setAllQueue((value) => !value)} />
        </Panel>
      </View>

      {/* Motion is a setting, not a reading of the vault. It wore the same pill
          switch as the period above, so the screen offered two identical
          controls where one picks what you are looking at and the other picks
          how the app behaves from now on. It keeps its place at the foot of the
          screen and loses the panel and the pills: a rule, a heading and four
          words, the live one lit. */}
      <View style={styles.motion}>
        <Hairline />
        <View style={styles.motionCopy}>
          <Eyebrow>{t('Motion')}</Eyebrow>
          <Text style={styles.motionNote}>{motion === 'classic' ? t('The old main screen: no scene, the day as a heat strip, the number on its flip board.') : motion === 'off' ? t('The vault stands still.') : motion === 'calm' ? t('One gentle frame a second.') : t('Live while you watch. Calm after 90 seconds without a touch.')}</Text>
        </View>
        <View style={styles.motionOptions}>
          {MOTIONS.map((option) => {
            const on = option === motion;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                key={option}
                onPress={() => { setMotionClassic(option === 'classic'); setMotionOff(option === 'off'); setMotionCalm(option === 'calm'); }}
                style={({ pressed }) => [styles.motionOption, pressed && styles.motionPressed]}
              >
                <Text style={[styles.motionWord, on && styles.motionWordOn]}>{option.toUpperCase()}</Text>
                <View style={[styles.motionUnderline, on && styles.motionUnderlineOn]} />
              </Pressable>
            );
          })}
        </View>
      </View>

      <Evidence
        lines={[
          `commitment  finalized · ${state?.status.phase ?? 'syncing'}`,
          `vault read  ${relativeTime(metrics?.updatedAt ?? null)}`,
          `guardians   ${metrics ? `${metrics.guardians.count}, top pool ${metrics.guardians.topConcentrationPercent.toFixed(1)}%` : '—'}`,
          // Classic mounts no scene at all, so the line explaining the scene
          // would be explaining something that is not on the screen.
          ...(classic ? [] : ['scene       every phone is a finalized move · last 60 replayed on open']),
          error ? `last error  ${error}` : 'source      skr.alexkosa.dev · own indexer',
        ]}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingHorizontal: spacing.lg, paddingTop: 0, paddingBottom: 120, gap: spacing.lg },
  sceneWrap: { backgroundColor: colors.bg, overflow: 'hidden' },
  top: { gap: spacing.sm },
  heroBlock: { gap: 4, paddingTop: spacing.xs },
  classicHero: { gap: spacing.sm, paddingTop: spacing.sm },
  classicRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  classicUnit: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, letterSpacing: 1 },
  hudNote: { color: colors.text, fontFamily: font.medium, fontSize: 15, lineHeight: 21 },
  receipt: { padding: spacing.md, gap: spacing.xs },
  receiptHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  close: { color: colors.faint, fontSize: 20, lineHeight: 22 },
  receiptTitle: { color: colors.text, fontFamily: font.bold, fontSize: 18 },
  receiptWho: { fontFamily: font.semibold, fontSize: 13, ...gold },
  receiptMono: { color: colors.muted, fontFamily: font.mono, ...type.micro, marginTop: spacing.xs, marginBottom: spacing.sm },
  period: { gap: spacing.sm },
  band: { flexDirection: 'row', alignItems: 'stretch', paddingVertical: spacing.sm },
  bandCell: { flex: 1, gap: 3 },
  bandRule: { width: 1, backgroundColor: colors.line, marginHorizontal: spacing.md, marginVertical: 2 },
  bandLabel: { color: colors.muted, fontFamily: font.semibold, ...type.eyebrow },
  bandValue: { fontFamily: font.bold, fontSize: 21, letterSpacing: -0.5, ...numeric },
  bandNote: { color: colors.faint, fontFamily: font.regular, ...type.micro },
  periodHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  partial: { color: colors.pending, fontFamily: font.medium, ...type.micro },
  queue: { padding: spacing.md, gap: spacing.md },
  // The one panel on the tab that wears the metal: money on its way out.
  queueGold: { backgroundColor: colors.metalWash, borderColor: colors.metalDim },
  leaving: { gap: 2, paddingBottom: spacing.xs },
  leavingValue: { color: colors.text, fontFamily: font.black, fontSize: 30, letterSpacing: -1, ...numeric },
  leavingUnit: { color: colors.metal, fontFamily: font.semibold, fontSize: 13, letterSpacing: 0 },
  leavingNote: { color: colors.muted, fontFamily: font.regular, ...type.small },
  queueHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listCount: { color: colors.muted, fontFamily: font.regular, ...type.small },
  totals: { paddingVertical: spacing.md, gap: spacing.sm },
  total: { gap: 2 },
  totalDivided: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm },
  totalHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // The same mark the rows below wear, so the total and the queue it counts
  // read as one thing.
  totalMark: { width: 3, height: 16, borderRadius: 2 },
  totalLabel: { flex: 1, color: colors.muted, fontFamily: font.semibold, ...type.eyebrow, textTransform: 'uppercase' },
  // type.figure with the file's own tabular-nums: the `numeric` token is
  // declared `as const`, and a readonly fontVariant tuple is not assignable to
  // a style, so spreading it here does not compile.
  totalValue: { fontFamily: font.bold, ...type.figure, fontVariant: ['tabular-nums'] },
  totalNote: { color: colors.faint, fontFamily: font.regular, ...type.small, marginLeft: 3 + spacing.sm },
  horizon: { gap: spacing.sm },
  horizonHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.xs },
  horizonBody: { paddingVertical: spacing.md },
  caret: { color: colors.faint, fontFamily: font.medium, fontSize: 17, lineHeight: 20 },
  caretOpen: { color: colors.accent, transform: [{ rotate: '90deg' }] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.line },
  rowMark: { width: 3, height: 26, borderRadius: 2 },
  rowBody: { flex: 1, gap: 2 },
  rowAmount: { color: colors.text, fontFamily: font.semibold, fontSize: 15, fontVariant: ['tabular-nums'] },
  rowName: { fontFamily: font.semibold, fontSize: 12.5, ...gold },
  rowWallet: { color: colors.muted, fontFamily: font.mono, ...type.micro },
  rowTime: { fontFamily: font.semibold, fontSize: 13, fontVariant: ['tabular-nums'] },
  empty: { color: colors.muted, fontFamily: font.regular, ...type.body, paddingVertical: spacing.lg },
  more: { paddingVertical: spacing.md, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.line },
  moreText: { color: colors.accent, fontFamily: font.semibold, fontSize: 13 },
  motion: { gap: spacing.md, paddingTop: spacing.xs },
  motionCopy: { gap: 3 },
  motionNote: { color: colors.muted, fontFamily: font.regular, ...type.small },
  motionOptions: { flexDirection: 'row', justifyContent: 'space-between' },
  motionOption: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: spacing.sm },
  motionPressed: { opacity: 0.7 },
  motionWord: { color: colors.faint, fontFamily: font.monoBold, fontSize: 11, letterSpacing: 0.8 },
  motionWordOn: { color: colors.accent },
  motionUnderline: { height: 2, borderRadius: 1, alignSelf: 'stretch', marginHorizontal: spacing.sm, backgroundColor: colors.dim, opacity: 0.5 },
  motionUnderlineOn: { backgroundColor: colors.accent, opacity: 1 },
});
