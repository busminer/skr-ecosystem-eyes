import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { t } from '../i18n';
import { integer } from '../format';
import { isWalletCancel, connectReadOnlyWallet } from '../mwa';
import { rememberConnectedWallet, useConnectedWallet } from '../wallet';
import { colors, font, radius, spacing, type } from '../theme';
import { Button, Eyebrow, Meter } from '../lab/kit';
import { EyeApiError, fetchEyeNetwork, sendGaze, type EyeNetwork, type EyeStatus, type NetworkEye } from './api';
import { EYE_BASE_URL } from './config';
import { EyePanel } from './EyePanel';
import { IrisScene, type IrisHandle } from './IrisScene';
import { openEyeStream } from './stream';
import { clock, epochMs } from './time';

// The Eyes tab: your Eye, then the network as one eye.
//
// On top, your own Eye — the card to open one, or the picture, the streak
// and the Blink — and, with no wallet, the one button that connects. Then
// the Iris: every open Eye is a ring on it, closer to the pupil the longer
// its streak, lit if it blinked today, and the pupil counts down to the next
// Blink. Under the Iris: who gazed at you today, and the Guardian circles as
// teams. A tap on a ring opens that Eye — its card, its streak, and a Gaze,
// five a day.
//
// The wallet is the one Me keeps too, from the shared store: whichever tab
// connects, the other one knows.
//
// Two clocks and one ear. The network is re-read once a minute while the tab
// is in front and the moment the window opens or closes; blinks and gazes
// arrive between reads on the event stream, which is open only while this
// tab is on screen and the app is in front. The countdown ticks once a
// second in its own small component, so the rest of the tab is not redrawn
// with it.
//
// Until the server side of the Iris exists the tab degrades on purpose: the
// pupil and the rails are drawn, the title says the Iris is waking up, and
// nothing is called an error.

const REFRESH_MS = 60_000;
const RINGS = 9;

const serialName = (serial: number) => `EYE #${String(serial).padStart(4, '0')}`;

// The pupil's own clock. It is the one thing on the tab that changes every
// second, so it is the one thing redrawn every second.
function Pupil({ blink, label, size, onEdge }: { blink: { open: boolean; opensAt: string | number; closesAt: string | number } | null; label: string | null; size: number; onEdge: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const crossed = useRef<number | null>(null);
  useEffect(() => {
    if (!blink) return;
    setNow(Date.now());
    const timer = setInterval(() => { if (AppState.currentState === 'active') setNow(Date.now()); }, 1_000);
    return () => clearInterval(timer);
  }, [blink]);
  const edge = blink ? epochMs(blink.open ? blink.closesAt : blink.opensAt) : null;
  const remaining = edge != null ? edge - now : null;
  // The window turned under the clock: ask once, a second late so the
  // server has turned too.
  useEffect(() => {
    if (edge == null || remaining == null || remaining > -1_000 || crossed.current === edge) return;
    crossed.current = edge;
    onEdge();
  }, [edge, remaining, onEdge]);
  return (
    <View pointerEvents="none" style={[styles.pupil, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text numberOfLines={1} style={styles.pupilEyebrow}>{(blink ? (blink.open ? t('Blink is open') : t('Next Blink')) : t('The Iris')).toUpperCase()}</Text>
      <Text numberOfLines={1} style={styles.pupilTime}>{remaining != null ? clock(remaining) : '--:--:--'}</Text>
      {label ? <Text numberOfLines={1} style={styles.pupilLabel}>{label}</Text> : null}
    </View>
  );
}

// One Eye, opened from its ring: the card, the facts, and the Gaze.
function EyeSheet({ eye, gazes, wallet, mine, width, onClose, onGazed }: { eye: NetworkEye; gazes: EyeNetwork['gazes'] | null; wallet: string | null; mine: boolean; width: number; onClose: () => void; onGazed: (sentToday: number, limit: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const left = gazes ? Math.max(0, gazes.limit - gazes.sentToday) : 0;
  const canGaze = Boolean(wallet) && !mine && left > 0;
  const image = Math.min(260, Math.round(width * 0.58));

  const gaze = useCallback(async () => {
    if (!wallet || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await sendGaze(wallet, eye.serial);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNote(t('Gazed.'));
      onGazed(result.sentToday, result.limit);
    } catch (caught) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const code = caught instanceof EyeApiError ? caught.code : null;
      setError(
        code === 'no_eye' ? t('You need an Eye of your own to gaze')
          : code === 'limit' ? t('No gazes left today')
            : code === 'self' ? t('That is your own Eye')
              : code === 'unknown_target' ? t('That Eye is not on the Iris')
                : caught instanceof Error && caught.message ? caught.message : t('The Eye service did not answer'),
      );
    } finally {
      setBusy(false);
    }
  }, [wallet, busy, eye.serial, onGazed]);

  const facts = [
    t('Streak {streak}', { streak: eye.streak }),
    t('ring {ring} of {rings}', { ring: eye.ring + 1, rings: RINGS }),
    eye.blinkedToday ? t('Blinked today') : t('Not yet today'),
  ].join(' · ');

  return (
    <Modal transparent statusBarTranslucent animationType="fade" visible onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.backdrop} onPress={onClose} />
      <Animated.View entering={FadeInDown.duration(220)} style={styles.sheet}>
        <View style={styles.sheetGrip} />
        <View style={styles.sheetHead}>
          <Eyebrow tone={eye.perfect ? colors.metal : colors.faint}>{mine ? t('Your Eye') : eye.perfect ? t('Perfect Eye') : t('Eye')}</Eyebrow>
          <Text style={styles.sheetSerial}>{serialName(eye.serial)}</Text>
        </View>
        <Image source={{ uri: `${EYE_BASE_URL}/eye/${eye.serial}.png` }} style={[styles.sheetImage, { width: image, height: image }]} accessibilityLabel={serialName(eye.serial)} />
        <Text numberOfLines={1} style={styles.sheetName}>{eye.name}</Text>
        <Text style={styles.sheetFacts}>{facts}</Text>
        {mine ? null : (
          <View style={styles.sheetAction}>
            <Button
              label={busy ? t('Gazing…') : wallet && left === 0 ? t('No gazes left today') : t('Gaze')}
              onPress={() => void gaze()}
              disabled={!canGaze || busy}
              tone={colors.metal}
            />
            <Text style={styles.sheetMicro}>
              {!wallet
                ? t('Connect the wallet to gaze')
                : gazes
                  ? t('{left} of {limit} gazes left today', { left, limit: gazes.limit })
                  : ''}
            </Text>
          </View>
        )}
        {note ? <Text style={styles.note}>{note}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Animated.View>
    </Modal>
  );
}

export function EyesLab() {
  const { width } = useWindowDimensions();
  const connected = useConnectedWallet();
  const wallet = connected?.address ?? null;
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  // What your own Eye's panel last read: the window and the counts, so the
  // pupil has a clock even while the Iris itself is still waking up.
  const [status, setStatus] = useState<EyeStatus | null>(null);
  const [network, setNetwork] = useState<EyeNetwork | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Blinks heard on the stream since the last read, for the line under the
  // title; the scene lights the rings itself.
  const [liveBlinks, setLiveBlinks] = useState(0);
  const [picked, setPicked] = useState<NetworkEye | null>(null);
  const scene = useRef<IrisHandle>(null);
  const ticket = useRef(0);
  const reading = useRef(false);
  const blinked = useRef<Set<number>>(new Set());
  const meSerial = useRef<number | null>(null);
  const reread = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A status belongs to the wallet it was read for.
  useEffect(() => { setStatus(null); }, [wallet]);

  const connect = useCallback(async () => {
    if (connecting) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const account = await connectReadOnlyWallet();
      rememberConnectedWallet({ address: account.address, label: account.label ?? null });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (caught) {
      // The finger came off the wallet: nothing went wrong, so nothing is said.
      if (!isWalletCancel(caught)) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setConnectError(caught instanceof Error && caught.message ? caught.message : t('The wallet request was cancelled'));
      }
    } finally {
      setConnecting(false);
    }
  }, [connecting]);

  const read = useCallback(async (visible = false) => {
    if (reading.current) return;
    reading.current = true;
    if (visible) setRefreshing(true);
    const mine = ticket.current;
    try {
      const next = await fetchEyeNetwork(wallet);
      if (mine !== ticket.current) return;
      blinked.current = new Set(next.eyes.filter((eye) => eye.blinkedToday).map((eye) => eye.serial));
      meSerial.current = next.me?.serial ?? null;
      setLiveBlinks(0);
      setNetwork(next);
    } catch {
      // The Iris is waking up: the last picture stays, or the empty one does.
    } finally {
      reading.current = false;
      if (mine === ticket.current && visible) setRefreshing(false);
    }
  }, [wallet]);

  // A new wallet means a new answer about which ring is yours.
  useEffect(() => { ticket.current += 1; void read(); }, [read]);

  useEffect(() => {
    const timer = setInterval(() => { if (AppState.currentState === 'active') void read(); }, REFRESH_MS);
    const subscription = AppState.addEventListener('change', (next) => { if (next === 'active') void read(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [read]);

  // The ear: open while the tab is in front, shut the moment it is not.
  useEffect(() => {
    let close: (() => void) | null = null;
    const open = () => {
      if (close) return;
      close = openEyeStream((message) => {
        if (message.event === 'blink') {
          scene.current?.push({ type: 'blink', items: [message.data] });
          if (!blinked.current.has(message.data.serial)) {
            blinked.current.add(message.data.serial);
            setLiveBlinks((count) => count + 1);
          }
        } else if (message.event === 'gaze' && meSerial.current != null && message.data.toSerial === meSerial.current) {
          // Somebody looked at you: a touch, and the names re-read shortly,
          // once, however many arrive together.
          void Haptics.selectionAsync();
          if (reread.current) clearTimeout(reread.current);
          reread.current = setTimeout(() => { reread.current = null; void read(); }, 1_500);
        }
      });
    };
    const shut = () => { close?.(); close = null; };
    if (AppState.currentState === 'active') open();
    const subscription = AppState.addEventListener('change', (next) => { if (next === 'active') open(); else shut(); });
    return () => { subscription.remove(); shut(); if (reread.current) clearTimeout(reread.current); };
  }, [read]);

  // The picture, handed to the scene whenever a read changes it.
  useEffect(() => {
    if (!network) {
      scene.current?.push({ type: 'network', eyes: [], ringCounts: null, me: null, callout: null, empty: true });
      return;
    }
    const me = network.me;
    const myName = me ? network.eyes.find((eye) => eye.serial === me.serial)?.name ?? null : null;
    scene.current?.push({
      type: 'network',
      eyes: network.eyes.map((eye) => ({ s: eye.serial, r: eye.ring, b: eye.blinkedToday ? 1 : 0, pf: eye.perfect ? 1 : 0 })),
      ringCounts: network.ringCounts ?? null,
      me: me ? { serial: me.serial, ring: me.ring } : null,
      callout: me ? {
        title: `${t('you')} · ${serialName(me.serial)}${myName ? ` · ${myName}` : ''}`,
        sub: [
          t('ring {ring} of {rings}', { ring: me.ring + 1, rings: network.rings || RINGS }),
          t('streak {streak}', { streak: me.streak }),
          me.moons > 0 ? (me.moons === 1 ? t('1 moon') : t('{count} moons', { count: me.moons })) : null,
        ].filter(Boolean).join(' · '),
      } : null,
      empty: network.eyes.length === 0,
    });
  }, [network]);

  const onTap = useCallback((serial: number) => {
    const eye = network?.eyes.find((item) => item.serial === serial);
    if (!eye) return;
    void Haptics.selectionAsync();
    setPicked(eye);
  }, [network]);

  const onGazed = useCallback((sentToday: number, limit: number) => {
    setNetwork((current) => current ? { ...current, gazes: { ...current.gazes, sentToday, limit } } : current);
  }, []);

  const onEdge = useCallback(() => { void read(); }, [read]);

  const onStatus = useCallback((next: EyeStatus) => setStatus(next), []);

  // Your own Blink went through: your ring flashes like any other blink
  // arriving, and the count under the title moves with it.
  const onBlinked = useCallback(() => {
    const me = network?.me;
    if (!me) return;
    scene.current?.push({ type: 'blink', items: [{ serial: me.serial, ring: me.ring }] });
    if (!blinked.current.has(me.serial)) {
      blinked.current.add(me.serial);
      setLiveBlinks((count) => count + 1);
    }
  }, [network]);

  const size = width;
  const pupil = Math.round(size * 0.165 * 2);
  const watching = network?.totals.watching ?? network?.totals.eyes ?? status?.network?.watching ?? status?.network?.eyes ?? null;
  const blink = network?.window ?? (status?.blink ? { open: status.blink.open, opensAt: status.blink.opensAt, closesAt: status.blink.closesAt } : null);
  const eventLabel = network?.event?.label ?? status?.blink?.event?.label ?? null;
  const blinkedToday = network ? network.totals.blinkedToday + liveBlinks : null;
  const received = network?.gazes.received ?? [];
  const circles = network?.circles ?? [];
  const peak = circles.reduce((most, circle) => Math.max(most, circle.blinked), 0);

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void read(true)} tintColor={colors.accent} />}
      >
        <EyePanel wallet={wallet} onStatus={onStatus} onBlinked={onBlinked} onConnect={() => void connect()} connecting={connecting} connectError={connectError} />

        <View style={styles.head}>
          <Eyebrow>{t('The Iris')}</Eyebrow>
          <Text style={styles.title}>
            {watching == null
              ? t('The Iris is waking up')
              : watching === 1 ? t('1 Eye is watching') : t('{count} Eyes are watching', { count: integer(watching) })}
          </Text>
          {network && blinkedToday != null ? (
            <Text style={styles.sub}>
              {[
                t('{count} blinked today', { count: integer(blinkedToday) }),
                network.totals.perfect === 1 ? t('1 Perfect Eye') : t('{count} Perfect Eyes', { count: integer(network.totals.perfect) }),
                t('{count} new today', { count: integer(network.totals.newToday) }),
              ].join(' · ')}
            </Text>
          ) : null}
        </View>

        <View style={[styles.sceneWrap, { height: size, marginHorizontal: -spacing.lg }]}>
          <IrisScene ref={scene} size={size} onTap={onTap} />
          <View pointerEvents="none" style={[styles.pupilWrap, { top: (size - pupil) / 2, left: (size - pupil) / 2 }]}>
            <Pupil blink={blink} label={eventLabel} size={pupil} onEdge={onEdge} />
          </View>
        </View>

        {network?.me ? (
          <View style={styles.gazes}>
            <Text style={styles.gazesTitle}>
              {received.length === 0
                ? t('No eyes gazed at you yet today')
                : received.length === 1 ? t('1 eye gazed at you today') : t('{count} eyes gazed at you today', { count: received.length })}
            </Text>
            {received.length > 0 ? <Text style={styles.gazesNames}>{received.map((gaze) => gaze.name).join(' · ')}</Text> : null}
          </View>
        ) : null}

        {circles.length > 0 ? (
          <View style={styles.circles}>
            <Eyebrow>{t('Circles today')}</Eyebrow>
            {circles.map((circle) => (
              <View key={circle.pool} style={styles.circle}>
                <View style={styles.circleRow}>
                  <Text numberOfLines={1} style={styles.circleName}>{circle.label}</Text>
                  <Text numberOfLines={1} style={styles.circleCount}>{t('{count} blinked', { count: integer(circle.blinked) })}</Text>
                </View>
                <Meter percent={peak > 0 ? (circle.blinked / peak) * 100 : 0} tone={colors.positive} height={3} />
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {picked ? (
        <EyeSheet
          eye={picked}
          gazes={network?.gazes ?? null}
          wallet={wallet}
          mine={network?.me?.serial === picked.serial}
          width={width}
          onClose={() => setPicked(null)}
          onGazed={onGazed}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 130, gap: spacing.lg },
  head: { gap: spacing.xs },
  title: { color: colors.text, fontFamily: font.bold, fontSize: 26, lineHeight: 32, letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
  sub: { color: colors.muted, fontFamily: font.regular, ...type.body, fontVariant: ['tabular-nums'] },
  sceneWrap: { backgroundColor: colors.bg },
  pupilWrap: { position: 'absolute' },
  pupil: { alignItems: 'center', justifyContent: 'center', gap: 2 },
  pupilEyebrow: { color: colors.muted, fontFamily: font.semibold, ...type.eyebrow },
  pupilTime: { color: colors.text, fontFamily: font.black, fontSize: 24, lineHeight: 30, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  pupilLabel: { color: colors.muted, fontFamily: font.regular, ...type.micro, maxWidth: '86%' },
  gazes: { gap: spacing.xs },
  gazesTitle: { color: colors.text, fontFamily: font.bold, fontSize: 18, lineHeight: 24, letterSpacing: -0.3 },
  gazesNames: { color: colors.muted, fontFamily: font.regular, ...type.body },
  circles: { gap: spacing.md },
  circle: { gap: spacing.sm },
  circleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md },
  circleName: { flexShrink: 1, color: colors.text, fontFamily: font.medium, ...type.body },
  circleCount: { color: colors.text, fontFamily: font.semibold, ...type.body, fontVariant: ['tabular-nums'] },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(2, 4, 7, 0.72)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.panel, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderWidth: 1, borderColor: '#111B24', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl, gap: spacing.sm },
  sheetGrip: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong, marginBottom: spacing.xs },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  sheetSerial: { color: colors.metal, fontFamily: font.monoBold, fontSize: 12, letterSpacing: 0.8 },
  sheetImage: { alignSelf: 'center', borderRadius: radius.inner, backgroundColor: colors.inset, marginVertical: spacing.xs },
  sheetName: { color: colors.text, fontFamily: font.bold, fontSize: 18, letterSpacing: -0.3, textAlign: 'center' },
  sheetFacts: { color: colors.muted, fontFamily: font.medium, ...type.small, fontVariant: ['tabular-nums'], textAlign: 'center' },
  sheetAction: { marginTop: spacing.xs, gap: spacing.sm },
  sheetMicro: { color: colors.faint, fontFamily: font.regular, ...type.micro, textAlign: 'center' },
  note: { color: colors.positive, fontFamily: font.medium, ...type.small, textAlign: 'center' },
  error: { color: colors.negative, fontFamily: font.medium, ...type.small, textAlign: 'center' },
});
