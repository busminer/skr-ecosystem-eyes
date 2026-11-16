import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SvgUri } from 'react-native-svg';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Haptics from 'expo-haptics';
import { API_BASE_URL } from '../api';
import { integer } from '../format';
import {
  BUILD_VERSION_CODE,
  BUILD_VERSION_NAME,
  guardianLabel,
  guardianTone,
  iconUrl,
  releaseName,
  shortKey,
  useReleaseReceipt,
  useStoreGuardians,
  type ReleaseReceipt,
  type StoreGuardian,
  type StoreGuardians,
  type StoreRelease,
  type Verdict,
} from '../guardians';
import { t } from '../i18n';
import { prefValue } from '../prefs';
import { colors, font, radius, spacing, type } from '../theme';
import { Evidence, Eyebrow, Panel } from './kit';
import { GUARDIAN_BADGES } from './guardianLogos';
import { GUARDIAN_SCENE_HTML } from './guardianSceneHtml';

// The guardians tab, second drawing (Alex, 16.11.2026: "an app comes in, a
// guardian jumps up and checks it, it turns green and goes down into the
// store; turned away, it goes red and does not pass").
//
// The scene up top is the world itself (guardianSceneHtml.ts, by the senior
// model): the guardians as struck medallions, the belt, the trapdoor, the
// store's moon with the day's passed apps along its edge. Under it, what is
// read rather than watched: the day in one strip, the releases with the
// seconds and the verdict of every vote, the three guardians, this build's
// own receipt, and where all of it comes from.
//
// Every app goes by its store name and icon; one the store does not list yet,
// by the name its publisher registered on chain. Package names are not shown.

const RELEASES_SHOWN = 8;
// Replay on request only (Alex, 16.11.2026): the last hour, six hours, a day.
const REPLAY_WINDOWS = [
  { hours: 1, seconds: 3_600 },
  { hours: 6, seconds: 21_600 },
  { hours: 24, seconds: 86_400 },
];
const MONOGRAM_TONES = ['#3B5568', '#4B4A6B', '#3F5E55', '#5D4A3F'];

function seconds(value: number | null | undefined): string {
  if (value == null) return '—';
  if (value < 120) return `${value}s`;
  if (value < 7_200) return `${Math.round(value / 60)}m`;
  return `${Math.round(value / 3_600)}h`;
}

function age(at: number | null | undefined): string {
  if (!at) return '—';
  const gap = Math.max(0, Math.floor(Date.now() / 1000) - at);
  return gap < 60 ? `${gap}s` : gap < 3_600 ? `${Math.floor(gap / 60)}m` : `${Math.floor(gap / 3_600)}h`;
}

function ago(at: number | null | undefined): string {
  return at ? t('{age} ago', { age: age(at) }) : '—';
}

function sinceDate(at: number | null): string {
  if (!at) return '—';
  return new Date(at * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function openTx(sig: string | null | undefined) {
  if (!sig) return;
  void Haptics.selectionAsync();
  void Linking.openURL(`https://solscan.io/tx/${sig}`).catch(() => undefined);
}

function verdictTone(verdict: Verdict): string {
  return verdict === 'approved' ? colors.positive : verdict === 'rejected' ? colors.negative : colors.faint;
}

function verdictWord(verdict: Verdict): string {
  return verdict === 'approved' ? t('Passed') : verdict === 'rejected' ? t('Turned away') : t('Voting');
}

// Any alphabet: split on spaces and punctuation, not on what a letter is.
function initials(name: string): string {
  const [first = '', second = ''] = name.split(/[\s:;.,_\-–—()[\]{}'"!?&+/|]+/).filter(Boolean);
  if (!first) return '?';
  if (!second) return first.slice(0, 2);
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
}

function toneFor(text: string): string {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return MONOGRAM_TONES[hash % MONOGRAM_TONES.length] ?? colors.lineStrong;
}

type Picked = { kind: 'guardian'; key: string } | { kind: 'release'; key: string } | null;

function Scene({ data, height, active, onPick }: { data: StoreGuardians | null; height: number; active: boolean; onPick: (picked: Picked) => void }) {
  const web = useRef<WebView>(null);
  const ready = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  // The window being replayed, or null while the scene is live.
  const [lapse, setLapse] = useState<number | null>(null);
  const push = useCallback((message: object) => {
    web.current?.injectJavaScript(`window.__push(${JSON.stringify(message)});true;`);
  }, []);
  const configure = useCallback(() => {
    push({
      type: 'config',
      logos: true,
      hud: true,
      // Live only (Alex, 16.11.2026): nothing old goes round again unless asked.
      ambient: false,
      iconBase: API_BASE_URL,
      labels: {
        live: t('LIVE'),
        lapse: t('24 HOURS'),
        lapse1h: t('LAST HOUR'),
        lapse6h: t('6 HOURS'),
        lapse24h: t('24 HOURS'),
        lapseEmpty: t('nothing in this window'),
        passed: t('passed · 24h'),
        ago: t('{age} ago'),
        lastVote: t('last vote {age} ago'),
        waiting: t('waiting for votes'),
      },
    });
    push({ type: 'motion', mode: prefValue('motion:off', false) ? 'off' : prefValue('motion:calm', false) ? 'calm' : 'live' });
    // The replay button sits over the bottom edge; nothing of the scene's own may hide under it.
    push({ type: 'inset', top: 0, bottom: 52 });
  }, [push]);
  useEffect(() => { if (ready.current && data) push({ type: 'state', ...data }); }, [data, push]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => push({ type: 'pause', on: next !== 'active' }));
    return () => subscription.remove();
  }, [push]);
  useEffect(() => { push({ type: 'pause', on: !active }); }, [active, push]);
  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as {
        type: string; kind?: string; key?: string; state?: string; approve?: boolean; window?: number;
      };
      if (message.type === 'ready') {
        ready.current = true;
        configure();
        if (data) push({ type: 'state', ...data });
      } else if (message.type === 'tap') {
        void Haptics.selectionAsync();
        if (message.kind === 'guardian' && message.key) onPick({ kind: 'guardian', key: message.key });
        else if (message.kind === 'release' && message.key) onPick({ kind: 'release', key: message.key });
        else onPick(null);
      } else if (message.type === 'cue' && activeRef.current && AppState.currentState === 'active') {
        // A real vote or verdict, as it is played (never a replayed one).
        if (message.kind === 'approved') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        else if (message.kind === 'rejected') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        else if (message.kind === 'vote') void Haptics.impactAsync(message.approve === false ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
      } else if (message.type === 'timelapse') {
        setLapse(message.state === 'start' ? message.window ?? 86_400 : null);
      }
    } catch {
      // A message the scene did not mean to send is not worth a crash.
    }
  }, [configure, data, onPick, push]);
  return (
    <View style={[styles.scene, { height }]}>
      <WebView
        ref={web}
        source={{ html: GUARDIAN_SCENE_HTML }}
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
        style={styles.sceneWeb}
      />
      <View style={styles.lapseBar}>
        {lapse ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => { void Haptics.selectionAsync(); push({ type: 'timelapse', on: false }); }}
            style={({ pressed }) => [styles.lapsePill, styles.lapsePillOn, pressed && styles.pressed]}
          >
            <Text style={[styles.lapseText, { color: colors.bg }]}>{t('Stop')}</Text>
          </Pressable>
        ) : (
          <>
            <Text style={styles.lapseLabel}>{t('Replay')}</Text>
            {REPLAY_WINDOWS.map((window) => (
              <Pressable
                key={window.seconds}
                accessibilityRole="button"
                accessibilityLabel={`${t('Replay')} ${t('{hours} h', { hours: window.hours })}`}
                onPress={() => { void Haptics.selectionAsync(); push({ type: 'timelapse', on: true, window: window.seconds }); }}
                style={({ pressed }) => [styles.lapsePill, pressed && styles.pressed]}
              >
                <Text style={styles.lapseText}>{t('{hours} h', { hours: window.hours })}</Text>
              </Pressable>
            ))}
          </>
        )}
      </View>
    </View>
  );
}

function DayStrip({ data }: { data: StoreGuardians | null }) {
  const cells = [
    { value: data ? integer(data.today.releases) : '—', label: t('releases today') },
    { value: data ? integer(data.today.votes) : '—', label: t('votes today') },
    { value: data ? seconds(data.today.medianSeconds) : '—', label: t('median to a vote') },
  ];
  return (
    <Panel style={styles.strip}>
      {cells.map((cell, index) => (
        <View key={cell.label} style={[styles.stripCell, index > 0 && styles.stripDivider]}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.stripValue}>{cell.value}</Text>
          <Text numberOfLines={1} style={styles.stripLabel}>{cell.label}</Text>
        </View>
      ))}
    </Panel>
  );
}

function AppIcon({ release, size = 40 }: { release: StoreRelease; size?: number }) {
  const [broken, setBroken] = useState(false);
  const uri = broken ? null : iconUrl(release.icon);
  const name = releaseName(release);
  const frame = { width: size, height: size, borderRadius: size * 0.24 };
  // An icon drawn from the release APK comes as SVG (its address ends .svg).
  if (uri && uri.endsWith('.svg')) {
    return (
      <View style={[styles.icon, frame, styles.iconClip, release.ours && styles.iconOurs]}>
        <SvgUri uri={uri} width={size} height={size} onError={() => setBroken(true)} />
      </View>
    );
  }
  return uri ? (
    <Image source={{ uri }} onError={() => setBroken(true)} style={[styles.icon, frame, release.ours && styles.iconOurs]} />
  ) : (
    <View style={[styles.icon, styles.monogram, frame, { backgroundColor: toneFor(name) }, release.ours && styles.iconOurs]}>
      <Text style={[styles.monogramText, { fontSize: size * 0.36 }]}>{initials(name)}</Text>
    </View>
  );
}

function Badge({ id, size = 18 }: { id: string | null; size?: number }) {
  const source = id ? GUARDIAN_BADGES[id] : null;
  if (!source) return <View style={[styles.badgeBlank, { width: size, height: size, borderRadius: size / 2 }]} />;
  return <Image source={{ uri: source }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
}

function ReleaseRow({ release, guardians, open, onPress, onLayout }: {
  release: StoreRelease; guardians: StoreGuardian[]; open: boolean; onPress: () => void; onLayout: (y: number) => void;
}) {
  const tone = verdictTone(release.verdict);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      onLayout={(event) => onLayout(event.nativeEvent.layout.y)}
      style={({ pressed }) => [styles.release, open && styles.releaseOpen, pressed && styles.pressed]}
    >
      <View style={styles.releaseMain}>
        <AppIcon release={release} />
        <View style={styles.releaseText}>
          <View style={styles.releaseHead}>
            <Text numberOfLines={1} style={[styles.releaseName, release.ours && { color: colors.metal }]}>{releaseName(release)}</Text>
            <Text style={[styles.verdict, { color: tone }]}>{verdictWord(release.verdict)}</Text>
          </View>
          <Text numberOfLines={1} style={styles.releaseMeta}>
            {[release.versionName ? `v${release.versionName}` : `#${release.versionCode}`, ago(release.requestedAt), release.liveAt ? t('In the store') : null].filter(Boolean).join(' · ')}
          </Text>
          <View style={styles.releaseVotes}>
            {guardians.map((guardian) => {
              const vote = release.votes.find((item) => item.guardian === guardian.key);
              return (
                <View key={guardian.key} style={styles.voteChip}>
                  <Badge id={guardian.id} size={14} />
                  <Text style={[styles.voteText, { color: vote ? (vote.approve ? colors.positive : colors.negative) : colors.dim }]}>
                    {vote ? seconds(vote.seconds) : '…'}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      </View>
      {open ? (
        <View style={styles.releaseLinks}>
          <Text onPress={() => openTx(release.sig)} style={styles.link}>{t('Request on Solscan')}</Text>
          {release.votes.map((vote) => {
            const guardian = guardians.find((item) => item.key === vote.guardian);
            return (
              <Pressable key={vote.sig} onPress={() => openTx(vote.sig)} style={({ pressed }) => [styles.voteLine, pressed && styles.pressed]}>
                <Badge id={guardian?.id ?? null} size={16} />
                <Text style={styles.voteWho}>{guardian ? guardianLabel(guardian) : shortKey(vote.guardian)}</Text>
                <Text style={[styles.voteSay, { color: vote.approve ? colors.positive : colors.negative }]}>{vote.approve ? t('yes') : t('no')}</Text>
                <Text style={styles.voteWhen}>{`+${seconds(vote.seconds)}`}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </Pressable>
  );
}

function GuardianRow({ guardian, picked, onPress }: { guardian: StoreGuardian; picked: boolean; onPress: () => void }) {
  const tone = guardianTone(guardian.id);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.guardian, picked && { borderColor: tone }, pressed && styles.pressed]}>
      <Badge id={guardian.id} size={34} />
      <View style={styles.guardianText}>
        <Text numberOfLines={1} style={styles.guardianName}>{guardianLabel(guardian)}</Text>
        <Text numberOfLines={1} style={styles.guardianNote}>{t('last vote {age} ago', { age: age(guardian.lastVoteAt) })}</Text>
      </View>
      <View style={styles.guardianNumbers}>
        <Text style={styles.guardianValue}>{integer(guardian.votes24h)}</Text>
        <Text numberOfLines={1} style={styles.guardianNote}>{t('median {seconds}', { seconds: seconds(guardian.medianSeconds24h ?? guardian.medianSecondsAll) })}</Text>
      </View>
    </Pressable>
  );
}

// This build, its request and every vote on it: one line, opened on a tap.
function Receipt({ receipt, total }: { receipt: ReleaseReceipt; total: number }) {
  const [open, setOpen] = useState(false);
  const last = receipt.votes.length ? Math.max(...receipt.votes.map((vote) => vote.seconds)) : null;
  const verdict = receipt.verdict ?? 'pending';
  return (
    <Pressable accessibilityRole="button" onPress={() => { void Haptics.selectionAsync(); setOpen(!open); }} style={({ pressed }) => [pressed && styles.pressed]}>
      <Panel tone={colors.metal} style={styles.receipt}>
        <Eyebrow tone={colors.metal}>{t('This release')}</Eyebrow>
        <View style={styles.releaseHead}>
          <Text style={[styles.receiptLine, { flex: 1 }]}>
            {[`SKR Eyes ${receipt.versionName || BUILD_VERSION_NAME}`, t('{voted} of {total} voted', { voted: integer(receipt.votes.length), total: integer(Math.max(total, receipt.votes.length)) }), last != null ? seconds(last) : null].filter(Boolean).join(' · ')}
          </Text>
          <Text style={[styles.verdict, { color: verdictTone(verdict) }]}>{verdictWord(verdict)}</Text>
        </View>
        {open ? (
          <>
            <Pressable onPress={() => openTx(receipt.request.sig)} style={({ pressed }) => [styles.receiptRow, pressed && styles.pressed]}>
              <Text style={styles.receiptWho}>{t('Request')}</Text>
              <Text style={styles.receiptWhen}>{new Date(receipt.request.at * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</Text>
            </Pressable>
            {receipt.votes.map((vote) => (
              <Pressable key={vote.sig} onPress={() => openTx(vote.sig)} style={({ pressed }) => [styles.receiptRow, pressed && styles.pressed]}>
                <Badge id={vote.id} size={16} />
                <Text style={styles.receiptWho}>{guardianLabel(vote)}</Text>
                <Text style={styles.receiptWhen}>{`+${vote.seconds}s`}</Text>
                <Text style={[styles.receiptVerdict, { color: vote.approve ? colors.positive : colors.negative }]}>{vote.approve ? t('yes') : t('no')}</Text>
              </Pressable>
            ))}
            {!receipt.complete ? <Text style={styles.receiptNote}>{t('More votes may still arrive.')}</Text> : null}
          </>
        ) : null}
      </Panel>
    </Pressable>
  );
}

export function GuardiansLab({ active }: { active: boolean }) {
  const { width } = useWindowDimensions();
  const { data, error } = useStoreGuardians(active);
  const { receipt } = useReleaseReceipt(active);
  const [picked, setPicked] = useState<Picked>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const place = useRef({ pad: 0, list: 0, guardians: 0, rows: {} as Record<string, number> });
  const pendingScroll = useRef<string | null>(null);

  const releases = useMemo(() => [...(data?.releases || [])].reverse(), [data]);
  const shown = all ? releases : releases.slice(0, RELEASES_SHOWN);
  const guardians = data?.guardians || [];
  const pickedGuardian = picked?.kind === 'guardian' ? picked.key : null;

  const scrollTo = useCallback((y: number) => {
    scroll.current?.scrollTo({ y: Math.max(0, y - spacing.lg), animated: true });
  }, []);

  const onPick = useCallback((next: Picked) => {
    setPicked(next);
    if (next?.kind === 'release') {
      setOpenRow(next.key);
      const index = releases.findIndex((release) => release.key === next.key);
      if (index >= RELEASES_SHOWN) setAll(true);
      const y = place.current.rows[next.key];
      if (y != null) scrollTo(place.current.pad + place.current.list + y);
      else pendingScroll.current = next.key;
    } else if (next?.kind === 'guardian') {
      scrollTo(place.current.pad + place.current.guardians);
    }
  }, [releases, scrollTo]);

  const totals = data
    ? t('Since {date}: {votes} votes on {releases} releases from {apps} apps.', {
      date: sinceDate(data.totals.since),
      votes: integer(data.totals.votes),
      releases: integer(data.totals.releases),
      apps: integer(data.totals.apps),
    })
    : null;

  return (
    <ScrollView ref={scroll} style={styles.screen} contentContainerStyle={styles.content}>
      <Scene data={data} height={Math.round(Math.min(width * 1.32, 600))} active={active} onPick={onPick} />

      <View style={styles.pad} onLayout={(event) => { place.current.pad = event.nativeEvent.layout.y; }}>
        <DayStrip data={data} />
        {!data && error ? <Text style={styles.listNote}>{t('The guardians could not be read just now.')}</Text> : null}

        {releases.length ? (
          <View onLayout={(event) => { place.current.list = event.nativeEvent.layout.y; }}>
            <Panel style={styles.list}>
              <Eyebrow>{t('Latest releases')}</Eyebrow>
              <Text style={styles.listNote}>{t('Each app with the seconds every guardian took, in the colour of its vote. Tap for the transactions.')}</Text>
              {shown.map((release) => (
                <ReleaseRow
                  key={release.key}
                  release={release}
                  guardians={guardians}
                  open={openRow === release.key}
                  onPress={() => { void Haptics.selectionAsync(); setOpenRow(openRow === release.key ? null : release.key); }}
                  onLayout={(y) => {
                    // The panel's own padding sits between it and its rows.
                    place.current.rows[release.key] = y;
                    if (pendingScroll.current === release.key) {
                      pendingScroll.current = null;
                      scrollTo(place.current.pad + place.current.list + y);
                    }
                  }}
                />
              ))}
              {releases.length > RELEASES_SHOWN ? (
                <Text onPress={() => { void Haptics.selectionAsync(); setAll(!all); }} style={styles.more}>
                  {all ? t('Show fewer') : t('Show all {count}', { count: integer(releases.length) })}
                </Text>
              ) : null}
            </Panel>
          </View>
        ) : null}

        {guardians.length ? (
          <View onLayout={(event) => { place.current.guardians = event.nativeEvent.layout.y; }}>
            <Panel style={styles.list}>
              <Eyebrow>{t('Guardians')}</Eyebrow>
              {guardians.map((guardian) => (
                <GuardianRow
                  key={guardian.key}
                  guardian={guardian}
                  picked={pickedGuardian === guardian.key}
                  onPress={() => { void Haptics.selectionAsync(); setPicked(pickedGuardian === guardian.key ? null : { kind: 'guardian', key: guardian.key }); }}
                />
              ))}
            </Panel>
          </View>
        ) : null}

        {receipt && receipt.versionCode === BUILD_VERSION_CODE ? <Receipt receipt={receipt} total={data?.activeGuardians ?? guardians.length} /> : null}

        {totals ? <Evidence lines={[totals]} /> : null}
        <Text style={styles.fine}>{t('Read from the store\'s guardian program on chain ({program}) by our own indexer. A vote is not the release itself: the store lists an approved build later, often hours later. Apps go by their store name and icon; one the store does not list yet, by the name registered on chain.', { program: shortKey(data?.program || 'GUARDsVUfAaydbPU6QGcpWRLUkExaULtaygwEtkdhZAD') })}</Text>
        <Text style={styles.fine}>{t('Solana Mobile, Jito and Helius are named and shown only to say whose vote is whose. SKR Eyes is independent of them.')}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: 130 },
  pad: { paddingHorizontal: spacing.lg, gap: spacing.md, marginTop: spacing.sm },
  pressed: { opacity: 0.75 },
  scene: { width: '100%', overflow: 'hidden' },
  sceneWeb: { flex: 1, backgroundColor: 'transparent' },
  lapseBar: { position: 'absolute', right: spacing.lg, bottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: 6 },
  lapseLabel: { color: colors.muted, fontFamily: font.medium, fontSize: 12, marginRight: 2 },
  lapsePill: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: 'rgba(7, 12, 18, 0.82)', paddingHorizontal: spacing.md, paddingVertical: 7, minWidth: 48, alignItems: 'center' },
  lapsePillOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  lapseText: { color: colors.text, fontFamily: font.semibold, fontSize: 12, letterSpacing: 0.3 },
  strip: { flexDirection: 'row', paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
  stripCell: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: spacing.xs },
  stripDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.line },
  stripValue: { color: colors.text, fontFamily: font.monoBold, fontSize: 22 },
  stripLabel: { color: colors.faint, fontFamily: font.medium, ...type.eyebrow },
  list: { gap: spacing.sm, padding: spacing.lg },
  listNote: { color: colors.faint, fontFamily: font.regular, fontSize: 12, lineHeight: 17 },
  release: { paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, gap: spacing.sm },
  releaseOpen: { backgroundColor: 'rgba(255, 255, 255, 0.025)' },
  releaseMain: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  releaseText: { flex: 1, gap: 3 },
  releaseHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  releaseName: { flex: 1, color: colors.text, fontFamily: font.semibold, fontSize: 14.5 },
  releaseMeta: { color: colors.faint, fontFamily: font.mono, fontSize: 11 },
  verdict: { fontFamily: font.semibold, fontSize: 11.5, letterSpacing: 0.2 },
  releaseVotes: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: 2 },
  voteChip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  voteText: { fontFamily: font.monoSemibold, fontSize: 11.5 },
  icon: { backgroundColor: colors.line },
  iconOurs: { borderWidth: 1.5, borderColor: colors.metal },
  iconClip: { overflow: 'hidden' },
  monogram: { alignItems: 'center', justifyContent: 'center' },
  monogramText: { color: 'rgba(242, 247, 251, 0.86)', fontFamily: font.bold },
  badgeBlank: { backgroundColor: colors.lineStrong },
  releaseLinks: { gap: 2, paddingLeft: 40 + spacing.md },
  link: { color: colors.accent, fontFamily: font.medium, fontSize: 12.5, paddingVertical: 4 },
  voteLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 },
  voteWho: { flex: 1, color: colors.text, fontFamily: font.medium, fontSize: 12.5 },
  voteSay: { fontFamily: font.monoBold, fontSize: 11.5, minWidth: 28, textAlign: 'right' },
  voteWhen: { color: colors.muted, fontFamily: font.mono, fontSize: 12, minWidth: 40, textAlign: 'right' },
  more: { color: colors.accent, fontFamily: font.medium, fontSize: 13, paddingVertical: spacing.xs, alignSelf: 'flex-start' },
  guardian: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, marginHorizontal: -spacing.sm, borderRadius: radius.inner, borderWidth: 1, borderColor: 'transparent' },
  guardianText: { flex: 1, gap: 2 },
  guardianName: { color: colors.text, fontFamily: font.semibold, fontSize: 14.5 },
  guardianNumbers: { alignItems: 'flex-end', gap: 2 },
  guardianValue: { color: colors.text, fontFamily: font.monoBold, fontSize: 18 },
  guardianNote: { color: colors.faint, fontFamily: font.mono, fontSize: 10.5 },
  receipt: { gap: spacing.sm, padding: spacing.lg, borderWidth: 1, borderColor: colors.metalDim },
  receiptLine: { color: colors.text, fontFamily: font.semibold, fontSize: 14 },
  receiptRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  receiptWho: { flex: 1, color: colors.text, fontFamily: font.semibold, fontSize: 13 },
  receiptWhen: { color: colors.muted, fontFamily: font.mono, fontSize: 12.5 },
  receiptVerdict: { fontFamily: font.monoBold, fontSize: 12.5, minWidth: 30, textAlign: 'right' },
  receiptNote: { color: colors.muted, fontFamily: font.regular, fontSize: 13, lineHeight: 18 },
  fine: { color: colors.dim, fontFamily: font.regular, fontSize: 11, lineHeight: 16 },
});
