import { useCallback, useEffect, useState } from 'react';
import { AppState, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { fetchEcosystemState } from '../api';
import { compact, integer, relativeTime } from '../format';
import { colors, font, spacing, type } from '../theme';
import type { EcosystemState } from '../types';
import { FlipNumber } from './FlipNumber';
import { Evidence, Eyebrow, FlowChart, HorizonRail, Meter, Panel, RangeSwitch, Tile } from './kit';

const REFRESH_MS = 30_000;
const RANGES = ['24h', '7d', '30d'] as const;
type Range = typeof RANGES[number];
const RANGE_DAYS: Record<Range, number> = { '24h': 1, '7d': 7, '30d': 30 };
const RANGE_TITLE: Record<Range, string> = { '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days' };

// The hero splits the magnitude off the number so the unit can sit quietly
// beside it instead of competing with it.
function splitCompact(value: number): { figure: string; unit: string } {
  const text = compact(value);
  const suffix = text.slice(-1);
  if (suffix === 'B' || suffix === 'M' || suffix === 'K') return { figure: text.slice(0, -1), unit: `${suffix} SKR` };
  return { figure: text, unit: 'SKR' };
}

export function PulseLab({ onOpenQueue }: { onOpenQueue: () => void }) {
  const { width } = useWindowDimensions();
  const [state, setState] = useState<EcosystemState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<Range>('24h');

  const load = useCallback(async (visible = false) => {
    if (visible) setRefreshing(true);
    try {
      setState(await fetchEcosystemState());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Network unavailable');
    } finally {
      if (visible) setRefreshing(false);
    }
  }, []);

  // A screen left open in a pocket keeps its timer but stops asking, and asks
  // once immediately when the app is looked at again.
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void load(); }, REFRESH_MS);
    const subscription = AppState.addEventListener('change', (next) => { if (next === 'active') void load(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [load]);

  const metrics = state?.metrics;
  const period = state?.analytics?.windows?.[range];
  const hours = state?.analytics?.hourly ?? [];
  // History starts when our own indexer started. A range longer than that is
  // shown, but never pretended to be complete.
  const coverageDays = state?.analytics?.coverageFrom ? (state.analytics.generatedAt - state.analytics.coverageFrom) / 86_400 : 0;
  const partial = coverageDays > 0 && coverageDays < RANGE_DAYS[range] * 0.98;
  const horizon = metrics?.unlockHorizon;
  const chartWidth = width - spacing.lg * 2 - spacing.md * 2;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.accent} />}
    >
      <View style={styles.hero}>
        <Eyebrow>Staked of total supply</Eyebrow>
        <View style={styles.heroRow}>
          <FlipNumber value={metrics ? splitCompact(metrics.activeStaked).figure : '—'} size={78} />
          <Text style={styles.heroUnit}>{metrics ? splitCompact(metrics.activeStaked).unit : 'SKR'}</Text>
        </View>
        <Text style={styles.heroNote}>
          {metrics
            ? `${metrics.stakedPercent.toFixed(2)}% of the ${compact(metrics.supply)} SKR total supply · ${integer(metrics.totalPositions)} positions`
            : error ? 'Waiting for a finalized answer' : 'Reading the vault'}
        </Text>
      </View>
      <View style={styles.meterWrap}>
        <Meter percent={metrics?.stakedPercent ?? 0} />
      </View>

      <Panel style={styles.flowPanel}>
        <View style={styles.flowHead}>
          <Eyebrow>{RANGE_TITLE[range]}</Eyebrow>
          <RangeSwitch value={range} options={[...RANGES]} onChange={(next) => setRange(next as Range)} />
        </View>

        <FlowChart
          hours={range === '24h' ? hours : period ? [{ staked: period.staked, unstaked: period.unstaked }] : []}
          width={chartWidth}
          maxBar={range === '24h' ? undefined : 72}
        />
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.positive }]} />
            <Text style={styles.legendText}>{period ? `${compact(period.staked)} staked` : 'staked'}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.negative }]} />
            <Text style={styles.legendText}>{period ? `${compact(period.unstaked)} asked out` : 'asked out'}</Text>
          </View>
          <Text style={styles.legendMuted}>{period ? `${integer(period.wallets)} wallets` : ''}</Text>
        </View>
        <Text style={styles.shape}>
          {range === '24h' ? 'one bar per hour' : `${RANGE_TITLE[range].toLowerCase()} as one total · daily bars need a server pass`}
        </Text>

        <View style={styles.flowFoot}>
          <Text style={[styles.netFlow, { color: (period?.netFlow ?? 0) >= 0 ? colors.positive : colors.negative }]}>
            {period ? `${period.netFlow >= 0 ? '+' : '−'}${compact(Math.abs(period.netFlow))} net` : '—'}
          </Text>
          {partial ? <Text style={styles.partial}>history covers {Math.floor(coverageDays)}d</Text> : null}
        </View>
      </Panel>

      <View style={styles.tiles}>
        <Tile
          label="In cooldown"
          value={metrics ? compact(metrics.pendingUnstake) : '—'}
          unit="SKR"
          note={metrics ? `${integer(metrics.pendingPositions)} positions waiting out the 48 hours` : undefined}
          tone={colors.pending}
          onPress={onOpenQueue}
        />
        <Tile
          label="Ready to exit"
          value={metrics ? compact(metrics.withdrawable) : '—'}
          unit="SKR"
          note="Cooldown finished, not yet withdrawn"
          tone={colors.positive}
          onPress={onOpenQueue}
        />
      </View>

      <Panel style={styles.railPanel}>
        <Eyebrow>When the queue matures</Eyebrow>
        <View style={styles.railBody}>
          <HorizonRail
            bands={[
              { label: 'ready', value: horizon?.ready ?? 0, tone: colors.positive, display: horizon ? compact(horizon.ready) : '—' },
              { label: '0–6h', value: horizon?.next6h ?? 0, tone: colors.pending, display: horizon ? compact(horizon.next6h) : '—' },
              { label: '6–12h', value: horizon?.next12h ?? 0, tone: colors.pending, display: horizon ? compact(horizon.next12h) : '—' },
              { label: '12–24h', value: horizon?.next24h ?? 0, tone: colors.accent, display: horizon ? compact(horizon.next24h) : '—' },
              { label: '24–48h', value: horizon?.next48h ?? 0, tone: colors.accent, display: horizon ? compact(horizon.next48h) : '—' },
            ]}
          />
        </View>
      </Panel>

      <Evidence
        lines={[
          `commitment  finalized · ${state?.status.phase ?? 'syncing'}`,
          `vault read  ${relativeTime(metrics?.updatedAt ?? null)}`,
          `guardians   ${metrics ? `${metrics.guardians.count}, top pool ${metrics.guardians.topConcentrationPercent.toFixed(1)}%` : '—'}`,
          error ? `last error  ${error}` : 'source      skr.alexkosa.dev · own indexer',
        ]}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 120, gap: spacing.lg },
  hero: { gap: spacing.sm },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, marginTop: spacing.xs },
  heroUnit: { color: colors.muted, fontFamily: font.semibold, fontSize: 15, letterSpacing: 0.6, marginBottom: 5 },
  heroNote: { color: colors.muted, fontFamily: font.regular, ...type.small, marginTop: spacing.xs },
  meterWrap: { marginTop: -spacing.sm },
  flowPanel: { padding: spacing.md },
  flowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  flowFoot: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line },
  partial: { color: colors.pending, fontFamily: font.medium, ...type.micro },
  shape: { color: colors.faint, fontFamily: font.regular, ...type.micro, marginTop: spacing.sm },
  netFlow: { fontFamily: font.bold, fontSize: 14, fontVariant: ['tabular-nums'] },
  legend: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { color: colors.text, fontFamily: font.medium, ...type.small },
  legendMuted: { marginLeft: 'auto', color: colors.muted, fontFamily: font.regular, ...type.small },
  tiles: { flexDirection: 'row', gap: spacing.md },
  railPanel: { padding: spacing.md },
  railBody: { marginTop: spacing.md },
});
