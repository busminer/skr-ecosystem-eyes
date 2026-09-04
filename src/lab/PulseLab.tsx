import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL, fetchEcosystemState, fetchWalletProfile } from '../api';
import { useReducedMotion } from '../useReducedMotion';
import { t } from '../i18n';
import { compact, integer, relativeTime, shortAddress } from '../format';
import { prefValue, usePref } from '../prefs';
import { Carousel } from './Carousel';
import { SESSION_KEY } from '../session';
import { colors, font, gold, spacing, type } from '../theme';
import type { EcosystemState } from '../types';
import { DayHeat } from './DayHeat';
import { FlipNumber } from './FlipNumber';
import { Button, Evidence, Eyebrow, HorizonRail, Panel, RangeSwitch, Tile } from './kit';
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
const MOTIONS = ['live', 'calm', 'off'] as const;
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

function FactCard({ label, value, note, tone, width }: { label: string; value: string; note: string; tone?: string; width: number }) {
  return (
    <Panel style={[styles.fact, { width }]} tone={tone}>
      <Text numberOfLines={1} style={styles.factLabel}>{label.toUpperCase()}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={[styles.factValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text numberOfLines={2} style={styles.factNote}>{note}</Text>
    </Panel>
  );
}


type QueueRow = NonNullable<EcosystemState['metrics']>['queue'][number];

// The exit list keeps its own clock. Counting down every second used to
// redraw the whole tab, cards and rail and scene wrapper alike, and that
// one-second hitch showed in the scene as a stutter. Now only these rows tick.
function QueueList({ queue, shown, allQueue, onToggle }: { queue: QueueRow[]; shown: QueueRow[]; allQueue: boolean; onToggle: () => void }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1_000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1_000)), 1_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Panel style={styles.list}>
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
    </Panel>
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
  const [motionCalm, setMotionCalm] = usePref('motion:calm', false);
  const [motionOff, setMotionOff] = usePref('motion:off', false);
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
  const motion = motionOff ? 'off' : motionCalm ? 'calm' : 'live';

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
      scene.current?.push({ type: 'me', me: { name: saved.label ?? shortAddress(saved.address), amount: profile.totals.activeStaked, days: null } });
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  useEffect(() => { scene.current?.push({ type: 'freeze', on: frozen }); }, [frozen]);
  useEffect(() => { scene.current?.push({ type: 'inset', top: topInset }); }, [topInset]);
  useEffect(() => { scene.current?.push({ type: 'motion', mode: reducedMotion ? 'off' : motion }); }, [motion, reducedMotion]);

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
  const sceneHeight = Math.round(Math.min(420, Math.max(300, height * 0.4))) + topInset;
  const queue = [...(metrics?.queue ?? [])].sort((left, right) => left.unlockAt - right.unlockAt);
  const shownQueue = allQueue ? queue : queue.slice(0, QUEUE_SHORT);

  return (
    <ScrollView
      ref={page}
      style={styles.screen}
      contentContainerStyle={styles.content}
      onScroll={(event) => onAtTop?.(event.nativeEvent.contentOffset.y < 6)}
      scrollEventThrottle={48}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.accent} />}
    >
      <View style={[styles.sceneWrap, { height: sceneHeight, marginHorizontal: -spacing.lg }]}>
        {/* the header's own height is the scene's top inset: nothing is drawn under the wordmark */}
        <VaultScene ref={scene} height={sceneHeight} onTap={setReceipt} />
      </View>

      {/* The figure and the two lines share one row under the scene: the
          lines on the left, the flip board on the right, in the space the
          board left empty when it lived over the pile. */}
      <View style={styles.under}>
        <View style={styles.underLines}>
          <Text numberOfLines={1} style={styles.hudNote}>
            {metrics ? t('{percent}% of all SKR is staked', { percent: metrics.stakedPercent.toFixed(2) }) : error ? t('Waiting for a finalized answer') : t('Reading the vault')}
          </Text>
          {day ? (
            <Text numberOfLines={1} style={styles.hudDay}>
              <Text style={{ color: colors.positive }}>+{compact(day.staked)}</Text>{` ${t('in')} · `}<Text style={{ color: colors.negative }}>{compact(day.unstaked)}</Text>{` ${t('asked out')}`}
            </Text>
          ) : null}
        </View>
        <View style={styles.underFigure}>
          <FlipNumber value={hero ? hero.figure : '—'} size={40} />
          <Text style={styles.unit}>{hero ? hero.unit : 'SKR'}</Text>
        </View>
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
      {motion === 'off' || reducedMotion ? <DayHeat width={inner} hours={hours} percent={metrics?.stakedPercent ?? null} /> : null}

      <View style={styles.periodHead}>
        <Eyebrow>{t(RANGE_TITLE[range])}</Eyebrow>
        <RangeSwitch value={range} options={[...RANGES]} onChange={(next) => setRange(next as Range)} />
      </View>

      <Carousel width={inner} auto={!reducedMotion}>
        <FactCard width={inner} note={note} label={t('staked')} value={period ? compact(period.staked) : '—'} tone={colors.positive} />
        <FactCard width={inner} note={note} label={t('asked out')} value={period ? compact(period.unstaked) : '—'} tone={colors.negative} />
        <FactCard
          width={inner}
          note={`${note} · ${t('staked minus requested out')}`}
          label={t('net')}
          value={period ? `${period.netFlow >= 0 ? '+' : '−'}${compact(Math.abs(period.netFlow))}` : '—'}
          tone={(period?.netFlow ?? 0) >= 0 ? colors.positive : colors.negative}
        />
        <FactCard width={inner} note={note} label={t('wallets')} value={period ? integer(period.wallets) : '—'} tone={colors.metal} />
      </Carousel>

      {partial ? <Text style={styles.partial}>{t('history covers {days}d', { days: Math.floor(coverageDays) })}</Text> : null}

      {/* Both tiles open the whole queue, as they did when it was a tab of
          its own: the list unfolds and the page scrolls down to it. */}
      <View style={styles.tiles}>
        <Tile label={t('In cooldown')} value={metrics ? compact(metrics.pendingUnstake) : '—'} unit="SKR" note={metrics ? t('{count} positions waiting out the 48 hours', { count: integer(metrics.pendingPositions) }) : undefined} tone={colors.pending} onPress={openQueue} />
        <Tile label={t('Ready to exit')} value={metrics ? compact(metrics.withdrawable) : '—'} unit="SKR" note={t('Cooldown finished, not yet withdrawn')} tone={colors.positive} onPress={openQueue} />
      </View>

      <Panel style={styles.railPanel}>
        <Eyebrow>{t('When the queue matures')}</Eyebrow>
        <View style={styles.railBody}>
          <HorizonRail
            bands={[
              { label: t('ready'), value: horizon?.ready ?? 0, tone: colors.positive, display: horizon ? compact(horizon.ready) : '—' },
              { label: '0–6h', value: horizon?.next6h ?? 0, tone: colors.pending, display: horizon ? compact(horizon.next6h) : '—' },
              { label: '6–12h', value: horizon?.next12h ?? 0, tone: colors.pending, display: horizon ? compact(horizon.next12h) : '—' },
              { label: '12–24h', value: horizon?.next24h ?? 0, tone: colors.accent, display: horizon ? compact(horizon.next24h) : '—' },
              { label: '24–48h', value: horizon?.next48h ?? 0, tone: colors.accent, display: horizon ? compact(horizon.next48h) : '—' },
            ]}
          />
        </View>
      </Panel>

      <View style={styles.listHead} onLayout={(event) => { queueY.current = event.nativeEvent.layout.y; }}>
        <Eyebrow>{t('Exits in flight, soonest first')}</Eyebrow>
        <Text style={styles.listCount}>{t('{count} shown', { count: shownQueue.length })}</Text>
      </View>
      <QueueList queue={queue} shown={shownQueue} allQueue={allQueue} onToggle={() => setAllQueue((value) => !value)} />

      <Panel style={styles.motionPanel}>
        <View style={styles.motionRow}>
          <View style={styles.motionCopy}>
            <Eyebrow>{t('Motion')}</Eyebrow>
            <Text style={styles.motionNote}>{motion === 'off' ? t('The vault stands still.') : motion === 'calm' ? t('One gentle frame a second.') : t('Live while you watch. Calm after 90 seconds without a touch.')}</Text>
          </View>
          <RangeSwitch value={motion} options={[...MOTIONS]} onChange={(next) => { setMotionOff(next === 'off'); setMotionCalm(next === 'calm'); }} />
        </View>
      </Panel>

      <Evidence
        lines={[
          `commitment  finalized · ${state?.status.phase ?? 'syncing'}`,
          `vault read  ${relativeTime(metrics?.updatedAt ?? null)}`,
          `guardians   ${metrics ? `${metrics.guardians.count}, top pool ${metrics.guardians.topConcentrationPercent.toFixed(1)}%` : '—'}`,
          'scene       every phone is a finalized move · last 60 replayed on open',
          error ? `last error  ${error}` : 'source      skr.alexkosa.dev · own indexer',
        ]}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: 0, paddingBottom: 120, gap: spacing.lg },
  sceneWrap: { backgroundColor: colors.bg, overflow: 'hidden' },
  under: { marginTop: -spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  underLines: { flex: 1, gap: 2 },
  underFigure: { alignItems: 'flex-end', gap: 3 },
  unit: { color: colors.muted, fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.8 },
  hudNote: { color: colors.text, fontFamily: font.medium, fontSize: 15, lineHeight: 21, textShadowColor: '#000', textShadowRadius: 6 },
  hudDay: { color: colors.muted, fontFamily: font.semibold, fontSize: 14.5, lineHeight: 20, textShadowColor: '#000', textShadowRadius: 6 },
  receipt: { padding: spacing.md, gap: spacing.xs },
  receiptHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  close: { color: colors.faint, fontSize: 20, lineHeight: 22 },
  receiptTitle: { color: colors.text, fontFamily: font.bold, fontSize: 18 },
  receiptWho: { fontFamily: font.semibold, fontSize: 13, ...gold },
  receiptMono: { color: colors.muted, fontFamily: font.mono, ...type.micro, marginTop: spacing.xs, marginBottom: spacing.sm },
  facts: { gap: spacing.md, paddingRight: spacing.lg },
  fact: { padding: spacing.md, minHeight: 108, justifyContent: 'space-between' },
  factLabel: { color: colors.muted, fontFamily: font.semibold, ...type.eyebrow },
  factValue: { color: colors.text, fontFamily: font.black, fontVariant: ['tabular-nums'], fontSize: 30, letterSpacing: -1 },
  factNote: { color: colors.faint, fontFamily: font.regular, ...type.micro },
  periodHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: -spacing.xs, marginBottom: -spacing.sm },
  partial: { color: colors.pending, fontFamily: font.medium, ...type.micro },
  tiles: { flexDirection: 'row', gap: spacing.md },
  railPanel: { padding: spacing.md },
  railBody: { marginTop: spacing.md },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: -spacing.sm },
  listCount: { color: colors.muted, fontFamily: font.regular, ...type.small },
  list: { paddingHorizontal: spacing.md },
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
  motionPanel: { padding: spacing.md },
  motionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  motionCopy: { flex: 1, gap: 3 },
  motionNote: { color: colors.muted, fontFamily: font.regular, ...type.small },
});
