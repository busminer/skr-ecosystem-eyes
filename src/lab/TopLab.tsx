import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import { ApiError, fetchTop, findTop } from '../api';
import { t } from '../i18n';
import { compact, integer, shortAddress } from '../format';
import { requestTab, takeTabRequest } from '../nav';
import { prefValue } from '../prefs';
import { readSessionAddress } from '../session';
import { colors, font, gold, radius, spacing, type } from '../theme';
import type { TopList, TopMe, TopPage, TopRow, TopTier } from '../types';
import { Button, Eyebrow } from './kit';
import { RADAR_SCENE_HTML } from './radarSceneHtml';

// Top: everybody who stakes, in order, and where you stand among them.
//
// Places are counted among people. The fifty one treasury-size wallets that
// hold four fifths of the vault are set aside by the server and named as one
// line at the foot of the list, so #1 here is a person.
//
// Three orders over the same people: by stake, by what the position has earned
// since its last move (the same estimate Me shows), and by places gained or
// lost since yesterday's scan. The list arrives a hundred rows at a time; the
// card at the top is this phone's own place, read from the same answer.

const PAGE = 100;
const LISTS: Array<{ key: TopList; label: string; note: string }> = [
  { key: 'stake', label: 'BY STAKE', note: 'Active stake in the vault. Treasury-size wallets are set aside.' },
  { key: 'earned', label: 'BY EARNED', note: 'Rewards since each wallet\'s last stake or unstake, from the share price at entry. Read from the chain.' },
  { key: 'movers', label: 'MOVERS · 24H', note: 'Places gained or lost since yesterday\'s scan, among the top 1 000 people.' },
];

type Loaded = { rows: TopRow[]; total: number; page: TopPage };

function who(row: TopRow): string {
  return row.name ? `${row.name}.skr` : shortAddress(row.wallet);
}

function tierLabel(tier: string): string {
  return tier === 'Bottom half' ? t('Bottom half') : t('Top {p}', { p: tier.replace(/^Top\s+/, '') });
}

// ▲74 / ▼1 / — / new: how a place moved since yesterday.
function Delta({ row, size = 10 }: { row: { prevRank: number | null; rank: number }; size?: number }) {
  if (row.prevRank == null) return <Text style={[styles.delta, { fontSize: size }]}>{t('new')}</Text>;
  const move = row.prevRank - row.rank;
  if (move === 0) return <Text style={[styles.delta, { fontSize: size }]}>—</Text>;
  return <Text style={[styles.delta, { fontSize: size, color: move > 0 ? colors.positive : colors.negative }]}>{`${move > 0 ? '▲' : '▼'}${Math.abs(move)}`}</Text>;
}

// The phone from the scene, as a mark beside a name.
function PhoneMark({ me = false }: { me?: boolean }) {
  return (
    <View style={[styles.phone, me && styles.phoneMe]}>
      <View style={[styles.phoneScreen, me && styles.phoneScreenMe]} />
    </View>
  );
}

// The dial: the radar at 64 px, alive, with this person gold on it. The rings
// keep the proportions of the full radar, so what it shows is a real preview.
function MiniRadar({ tiers, rank, people, size = 64 }: { tiers: TopTier[]; rank: number | null; people: number; size?: number }) {
  const [angle, setAngle] = useState(-1.2);
  useEffect(() => {
    if (prefValue('motion:off', false)) return;
    const step = prefValue('motion:calm', false) ? 0.05 : 0.1;
    const timer = setInterval(() => setAngle((current) => current + step), 80);
    return () => clearInterval(timer);
  }, []);
  const rings = useMemo(() => {
    const widths = [68, 42, 36, 32, 28, 26, 22];
    let acc = 58;
    const list = tiers.map((tier, index) => { acc += widths[index] ?? 24; return { ...tier, r: acc, inner: acc - (widths[index] ?? 24) }; });
    const outer = list.length ? list[list.length - 1]!.r : 1;
    return list.map((ring) => ({ ...ring, r: ring.r / outer, inner: ring.inner / outer }));
  }, [tiers]);
  const dots = useMemo(() => {
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    return rings.slice(0, 3).flatMap((ring, index) => Array.from({ length: [10, 22, 34][index] ?? 12 }, () => ({ a: rnd() * 6.283, r: ring.inner + 0.1 * (ring.r - ring.inner) + rnd() * 0.8 * (ring.r - ring.inner) })));
  }, [rings]);
  const cx = size / 2;
  const R = size / 2 - 2;
  const meRing = useMemo(() => {
    if (rank == null || !rings.length) return null;
    let acc = 0;
    for (const ring of rings) { acc += ring.count; if (rank <= acc) return ring; }
    return rings[rings.length - 1];
  }, [rank, rings]);
  const meR = meRing ? (meRing.inner + (meRing.r - meRing.inner) * 0.5) * R : null;
  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cx} r={R} fill="#0A1722" />
      {rings.map((ring) => <Circle key={ring.label} cx={cx} cy={cx} r={ring.r * R} stroke="rgba(120,180,205,0.22)" strokeWidth={1} fill="none" />)}
      <Line x1={cx} y1={cx} x2={cx + Math.cos(angle) * R} y2={cx + Math.sin(angle) * R} stroke={colors.accent} strokeOpacity={0.55} strokeWidth={1} />
      {dots.map((dot, index) => {
        const lit = Math.max(0, 1 - (((dot.a - angle) % 6.283) + 6.283) % 6.283 / 2.4);
        return <Rect key={index} x={cx + Math.cos(dot.a) * dot.r * R - 0.7} y={cx + Math.sin(dot.a) * dot.r * R - 0.7} width={1.4} height={1.4} fill={colors.positive} fillOpacity={0.3 + 0.5 * lit} />;
      })}
      {meR != null ? (
        <>
          <Circle cx={cx + Math.cos(-1.1) * meR} cy={cx + Math.sin(-1.1) * meR} r={5} fill={colors.metal} fillOpacity={0.28} />
          <Rect x={cx + Math.cos(-1.1) * meR - 1.5} y={cx + Math.sin(-1.1) * meR - 1.5} width={3} height={3} fill={colors.metal} />
        </>
      ) : null}
      <Circle cx={cx} cy={cx} r={R * 0.16} fill="#0B1F2B" stroke="rgba(140,190,215,0.3)" strokeWidth={1} />
    </Svg>
  );
}

// The full radar, on the same WebView approach as the vault scene.
function RadarSheet({ page, onClose }: { page: TopPage; onClose: () => void }) {
  const web = useRef<WebView>(null);
  const ready = useRef(false);
  const [hit, setHit] = useState<TopRow | null>(null);
  const push = useCallback((message: object) => { web.current?.injectJavaScript(`window.__push(${JSON.stringify(message)});true;`); }, []);
  const feed = useCallback(() => {
    push({ type: 'data', people: page.people, tiers: page.tiers, rows: page.rows.slice(0, PAGE), me: page.me });
    push({ type: 'motion', mode: prefValue('motion:off', false) ? 'off' : prefValue('motion:calm', false) ? 'calm' : 'live' });
  }, [page, push]);
  useEffect(() => { if (ready.current) feed(); }, [feed]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => push({ type: 'pause', on: next !== 'active' }));
    return () => subscription.remove();
  }, [push]);
  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as { type: string; row?: TopRow };
      if (data.type === 'ready') { ready.current = true; feed(); }
      else if (data.type === 'tap' && data.row) { void Haptics.selectionAsync(); setHit(data.row); }
    } catch {
      // A message the radar did not mean to send is not worth a crash.
    }
  }, [feed]);
  return (
    <View style={styles.radarSheet}>
      <WebView
        ref={web}
        source={{ html: RADAR_SCENE_HTML }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled={false}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        androidLayerType="hardware"
        setBuiltInZoomControls={false}
        mixedContentMode="never"
        allowFileAccess={false}
        onMessage={onMessage}
        style={styles.radarWeb}
      />
      <Pressable accessibilityRole="button" onPress={() => { void Haptics.selectionAsync(); onClose(); }} style={({ pressed }) => [styles.radarBack, pressed && { opacity: 0.7 }]}>
        <Text style={styles.radarBackText}>{`‹ ${t('Back to top')}`}</Text>
      </Pressable>
      <View style={styles.radarHint} pointerEvents="none">
        <Text style={styles.radarHintText}>{hit ? `${who(hit)} · ${tierLabel(hit.tier)}` : t('Pinch to zoom, drag to look around, tap a phone or a ring.')}</Text>
      </View>
    </View>
  );
}

export function TopLab() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [list, setList] = useState<TopList>('stake');
  const [loaded, setLoaded] = useState<Partial<Record<TopList, Loaded>>>({});
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<TopRow[] | null>(null);
  const [radar, setRadar] = useState(false);
  const [youAway, setYouAway] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const listRef = useRef<FlatList<TopRow>>(null);
  const loading = useRef<string | null>(null);
  const ticket = useRef(0);
  const youHeight = useRef(0);
  // How the tab was opened: Me asks for the person's own row.
  const opening = useRef(takeTabRequest('top'));

  useEffect(() => {
    let alive = true;
    const read = () => { void readSessionAddress().then((address) => { if (alive) setWallet(address); }); };
    read();
    const subscription = AppState.addEventListener('change', (next) => { if (next === 'active') read(); });
    return () => { alive = false; subscription.remove(); };
  }, []);

  const current = loaded[list];
  const page = current?.page ?? loaded.stake?.page ?? loaded.earned?.page ?? loaded.movers?.page ?? null;
  const me: TopMe | null = page?.me ?? null;
  const meFound = me && me.found ? me : null;

  const load = useCallback(async (which: TopList, offset: number, fresh = false) => {
    const key = `${which}:${offset}:${wallet ?? ''}`;
    if (loading.current === key) return;
    loading.current = key;
    const mine = ++ticket.current;
    if (offset === 0 && !fresh) setBusy(true);
    setError(null);
    try {
      const next = await fetchTop({ list: which, offset, limit: PAGE, wallet });
      if (mine !== ticket.current && offset === 0) return;
      setLoaded((previous) => {
        const before = offset === 0 ? [] : previous[which]?.rows ?? [];
        return { ...previous, [which]: { rows: [...before, ...next.rows], total: next.total, page: next } };
      });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 503) setError(t('The leaderboard is still being counted. Try again in a moment.'));
      else setError(caught instanceof Error ? caught.message : t('The leaderboard could not be read'));
    } finally {
      if (loading.current === key) loading.current = null;
      setBusy(false);
      setRefreshing(false);
    }
  }, [wallet]);

  // A new wallet, or the first look: the first page of the current list.
  useEffect(() => {
    setLoaded({});
    void load(list, 0);
    // The list is loaded on its own change below; the wallet resets everything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);

  useEffect(() => {
    if (!loaded[list]) void load(list, 0);
  }, [list, load, loaded]);

  const more = useCallback(() => {
    const have = loaded[list];
    if (!have || busy || have.rows.length >= have.total || query) return;
    void load(list, have.rows.length);
  }, [busy, list, load, loaded, query]);

  // The search: the loaded rows first, then the server for a name or an
  // address beyond them. Debounced so a person typing does not fire a request
  // per letter.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setFound(null); return; }
    const timer = setTimeout(() => {
      findTop(q).then((result) => setFound(result.rows)).catch(() => setFound([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const rows = useMemo(() => {
    const own = loaded[list]?.rows ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return own;
    const local = own.filter((row) => (row.name ?? '').toLowerCase().includes(q) || row.wallet.toLowerCase().startsWith(q));
    const seen = new Set(local.map((row) => row.wallet));
    return [...local, ...(found ?? []).filter((row) => !seen.has(row.wallet))];
  }, [found, list, loaded, query]);

  const scrollToMe = useCallback(async () => {
    if (!meFound) return;
    const have = loaded.stake;
    if (list !== 'stake') setList('stake');
    const index = have?.rows.findIndex((row) => row.wallet === meFound.wallet) ?? -1;
    if (index >= 0) {
      listRef.current?.scrollToIndex({ index, viewPosition: 0.3, animated: true });
      setFlash(meFound.wallet);
      setTimeout(() => setFlash(null), 1_600);
      return;
    }
    // Not loaded yet: pages up to the person's place, at most twenty of them.
    const target = Math.min(meFound.rank, PAGE * 20);
    let offset = have?.rows.length ?? 0;
    while (offset < target) {
      // eslint-disable-next-line no-await-in-loop
      await load('stake', offset, true);
      offset += PAGE;
    }
    setTimeout(() => {
      const again = loaded.stake?.rows.findIndex((row) => row.wallet === meFound.wallet) ?? -1;
      if (again >= 0) listRef.current?.scrollToIndex({ index: again, viewPosition: 0.3, animated: true });
    }, 250);
  }, [list, load, loaded.stake, meFound]);

  // Opened from Me: land on the person's own row once the first page is in.
  useEffect(() => {
    if (opening.current?.wallet && meFound && loaded.stake) {
      opening.current = null;
      void scrollToMe();
    }
  }, [loaded.stake, meFound, scrollToMe]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setYouAway(event.nativeEvent.contentOffset.y > youHeight.current + 40);
  }, []);

  const pick = useCallback((next: TopList) => {
    if (next === list) return;
    void Haptics.selectionAsync();
    setList(next);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [list]);

  const note = LISTS.find((item) => item.key === list)?.note ?? '';
  const total = loaded[list]?.total ?? 0;

  const header = (
    <View onLayout={(event) => { youHeight.current = event.nativeEvent.layout.height; }}>
      <View style={styles.head}>
        <View style={styles.headCopy}>
          <Text style={styles.title}>{t('Top stakers')}</Text>
          <Text style={styles.subtitle}>{page ? t('{people} people · ranked among people', { people: integer(page.people) }) : t('counting…')}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Search')} onPress={() => { void Haptics.selectionAsync(); setSearching((on) => { if (on) setQuery(''); return !on; }); }} style={({ pressed }) => [styles.searchBtn, searching && styles.searchBtnOn, pressed && { opacity: 0.7 }]}>
          <Svg width={18} height={18} viewBox="0 0 24 24"><Circle cx={10.5} cy={10.5} r={6.5} stroke={searching ? colors.accent : colors.muted} strokeWidth={2.2} fill="none" /><Line x1={15.5} y1={15.5} x2={21} y2={21} stroke={searching ? colors.accent : colors.muted} strokeWidth={2.2} strokeLinecap="round" /></Svg>
        </Pressable>
      </View>
      {searching ? (
        <View style={styles.searchRow}>
          <TextInput
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('.skr name or address')}
            placeholderTextColor={colors.faint}
            value={query}
            onChangeText={setQuery}
            style={styles.searchInput}
          />
          {query.trim() ? <Text style={styles.searchCount}>{rows.length ? (rows.length === 1 ? t('1 match') : t('{count} matches', { count: rows.length })) : found == null ? '' : t('no match')}</Text> : null}
        </View>
      ) : null}
      <View style={styles.tabs}>
        {LISTS.map((item) => {
          const on = item.key === list;
          return (
            <Pressable key={item.key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => pick(item.key)} style={({ pressed }) => [styles.tab, on && styles.tabOn, pressed && { opacity: 0.7 }]}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={[styles.tabText, on && styles.tabTextOn]}>{t(item.label)}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.tabNote}>{t(note)}</Text>

      {meFound ? (
        <Pressable accessibilityRole="button" onPress={() => { void Haptics.selectionAsync(); setRadar(true); }} style={({ pressed }) => [styles.you, pressed && { opacity: 0.85 }]}>
          <View style={styles.youCopy}>
            <Eyebrow tone={colors.metal}>{t('You')}</Eyebrow>
            <View style={styles.youRankRow}>
              <Text style={styles.youRank}>{`#${integer(meFound.rank)}`}</Text>
              <Text style={styles.youOf}>{t('of {people} people', { people: integer(page?.people ?? 0) })}</Text>
            </View>
            <View style={styles.youFacts}>
              <Text style={[styles.youFact, styles.youFactGold]}>{tierLabel(meFound.tier).toUpperCase()}</Text>
              <Text style={styles.youFact}>{meFound.prevRank == null ? t('NEW') : meFound.prevRank === meFound.rank ? '— 24H' : `${meFound.prevRank > meFound.rank ? '▲' : '▼'}${Math.abs(meFound.prevRank - meFound.rank)} 24H`}</Text>
              <Text style={styles.youFact}>{`${compact(meFound.staked)} SKR`}</Text>
              <Text style={[styles.youFact, { color: colors.positive }]}>{`+${compact(meFound.earned)} ${t('EARNED')} · #${integer(meFound.earnedRank)}`}</Text>
            </View>
          </View>
          {/* The dial is the door to the radar, so it says so: a bare circle
              reads as decoration and nobody presses it. */}
          <Pressable accessibilityRole="button" accessibilityLabel={t('Open radar')} onPress={() => { void Haptics.selectionAsync(); setRadar(true); }} style={({ pressed }) => [styles.youDial, pressed && styles.youDialOn]}>
            <View style={styles.youDialFace}>
              <MiniRadar tiers={page?.tiers ?? []} rank={meFound.rank} people={page?.people ?? 0} size={56} />
            </View>
            <Text numberOfLines={1} style={styles.youDialLabel}>{`${t('Open radar')} ↗`}</Text>
          </Pressable>
          <View style={styles.youShare}>
            <Button label={`${t('Share my place')} ↗`} tone={colors.metal} onPress={() => { void Haptics.selectionAsync(); requestTab({ tab: 'me', share: true }); }} />
          </View>
        </Pressable>
      ) : page && !wallet ? (
        <View style={styles.connect}>
          <Text style={styles.connectText}>{t('Connect on Me to see your place.')}</Text>
          <Button label={t('Open Me')} ghost onPress={() => requestTab({ tab: 'me' })} />
        </View>
      ) : page && me && !me.found ? (
        <View style={styles.connect}>
          <Text style={styles.connectText}>{me.treasury ? t('This wallet is treasury-size and is set aside from the people\'s list.') : t('This wallet holds no active stake, so it has no place yet.')}</Text>
        </View>
      ) : null}
    </View>
  );

  const foot = (
    <View style={styles.foot}>
      {busy && loaded[list] ? <ActivityIndicator color={colors.accent} /> : null}
      {error ? <Pressable onPress={() => void load(list, loaded[list]?.rows.length ?? 0)}><Text style={styles.error}>{error}</Text></Pressable> : null}
      {page && !query ? (
        list === 'movers' ? (
          <Text style={styles.footText}>{page.movers.available
            ? t('Since yesterday\'s scan · {count} wallets moved among the top 1 000 people.', { count: integer(total) })
            : t('Movers start tomorrow: the first daily snapshot of places was taken today.')}</Text>
        ) : (
          <Text style={styles.footText}>{`${t('{shown} of {people} people shown · more load as you scroll.', { shown: integer(loaded[list]?.rows.length ?? 0), people: integer(page.people) })}\n${t('{count} treasury-size wallets set aside: {total} SKR, no names, no moves.', { count: page.treasury.count, total: compact(page.treasury.total) })}`}</Text>
        )
      ) : null}
      {query.trim() && !rows.length && found != null ? <Text style={styles.footText}>{t('Nobody by that name in the list. Paste a full address and the server finds its place.')}</Text> : null}
    </View>
  );

  const renderRow = useCallback(({ item }: { item: TopRow }) => {
    const mine = meFound?.wallet === item.wallet;
    const top3 = (list === 'earned' ? item.earnedRank : item.rank) <= 3;
    const first = (list === 'earned' ? item.earnedRank : item.rank) === 1;
    const lit = flash === item.wallet;
    return (
      <View style={[styles.row, top3 && styles.rowTop3, mine && styles.rowMe, lit && styles.rowLit]}>
        <View style={styles.rank}>
          <Text style={[styles.rankNo, top3 && { color: colors.accent }, first && { color: colors.metal }, mine && { color: colors.metal }]}>{`#${integer(list === 'earned' ? item.earnedRank : item.rank)}`}</Text>
          {list === 'movers'
            ? <Text style={styles.delta}>{t('was #{rank}', { rank: integer(item.prevRank ?? item.rank) })}</Text>
            : list === 'earned'
              ? <Text style={styles.delta}>{t('by earned')}</Text>
              : <Delta row={item} />}
        </View>
        <PhoneMark me={mine} />
        <View style={styles.nameCell}>
          <Text numberOfLines={1} style={[styles.name, !item.name && styles.nameAddr]}>{who(item)}</Text>
          <Text numberOfLines={1} style={styles.sub}>
            {list === 'stake'
              ? `${tierLabel(item.tier)} · ${t('earned')} +${compact(item.earned)}`
              : list === 'earned'
                ? `${compact(item.staked)} SKR ${t('staked')} · #${integer(item.rank)} ${t('by stake')}`
                : `${compact(item.staked)} SKR · ${tierLabel(item.tier)}`}
          </Text>
        </View>
        <View style={styles.amount}>
          {list === 'movers' ? (
            <>
              <Text style={[styles.amountValue, { color: (item.delta ?? 0) > 0 ? colors.positive : colors.negative }]}>{`${(item.delta ?? 0) > 0 ? '▲' : '▼'}${Math.abs(item.delta ?? 0)}`}</Text>
              <Text style={styles.amountUnit}>{t('places · 24h')}</Text>
            </>
          ) : list === 'earned' ? (
            <>
              <Text style={[styles.amountValue, { color: colors.positive }]}>{`+${compact(item.earned)}`}</Text>
              <Text style={styles.amountUnit}>{`SKR ${t('earned')}`}</Text>
            </>
          ) : (
            <>
              <Text style={styles.amountValue}>{compact(item.staked)}</Text>
              <Text style={styles.amountUnit}>SKR</Text>
            </>
          )}
        </View>
      </View>
    );
  }, [flash, list, meFound?.wallet]);

  return (
    <View style={styles.screen}>
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(row) => row.wallet}
        renderItem={renderRow}
        ListHeaderComponent={header}
        ListFooterComponent={foot}
        ListEmptyComponent={busy && !loaded[list] ? <ActivityIndicator color={colors.accent} style={styles.spinner} /> : null}
        contentContainerStyle={styles.content}
        onEndReached={more}
        onEndReachedThreshold={0.6}
        onScroll={onScroll}
        scrollEventThrottle={64}
        onScrollToIndexFailed={() => undefined}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setLoaded({}); void load(list, 0, true); }} tintColor={colors.accent} colors={[colors.accent]} progressBackgroundColor={colors.panel} />}
        initialNumToRender={20}
        windowSize={7}
      />
      {meFound && youAway && list !== 'movers' ? (
        <Pressable accessibilityRole="button" onPress={() => { void Haptics.selectionAsync(); void scrollToMe(); }} style={({ pressed }) => [styles.meBar, pressed && { opacity: 0.85 }]}>
          <View style={styles.meDot} />
          <Text style={styles.meName}>{who(meFound)}</Text>
          <Text style={styles.meRank}>{`#${integer(meFound.rank)}`}<Text style={styles.meRankSmall}>{` ${t('Me')}`}</Text></Text>
        </Pressable>
      ) : null}
      {radar && page ? <RadarSheet page={{ ...page, rows: loaded.stake?.rows.slice(0, PAGE) ?? page.rows }} onClose={() => setRadar(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 140 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xs, paddingTop: spacing.xs },
  headCopy: { flex: 1, gap: 2 },
  title: { color: colors.text, fontFamily: font.black, fontSize: 24, letterSpacing: -0.8 },
  subtitle: { color: colors.muted, fontFamily: font.regular, ...type.small },
  searchBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panel },
  searchBtnOn: { borderColor: colors.accentDim, backgroundColor: colors.panelHi },
  searchRow: { marginTop: spacing.md, gap: spacing.xs },
  searchInput: { minHeight: 44, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.inner, paddingHorizontal: spacing.md, color: colors.text, backgroundColor: colors.panel, fontFamily: font.mono, fontSize: 13 },
  searchCount: { color: colors.faint, fontFamily: font.mono, fontSize: 10.5, paddingHorizontal: spacing.xs },
  tabs: { flexDirection: 'row', gap: 4, marginTop: spacing.md, backgroundColor: 'rgba(4,7,11,0.72)', borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, padding: 3 },
  tab: { flex: 1, paddingVertical: 8, paddingHorizontal: 4, borderRadius: radius.pill, alignItems: 'center' },
  tabOn: { backgroundColor: colors.panelHi },
  tabText: { color: colors.faint, fontFamily: font.monoBold, fontSize: 10, letterSpacing: 0.8 },
  tabTextOn: { color: colors.accent },
  tabNote: { color: colors.faint, fontFamily: font.mono, fontSize: 9.5, letterSpacing: 0.4, textAlign: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.md },
  you: { marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.card, borderWidth: 1, borderColor: colors.metalDim, backgroundColor: '#0E0D09' },
  youCopy: { flex: 1, gap: 4, minWidth: 180 },
  youRankRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  youRank: { color: colors.text, fontFamily: font.black, fontSize: 30, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  youOf: { color: colors.muted, fontFamily: font.regular, ...type.small },
  youFacts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 2 },
  youFact: { color: colors.muted, fontFamily: font.monoBold, fontSize: 9.5, letterSpacing: 0.6 },
  youFactGold: { color: colors.metal },
  youDial: { alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: radius.card, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: 'rgba(4,7,11,0.5)' },
  youDialOn: { borderColor: colors.accentDim, backgroundColor: colors.panelHi },
  youDialFace: { width: 56, height: 56, borderRadius: 28, overflow: 'hidden' },
  youDialLabel: { color: colors.accent, fontFamily: font.monoBold, fontSize: 9.5, letterSpacing: 0.4 },
  youShare: { width: '100%' },
  connect: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, gap: spacing.md },
  connectText: { color: colors.muted, fontFamily: font.regular, ...type.body },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radius.card, backgroundColor: colors.panel, marginTop: spacing.sm },
  rowTop3: { borderColor: colors.accentDim },
  rowMe: { borderColor: colors.metalDim, backgroundColor: '#100F09' },
  rowLit: { borderColor: colors.metal },
  rank: { width: 44, gap: 1 },
  rankNo: { color: colors.faint, fontFamily: font.monoBold, fontSize: 12, fontVariant: ['tabular-nums'] },
  delta: { color: colors.faint, fontFamily: font.mono, fontSize: 10 },
  phone: { width: 14, height: 24, borderRadius: 3, backgroundColor: '#2a3f4c', borderWidth: 1, borderColor: '#5f8494', padding: 2 },
  phoneMe: { backgroundColor: '#6b5630', borderColor: '#e8cf95' },
  phoneScreen: { flex: 1, borderRadius: 2, backgroundColor: '#9ff6d2' },
  phoneScreenMe: { backgroundColor: '#ffe9b8' },
  nameCell: { flex: 1, gap: 2 },
  name: { fontFamily: font.monoSemibold, fontSize: 13.5, ...gold },
  nameAddr: { color: colors.muted, fontFamily: font.mono, textShadowColor: 'transparent' },
  sub: { color: colors.faint, fontFamily: font.regular, fontSize: 10.5 },
  amount: { alignItems: 'flex-end' },
  amountValue: { color: colors.text, fontFamily: font.bold, fontSize: 14, fontVariant: ['tabular-nums'] },
  amountUnit: { color: colors.muted, fontFamily: font.semibold, fontSize: 10.5 },
  foot: { paddingVertical: spacing.lg, gap: spacing.md, alignItems: 'center' },
  footText: { color: colors.faint, fontFamily: font.mono, fontSize: 10.5, textAlign: 'center', lineHeight: 16 },
  error: { color: colors.negative, fontFamily: font.medium, ...type.small, textAlign: 'center' },
  spinner: { marginTop: spacing.xl },
  meBar: { position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: '#100F09', borderWidth: 1, borderColor: colors.metalDim, borderRadius: radius.card, paddingVertical: 10, paddingHorizontal: spacing.md },
  meDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.metal },
  meName: { fontFamily: font.monoSemibold, fontSize: 14, ...gold },
  meRank: { marginLeft: 'auto', color: colors.text, fontFamily: font.black, fontSize: 20, letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  meRankSmall: { color: colors.muted, fontFamily: font.semibold, fontSize: 11, letterSpacing: 0 },
  radarSheet: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.bg },
  radarWeb: { flex: 1, backgroundColor: colors.bg },
  radarBack: { position: 'absolute', top: spacing.md, left: spacing.md, paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: 'rgba(4,7,11,0.8)', borderWidth: 1, borderColor: colors.lineStrong },
  radarBackText: { color: colors.text, fontFamily: font.semibold, fontSize: 13 },
  radarHint: { position: 'absolute', left: spacing.md, right: spacing.md, top: spacing.md + 44, alignItems: 'center' },
  radarHintText: { color: colors.faint, fontFamily: font.mono, fontSize: 10, textAlign: 'center' },
});
