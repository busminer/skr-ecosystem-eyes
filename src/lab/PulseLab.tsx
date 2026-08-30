import { useCallback, useEffect, useState } from 'react';
import { AppState, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { fetchEcosystemState } from '../api';
import { t } from '../i18n';
import { compact, integer, relativeTime } from '../format';
import { colors, font, spacing, type } from '../theme';
import type { EcosystemState } from '../types';
import { DayHeat } from './DayHeat';
import { Evidence, Eyebrow, HorizonRail, Panel, RangeSwitch, Tile } from './kit';

const REFRESH_MS = 30_000;
const RANGES = ['24h', '7d', '30d'] as const;
type Range = typeof RANGES[number];
const RANGE_DAYS: Record<Range, number> = { '24h': 1, '7d': 7, '30d': 30 };
const RANGE_TITLE: Record<Range, string> = { '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days' };
const RANGE_NOTE: Record<Range, string> = {
  '24h': 'over the last 24 hours',
  '7d': 'over the last 7 days',
  '30d': 'over the last 30 days',
};

// The hero splits the magnitude off the number so the unit can sit quietly
// beside it instead of competing with it.
function splitCompact(value: number): { figure: string; unit: string } {
  const text = compact(value);
  const suffix = text.slice(-1);
  if (suffix === 'B' || suffix === 'M' || suffix === 'K') return { figure: text.slice(0, -1), unit: `${suffix} SKR` };
  return { figure: text, unit: 'SKR' };
}

// One fact per card, big enough to read across a room and short enough to
// repeat to somebody else. A row of numbers is a table; this is a headline.
function FactCard({ label, value, note, tone, width }: { label: string; value: string; note: string; tone?: string; width: number }) {
  return (
    <Panel style={[styles.fact, { width }]} tone={tone}>
      <Text numberOfLines={1} style={styles.factLabel}>{label.toUpperCase()}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={[styles.factValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text numberOfLines={2} style={styles.factNote}>{note}</Text>
    </Panel>
  );
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
      setError(caught instanceof Error ? caught.message : t('Network unavailable'));
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

  const note = t(RANGE_NOTE[range]);
  const inner = width - spacing.lg * 2;
  const factWidth = Math.min(inner * 0.62, 230);
  const hero = metrics ? splitCompact(metrics.activeStaked) : null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.accent} />}
    >
      <DayHeat
        width={inner}
        hours={hours}
        percent={metrics?.stakedPercent ?? null}
        figure={hero ? hero.figure : '—'}
        unit={hero ? hero.unit : 'SKR'}
        note={metrics
          ? t('{percent}% of all SKR is staked', { percent: metrics.stakedPercent.toFixed(2) })
          : error ? t('Waiting for a finalized answer') : t('Reading the vault')}
      />

      {/* One set of numbers, not two. The switch above the cards changes what
          they count, and the cards read left to right in the order somebody
          would ask it out loud: how much went in, how much asked out, what that
          leaves, and how many people it took. */}
      <View style={styles.periodHead}>
        <Eyebrow>{t(RANGE_TITLE[range])}</Eyebrow>
        <RangeSwitch value={range} options={[...RANGES]} onChange={(next) => setRange(next as Range)} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={factWidth + spacing.md}
        decelerationRate="fast"
        contentContainerStyle={styles.facts}
      >
        <FactCard width={factWidth} note={note} label={t('staked')} value={period ? compact(period.staked) : '—'} tone={colors.positive} />
        <FactCard width={factWidth} note={note} label={t('asked out')} value={period ? compact(period.unstaked) : '—'} tone={colors.negative} />
        <FactCard
          width={factWidth}
          note={note}
          label={t('net')}
          value={period ? `${period.netFlow >= 0 ? '+' : '−'}${compact(Math.abs(period.netFlow))}` : '—'}
          tone={(period?.netFlow ?? 0) >= 0 ? colors.positive : colors.negative}
        />
        <FactCard width={factWidth} note={note} label={t('wallets')} value={period ? integer(period.wallets) : '—'} tone={colors.metal} />
      </ScrollView>

      {partial ? <Text style={styles.partial}>{t('history covers {days}d', { days: Math.floor(coverageDays) })}</Text> : null}

      <View style={styles.tiles}>
        <Tile
          label={t('In cooldown')}
          value={metrics ? compact(metrics.pendingUnstake) : '—'}
          unit="SKR"
          note={metrics ? t('{count} positions waiting out the 48 hours', { count: integer(metrics.pendingPositions) }) : undefined}
          tone={colors.pending}
          onPress={onOpenQueue}
        />
        <Tile
          label={t('Ready to exit')}
          value={metrics ? compact(metrics.withdrawable) : '—'}
          unit="SKR"
          note={t('Cooldown finished, not yet withdrawn')}
          tone={colors.positive}
          onPress={onOpenQueue}
        />
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
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 120, gap: spacing.lg },
  facts: { gap: spacing.md, paddingRight: spacing.lg },
  fact: { padding: spacing.md, minHeight: 108, justifyContent: 'space-between' },
  factLabel: { color: colors.muted, fontFamily: font.semibold, ...type.eyebrow },
  factValue: { color: colors.text, fontFamily: font.black, fontVariant: ['tabular-nums'], fontSize: 30, letterSpacing: -1 },
  factNote: { color: colors.faint, fontFamily: font.regular, ...type.micro },
  periodHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: -spacing.sm },
  partial: { color: colors.pending, fontFamily: font.medium, ...type.micro },
  tiles: { flexDirection: 'row', gap: spacing.md },
  railPanel: { padding: spacing.md },
  railBody: { marginTop: spacing.md },
});
