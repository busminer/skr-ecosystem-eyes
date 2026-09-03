import { useCallback, useEffect, useState } from 'react';
import { AppState, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fetchEcosystemState } from '../api';
import { t } from '../i18n';
import { compact, integer, shortAddress } from '../format';
import { colors, font, gold, spacing, type } from '../theme';
import type { EcosystemState } from '../types';
import { Evidence, Eyebrow, Hero, HorizonRail, Panel } from './kit';

const REFRESH_MS = 45_000;

function remaining(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${String(hours % 24).padStart(2, '0')}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m ${String(safe % 60).padStart(2, '0')}s`;
}

// The same rule as the feed: a person, not an address. The short address is
// the fallback for the rare wallet with no Seeker ID, and it keeps the mono
// face — a name is read, an address is only recognised.
function who(position: { name?: string | null; wallet: string }): string {
  return position.name ? `${position.name}.skr` : shortAddress(position.wallet);
}

export function QueueLab() {
  const [state, setState] = useState<EcosystemState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1_000));

  const load = useCallback(async (visible = false) => {
    if (visible) setRefreshing(true);
    try {
      setState(await fetchEcosystemState());
    } catch {
      // The screen keeps the last finalized answer rather than blanking out.
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

  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1_000));
    const timer = setInterval(tick, 1_000);
    const subscription = AppState.addEventListener('change', (next) => { if (next === 'active') tick(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);

  const metrics = state?.metrics;
  const horizon = metrics?.unlockHorizon;
  const queue = [...(metrics?.queue ?? [])].sort((left, right) => left.unlockAt - right.unlockAt);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.accent} />}
    >
      <Hero
        label={t('Ready to withdraw')}
        value={metrics ? compact(metrics.withdrawable) : '—'}
        unit="SKR"
        tone={colors.positive}
        small
        note={metrics ? t('{amount} SKR is still cooling down across {count} positions', { amount: compact(metrics.pendingUnstake), count: integer(metrics.pendingPositions) }) : t('Reading the queue')}
      />

      <Panel style={styles.panel}>
        <Eyebrow>{t('Time to maturity')}</Eyebrow>
        <View style={styles.rail}>
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

      <View style={styles.listHead}>
        <Eyebrow>{t('Exits in flight, soonest first')}</Eyebrow>
        <Text style={styles.listCount}>{t('{count} shown', { count: queue.length })}</Text>
      </View>

      <Panel style={styles.list}>
        {queue.map((position, index) => {
          const ready = position.status === 'withdrawable' || position.unlockAt <= now;
          return (
            <View key={position.stakeAccount} style={[styles.row, index > 0 && styles.rowDivided]}>
              <View style={[styles.rowMark, { backgroundColor: ready ? colors.positive : colors.pending }]} />
              <View style={styles.rowBody}>
                <Text style={styles.rowAmount}>{compact(position.amount)} SKR</Text>
                <Text numberOfLines={1} style={position.name ? styles.rowName : styles.rowWallet}>{who(position)}</Text>
              </View>
              <Text style={[styles.rowTime, { color: ready ? colors.positive : colors.text }]}>
                {ready ? t('ready') : remaining(position.unlockAt - now)}
              </Text>
            </View>
          );
        })}
        {queue.length === 0 ? <Text style={styles.empty}>{t('Nothing is queued to leave right now.')}</Text> : null}
      </Panel>

      <Evidence
        lines={[
          'rule       an unstake request starts a 48 hour cooldown',
          'rule       a withdraw is the exit; the queue is not money out yet',
          `scan       ${metrics ? `${integer(metrics.pendingPositions)} positions in cooldown` : '—'}`,
          'listing    exits ordered by unlock time, from the finalized scan',
        ]}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 130, gap: spacing.lg },
  panel: { padding: spacing.md },
  rail: { marginTop: spacing.md },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
});
