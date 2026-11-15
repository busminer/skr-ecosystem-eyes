import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Haptics from 'expo-haptics';
import { compact, integer } from '../format';
import {
  BUILD_VERSION_CODE,
  BUILD_VERSION_NAME,
  guardianLabel,
  guardianTone,
  releaseRows,
  shortKey,
  useReleaseReceipt,
  useStoreGuardians,
  type ReleaseReceipt,
  type ReleaseRow,
  type StoreGuardian,
  type StoreGuardians,
} from '../guardians';
import { t } from '../i18n';
import { prefValue } from '../prefs';
import { colors, font, radius, spacing, type } from '../theme';
import { Eyebrow, Hero, Inset, Panel } from './kit';
import { GUARDIAN_SCENE_HTML } from './guardianSceneHtml';

// The guardians tab (1.6.0, Alex 15.11.2026): SKR Eyes watched the vault, and
// now it watches the dApp Store's guardians too. Every release to the store is
// asked for on chain and voted on, on chain, by Solana Mobile, Jito and Helius;
// nobody else shows those votes as they happen.
//
// The scene up top is the living picture (guardianSceneHtml.ts). Under it, in
// the app's usual panels: today in one number, each guardian's pace, the
// releases of the last hours with the seconds each vote took, this very
// build's own receipt, and the SKR that stands behind the guardian pools.
//
// Whether a vote said yes or no is shown for one release only: this one.

// The marks of Solana Mobile, Jito and Helius belong to them. Drawn in the
// scene only when this is on; otherwise each guardian wears its initials in
// its own colour. Alex's call before the build (15.11.2026).
const SHOW_GUARDIAN_LOGOS = true;

function seconds(value: number | null | undefined): string {
  if (value == null) return '—';
  if (value < 120) return `${value}s`;
  return `${Math.round(value / 60)}m`;
}

function ago(at: number | null | undefined): string {
  if (!at) return '—';
  const gap = Math.max(0, Math.floor(Date.now() / 1000) - at);
  const age = gap < 60 ? `${gap}s` : gap < 3_600 ? `${Math.floor(gap / 60)}m` : `${Math.floor(gap / 3_600)}h`;
  return t('{age} ago', { age });
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

type Picked =
  | { kind: 'guardian'; key: string }
  | { kind: 'request'; app: string; versionCode: number }
  | null;

function Scene({ data, height, onPick }: { data: StoreGuardians | null; height: number; onPick: (picked: Picked) => void }) {
  const web = useRef<WebView>(null);
  const ready = useRef(false);
  const [lapse, setLapse] = useState(false);
  const push = useCallback((message: object) => {
    web.current?.injectJavaScript(`window.__push(${JSON.stringify(message)});true;`);
  }, []);
  const configure = useCallback(() => {
    push({
      type: 'config',
      logos: SHOW_GUARDIAN_LOGOS,
      // Our own releases are drawn in gold, the way your own phone is on Top.
      // Eyes above, radar below: a phone is always tall.
      orient: 'v',
      mePkg: 'dev.alexkosa.skreyes',
      meLabel: 'SKR Eyes',
      labels: {
        live: t('LIVE'),
        replay: t('REPLAY'),
        lapse: t('24 HOURS'),
        releases: t('releases'),
        votes: t('votes'),
        apps: t('apps'),
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
  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { type: string; kind?: string; key?: string; app?: string; versionCode?: number; state?: string };
      if (message.type === 'ready') {
        ready.current = true;
        configure();
        if (data) push({ type: 'state', ...data });
      } else if (message.type === 'tap') {
        void Haptics.selectionAsync();
        if (message.kind === 'guardian' && message.key) onPick({ kind: 'guardian', key: message.key });
        else if (message.kind === 'request' && message.app && message.versionCode != null) onPick({ kind: 'request', app: message.app, versionCode: message.versionCode });
        else onPick(null);
      } else if (message.type === 'timelapse') {
        setLapse(message.state === 'start');
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
      <Pressable
        accessibilityRole="button"
        onPress={() => { void Haptics.selectionAsync(); push({ type: 'timelapse', on: !lapse, seconds: 20 }); }}
        style={({ pressed }) => [styles.lapseButton, lapse && styles.lapseButtonOn, pressed && styles.pressed]}
      >
        <Text style={[styles.lapseText, lapse && { color: colors.bg }]}>{lapse ? t('Stop') : t('Replay 24 hours')}</Text>
      </Pressable>
    </View>
  );
}

function GuardianTile({ guardian, picked, onPress }: { guardian: StoreGuardian; picked: boolean; onPress: () => void }) {
  const tone = guardianTone(guardian.id);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.tileWrap, pressed && styles.pressed]}>
      <Panel style={[styles.tile, picked && { borderColor: tone }]} tone={tone}>
        <Text numberOfLines={1} style={[styles.tileName, { color: tone }]}>{guardianLabel(guardian)}</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.tileValue}>{integer(guardian.votes24h)}</Text>
        <Text numberOfLines={1} style={styles.tileUnit}>{t('votes today')}</Text>
        <Text numberOfLines={1} style={styles.tileNote}>{t('median {seconds}', { seconds: seconds(guardian.medianSeconds24h ?? guardian.medianSecondsAll) })}</Text>
        <Text numberOfLines={1} style={styles.tileNote}>{t('{count} in all', { count: integer(guardian.votesTotal) })}</Text>
      </Panel>
    </Pressable>
  );
}

function GuardianDetail({ guardian }: { guardian: StoreGuardian }) {
  const tone = guardianTone(guardian.id);
  return (
    <Panel tone={tone} style={styles.detail}>
      <Eyebrow tone={tone}>{guardianLabel(guardian)}</Eyebrow>
      <Text style={styles.detailLine}>{t('First vote {date} · {count} votes since', { date: sinceDate(guardian.firstVoteAt), count: integer(guardian.votesTotal) })}</Text>
      <Text style={styles.detailLine}>{t('Last vote {age}', { age: ago(guardian.lastVoteAt) })}</Text>
      <Text style={styles.detailLine}>{t('Median from request to vote: {today} today, {all} overall', { today: seconds(guardian.medianSeconds24h), all: seconds(guardian.medianSecondsAll) })}</Text>
      <Text selectable style={styles.mono}>{guardian.key}</Text>
    </Panel>
  );
}

function ReleaseLine({ row, guardians, open, onPress }: { row: ReleaseRow; guardians: StoreGuardian[]; open: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      <Inset style={[styles.release, open && styles.releaseOpen]}>
        <View style={styles.releaseHead}>
          <Text numberOfLines={1} style={styles.releasePkg}>{row.pkg || shortKey(row.app)}</Text>
          <Text style={styles.releaseAge}>{ago(row.at)}</Text>
        </View>
        <View style={styles.releaseVotes}>
          <Text style={styles.releaseVersion}>{row.versionName ? `v${row.versionName}` : `#${row.versionCode}`}</Text>
          {guardians.map((guardian) => {
            const vote = row.votes.find((item) => item.guardian === guardian.key);
            const tone = guardianTone(guardian.id);
            return (
              <View key={guardian.key} style={styles.voteChip}>
                <View style={[styles.voteDot, { backgroundColor: vote ? tone : 'transparent', borderColor: tone }]} />
                <Text style={[styles.voteText, { color: vote ? colors.text : colors.dim }]}>{vote ? seconds(vote.seconds) : '…'}</Text>
              </View>
            );
          })}
        </View>
        {open ? (
          <View style={styles.releaseLinks}>
            <Text onPress={() => openTx(row.request?.sig)} style={styles.link}>{t('Request on Solscan')}</Text>
            {row.votes.map((vote) => {
              const guardian = guardians.find((item) => item.key === vote.guardian);
              return <Text key={vote.sig} onPress={() => openTx(vote.sig)} style={styles.link}>{`${guardian ? guardianLabel(guardian) : shortKey(vote.guardian || '')} · ${seconds(vote.seconds)}`}</Text>;
            })}
          </View>
        ) : null}
      </Inset>
    </Pressable>
  );
}

// This build, its request and every vote on it, with the verdict: the one
// release in the app that is ours to show in full.
function Receipt({ receipt, missing }: { receipt: ReleaseReceipt | null; missing: boolean }) {
  const last = receipt?.votes.length ? Math.max(...receipt.votes.map((vote) => vote.seconds)) : null;
  return (
    <Panel tone={colors.metal} style={styles.receipt}>
      <Eyebrow tone={colors.metal}>{t('This release')}</Eyebrow>
      <Text style={styles.receiptTitle}>{`SKR Eyes ${receipt?.versionName || BUILD_VERSION_NAME} (${BUILD_VERSION_CODE})`}</Text>
      {receipt ? (
        <>
          {last != null ? (
            <View style={styles.receiptHero}>
              <Text style={styles.receiptNumber}>{seconds(last)}</Text>
              <Text style={styles.receiptCaption}>{t('from the release request to the last guardian vote')}</Text>
            </View>
          ) : null}
          <Pressable onPress={() => openTx(receipt.request.sig)} style={({ pressed }) => [styles.receiptRow, pressed && styles.pressed]}>
            <Text style={styles.receiptWho}>{t('Request')}</Text>
            <Text style={styles.receiptWhen}>{new Date(receipt.request.at * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</Text>
            <Text style={styles.receiptMono}>{shortKey(receipt.request.sig)}</Text>
          </Pressable>
          {receipt.votes.map((vote) => (
            <Pressable key={vote.sig} onPress={() => openTx(vote.sig)} style={({ pressed }) => [styles.receiptRow, pressed && styles.pressed]}>
              <Text style={[styles.receiptWho, { color: guardianTone(vote.id) }]}>{guardianLabel(vote)}</Text>
              <Text style={styles.receiptWhen}>{`+${vote.seconds}s`}</Text>
              <Text style={[styles.receiptVerdict, { color: vote.approve ? colors.positive : colors.negative }]}>{vote.approve ? 'YES' : 'NO'}</Text>
            </Pressable>
          ))}
          {!receipt.complete ? <Text style={styles.receiptNote}>{t('More votes may still arrive.')}</Text> : null}
        </>
      ) : (
        <Text style={styles.receiptNote}>{missing ? t('The receipt appears here once this build\'s guardian votes are on chain.') : t('Reading the chain…')}</Text>
      )}
      <Text style={styles.receiptFine}>{t('Every dApp Store release is voted on chain by the store\'s guardians. A vote admits the build to the store. It is not an endorsement of the app.')}</Text>
    </Panel>
  );
}

export function GuardiansLab({ active }: { active: boolean }) {
  const { width } = useWindowDimensions();
  const { data, error } = useStoreGuardians(active);
  const { receipt, missing } = useReleaseReceipt(active);
  const [picked, setPicked] = useState<Picked>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const rows = useMemo(() => (data ? releaseRows(data.events, 12) : []), [data]);
  const guardians = data?.guardians || [];
  const pickedGuardian = picked?.kind === 'guardian' ? guardians.find((item) => item.key === picked.key) : null;
  const onPick = useCallback((next: Picked) => {
    setPicked(next);
    if (next?.kind === 'request') setOpenRow(`${next.app}:${next.versionCode}`);
  }, []);
  const pool = data?.pools.top[0];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Scene data={data} height={Math.round(Math.min(width * 1.32, 600))} onPick={onPick} />

      <View style={styles.pad}>
        <Hero
          label={t('Guardian votes today')}
          value={data ? integer(data.today.votes) : '—'}
          note={data
            ? t('{releases} releases from {apps} apps · median {seconds} from request to vote', { releases: integer(data.today.releases), apps: integer(data.today.apps), seconds: seconds(data.today.medianSeconds) })
            : error ? t('The guardians could not be read just now.') : t('Reading the chain…')}
        />

        {guardians.length ? (
          <View style={styles.tiles}>
            {guardians.map((guardian) => (
              <GuardianTile
                key={guardian.key}
                guardian={guardian}
                picked={pickedGuardian?.key === guardian.key}
                onPress={() => { void Haptics.selectionAsync(); setPicked(pickedGuardian?.key === guardian.key ? null : { kind: 'guardian', key: guardian.key }); }}
              />
            ))}
          </View>
        ) : null}
        {pickedGuardian ? <GuardianDetail guardian={pickedGuardian} /> : null}

        {rows.length ? (
          <Panel style={styles.list}>
            <Eyebrow>{t('Latest releases')}</Eyebrow>
            <Text style={styles.listNote}>{t('Seconds from each request to each guardian\'s vote. Tap for the transactions.')}</Text>
            {rows.map((row) => {
              const key = `${row.app}:${row.versionCode}`;
              return <ReleaseLine key={key} row={row} guardians={guardians} open={openRow === key} onPress={() => { void Haptics.selectionAsync(); setOpenRow(openRow === key ? null : key); }} />;
            })}
          </Panel>
        ) : null}

        <Receipt receipt={receipt} missing={missing} />

        {data ? (
          <Panel style={styles.list}>
            <Eyebrow>{t('Since the guardians began')}</Eyebrow>
            <View style={styles.totals}>
              <View style={styles.total}><Text style={styles.totalValue}>{integer(data.totals.votes)}</Text><Text style={styles.totalLabel}>{t('votes')}</Text></View>
              <View style={styles.total}><Text style={styles.totalValue}>{integer(data.totals.releases)}</Text><Text style={styles.totalLabel}>{t('releases')}</Text></View>
              <View style={styles.total}><Text style={styles.totalValue}>{integer(data.totals.apps)}</Text><Text style={styles.totalLabel}>{t('apps')}</Text></View>
            </View>
            <Text style={styles.listNote}>{t('Counted from the first vote on {date}.', { date: sinceDate(data.totals.since) })}</Text>
            {pool ? (
              <Text style={styles.listNote}>{t('SKR staked behind guardian pools: {amount} in {count}.', { amount: compact(data.pools.top.reduce((sum, item) => sum + item.activeStaked, 0)), count: data.pools.count === 1 ? t('one pool') : t('{count} pools', { count: integer(data.pools.count || 0) }) })}</Text>
            ) : null}
          </Panel>
        ) : null}

        <Text style={styles.fine}>{t('Read from the store\'s guardian program on chain ({program}). The public view shows that a guardian voted and how fast; verdicts on other people\'s apps are not shown.', { program: shortKey(data?.program || 'GUARDsVUfAaydbPU6QGcpWRLUkExaULtaygwEtkdhZAD') })}</Text>
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
  lapseButton: { position: 'absolute', right: spacing.lg, bottom: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: 'rgba(7, 12, 18, 0.82)', paddingHorizontal: spacing.md, paddingVertical: 7 },
  lapseButtonOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  lapseText: { color: colors.text, fontFamily: font.semibold, fontSize: 12, letterSpacing: 0.3 },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  tileWrap: { flex: 1 },
  tile: { paddingHorizontal: spacing.sm, paddingVertical: spacing.md, gap: 2, borderWidth: 1, borderColor: 'transparent' },
  tileName: { fontFamily: font.semibold, fontSize: 12, letterSpacing: 0.2 },
  tileValue: { color: colors.text, fontFamily: font.monoBold, fontSize: 26, marginTop: 4 },
  tileUnit: { color: colors.muted, fontFamily: font.medium, fontSize: 11 },
  tileNote: { color: colors.faint, fontFamily: font.mono, fontSize: 10.5 },
  detail: { gap: 6, padding: spacing.lg },
  detailLine: { color: colors.muted, fontFamily: font.regular, fontSize: 13, lineHeight: 18 },
  mono: { color: colors.faint, fontFamily: font.mono, fontSize: 10.5 },
  list: { gap: spacing.sm, padding: spacing.lg },
  listNote: { color: colors.faint, fontFamily: font.regular, fontSize: 12, lineHeight: 17 },
  release: { gap: 6 },
  releaseOpen: { borderColor: colors.lineStrong },
  releaseHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  releasePkg: { flex: 1, color: colors.text, fontFamily: font.mono, fontSize: 12.5 },
  releaseAge: { color: colors.faint, fontFamily: font.mono, fontSize: 10.5 },
  releaseVotes: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  releaseVersion: { color: colors.muted, fontFamily: font.mono, fontSize: 11, minWidth: 54 },
  voteChip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  voteDot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1 },
  voteText: { fontFamily: font.monoSemibold, fontSize: 11.5 },
  releaseLinks: { gap: 4, marginTop: 4 },
  link: { color: colors.accent, fontFamily: font.medium, fontSize: 12.5, paddingVertical: 3 },
  receipt: { gap: spacing.sm, padding: spacing.lg },
  receiptTitle: { color: colors.text, fontFamily: font.bold, fontSize: 17 },
  receiptHero: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, flexWrap: 'wrap' },
  receiptNumber: { color: colors.metal, fontFamily: font.monoBlack, fontSize: 40 },
  receiptCaption: { color: colors.muted, fontFamily: font.regular, fontSize: 12.5, flexShrink: 1 },
  receiptRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  receiptWho: { flex: 1, color: colors.text, fontFamily: font.semibold, fontSize: 13.5 },
  receiptWhen: { color: colors.muted, fontFamily: font.mono, fontSize: 12.5 },
  receiptMono: { color: colors.faint, fontFamily: font.mono, fontSize: 11 },
  receiptVerdict: { fontFamily: font.monoBold, fontSize: 12.5, minWidth: 30, textAlign: 'right' },
  receiptNote: { color: colors.muted, fontFamily: font.regular, fontSize: 13, lineHeight: 18 },
  receiptFine: { color: colors.faint, fontFamily: font.regular, fontSize: 11.5, lineHeight: 16, marginTop: 4 },
  totals: { flexDirection: 'row', gap: spacing.md },
  total: { flex: 1 },
  totalValue: { color: colors.text, fontFamily: font.monoBold, fontSize: 20 },
  totalLabel: { color: colors.faint, fontFamily: font.medium, ...type.eyebrow },
  fine: { color: colors.dim, fontFamily: font.regular, fontSize: 11, lineHeight: 16, marginTop: spacing.xs },
});
