import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../i18n';
import { integer } from '../format';
import { isWalletCancel, connectReadOnlyWallet } from '../mwa';
import { rememberConnectedWallet, useConnectedWallet } from '../wallet';
import { colors, font, radius, spacing, type } from '../theme';
import { Button, Eyebrow, Meter } from '../lab/kit';
import { EyeApiError, fetchEyeHealth, fetchEyeNetwork, sendGaze, type EyeHealth, type EyeNetwork, type EyeStatus, type NetworkEye } from './api';
import { EYE_BASE_URL, EYE_FINGER_ENABLED } from './config';
import { EyePanel } from './EyePanel';
import { EyeOnboarding } from './EyeOnboarding';
import { PortalEye } from './PortalEye';
import { WitnessWalkthrough, getWitnessState } from './WitnessWalkthrough';
import { IrisScene, type IrisHandle, type IrisView } from './IrisScene';
import { openEyeStream } from './stream';
import { localHourOf, pulseInPhoneTime } from './time';

// The Eyes tab: your Eye, then the network as one radar.
//
// One width for everything. The page has a gutter of spacing.lg on both
// sides and a ceiling of MAX_W on wide screens. The one card on the tab
// (EyePanel, on top) spans the gutter and pads its inside by the same
// gutter; the sections under the Iris sit in the gutter with no box of
// their own; the strip of small cards scrolls edge to edge but its cards
// start at the gutter; the sheet pads by the gutter. Only the Iris field is
// full bleed, edge to edge, and it is as wide as the page.
//
// On top, your own Eye (EyePanel): what an Eye costs and the button that
// connects, or the price and the button that opens one, or the everyday
// card between Blinks (the day, the next ring, the clock, who looked, one
// nudge). The prices for someone without a wallet come from the service's
// health call, read once here and handed to the card.
// Then the Iris: the radar's field from the Top tab with the Eye at its
// centre. Every open Eye is a small eye on one of nine rings, closer to the
// centre the longer its streak, lit if it blinked today, and the beam that
// sweeps round lights what it passes. Yours is gold with a thread to the
// centre. It takes the radar's hands too: one finger drags, two pinch, and
// the Eye at the centre moves and grows with the field (the scene reports
// its view, the tab moves the overlay on the UI thread). A touch that
// starts on the field stays with it; off the field the tab scrolls.
// Under it, in this order, and each only when it has something to say: the
// Eyes themselves as a strip of small cards, who looked at your Eye today,
// the day's pulse hour by hour, the ladder of the nine rings as nine small
// columns, the longest streaks, the Eyes that opened today, and the Guardian
// circles when the server says there is more than one to compare. A tap on
// an Eye, on the Iris or on a card, opens its sheet: the picture, the facts,
// and Look at this Eye, which tells its owner that somebody saw them (five a
// day). Nothing under the Iris shows a zero or an empty state.
//
// The wallet is the one Me keeps too, from the shared store: whichever tab
// connects, the other one knows.
//
// Two clocks and one ear. The network is re-read once a minute while the tab
// is in front and the moment the window opens or closes; blinks and looks
// arrive between reads on the event stream, which is open only while this
// tab is on screen and the app is in front. The tab is unmounted when
// another tab is chosen, so the scene draws nothing then.
//
// Large fonts: every text block here wraps rather than clips, the tight
// labels (cards, ticks, ladder) are capped at a modest multiplier, and the
// sheet keeps its bottom clear of the Android navigation bar.
//
// Until the server side of the Iris exists the tab degrades on purpose: the
// field and the rings are drawn, the title says the Iris is waking up, and
// nothing is called an error.

const REFRESH_MS = 60_000;
// Set once the walk-through of the Eye has been seen or skipped.
const INTRO_KEY = 'skr-eyes:eye-intro:v1';
const RINGS = 9;
// The one gutter every block on the tab keeps, and the page's width on a
// screen wider than a phone.
const GUTTER = spacing.lg;
const MAX_W = 560;
// The tallest bar of the day's pulse, and of the ladder.
const PULSE_H = 34;
const LADDER_H = 30;
// The small card in the strip of Eyes: the picture's side.
const CARD = 68;
const STRIP_MAX = 40;
// The streak each ring stands for, innermost first (the service's src/iris.mjs).
const RAIL = ['30+', '21', '14', '10', '7', '5', '3', '2', '1'];

const hh = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

const serialName = (serial: number) => `EYE #${String(serial).padStart(4, '0')}`;
const serialTag = (serial: number) => `#${String(serial).padStart(4, '0')}`;
const days = (streak: number) => (streak === 1 ? t('1 day') : t('{count} days', { count: integer(streak) }));

// The pupil: the Eye itself, the NFT's portal, over the centre of the Iris.
// It blinks when anybody on the network blinks, and on its own every few
// seconds so the tab is never a still picture.
function PupilEye({ size, blink }: { size: number; blink: number }) {
  const [idle, setIdle] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => { if (AppState.currentState === 'active') setIdle((count) => count + 1); }, 6_500);
    return () => clearInterval(timer);
  }, []);
  return <PortalEye size={size} open blink={blink + idle} />;
}

// A few short facts in a row. They wrap when the font is large, so no fact
// is ever cut and none runs into its neighbour.
function Facts({ items, center = false }: { items: Array<string | null>; center?: boolean }) {
  return (
    <View style={[styles.facts, center && styles.factsCenter]}>
      {items.filter((item): item is string => Boolean(item)).map((item) => <Text key={item} style={styles.fact}>{item}</Text>)}
    </View>
  );
}

// One Eye, opened from the Iris or a card: the picture, the facts, and the
// look. The sheet is a Modal over the whole screen, navigation bar included,
// so it keeps its own bottom clear of it.
function EyeSheet({ eye, gazes, wallet, mine, width, height, fontScale, onClose, onGazed }: { eye: NetworkEye; gazes: EyeNetwork['gazes'] | null; wallet: string | null; mine: boolean; width: number; height: number; fontScale: number; onClose: () => void; onGazed: (sentToday: number, limit: number) => void }) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const left = gazes ? Math.max(0, gazes.limit - gazes.sentToday) : 0;
  const canGaze = Boolean(wallet) && !mine && left > 0;
  const image = Math.min(240, Math.round(width * (fontScale >= 1.3 ? 0.44 : 0.56)));

  const gaze = useCallback(async () => {
    if (!wallet || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await sendGaze(wallet, eye.serial);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNote(t('You looked at this Eye. Its owner will see that.'));
      onGazed(result.sentToday, result.limit);
    } catch (caught) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const code = caught instanceof EyeApiError ? caught.code : null;
      setError(
        code === 'no_eye' ? t('You need an Eye of your own to look at one')
          : code === 'limit' ? t('No looks left today')
            : code === 'self' ? t('That is your own Eye')
              : code === 'unknown_target' ? t('That Eye is not on the Iris')
                : caught instanceof Error && caught.message ? caught.message : t('The Eye service did not answer'),
      );
    } finally {
      setBusy(false);
    }
  }, [wallet, busy, eye.serial, onGazed]);

  return (
    <Modal transparent statusBarTranslucent navigationBarTranslucent animationType="fade" visible onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} style={styles.backdrop} onPress={onClose} />
      <Animated.View entering={FadeInDown.duration(220)} style={[styles.sheet, { maxHeight: Math.round(height * 0.88), paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.sheetGrip} />
        <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetBody}>
          <View style={styles.sheetHead}>
            <Eyebrow tone={eye.perfect ? colors.metal : colors.faint}>{mine ? t('Your Eye') : eye.perfect ? t('Perfect Eye') : t('Eye')}</Eyebrow>
            <Text maxFontSizeMultiplier={1.3} style={styles.sheetSerial}>{serialName(eye.serial)}</Text>
          </View>
          <Image source={{ uri: `${EYE_BASE_URL}/eye/${eye.serial}.png` }} style={[styles.sheetImage, { width: image, height: image }]} accessibilityLabel={serialName(eye.serial)} />
          <Text style={styles.sheetName}>{eye.name}</Text>
          <Facts
            center
            items={[
              days(eye.streak),
              t('ring {ring} of {rings}', { ring: eye.ring + 1, rings: RINGS }),
              eye.blinkedToday ? t('Blinked today') : t('Not yet today'),
            ]}
          />
          {mine ? null : (
            <View style={styles.sheetAction}>
              <Button
                label={busy ? t('Looking…') : wallet && left === 0 ? t('No looks left today') : t('Look at this Eye')}
                onPress={() => void gaze()}
                disabled={!canGaze || busy}
                tone={colors.metal}
              />
              <Text style={styles.sheetMicro}>
                {!wallet
                  ? t('Connect the wallet to look at an Eye.')
                  : gazes
                    ? t('A look tells the owner that you saw their Eye. {left} of {limit} looks left today.', { left, limit: gazes.limit })
                    : ''}
              </Text>
            </View>
          )}
          {note ? <Text style={styles.note}>{note}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

export function EyesLab() {
  const { width, height, fontScale } = useWindowDimensions();
  const connected = useConnectedWallet();
  const wallet = connected?.address ?? null;
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  // What your own Eye's panel last read: the window and the counts, so the
  // title has a number even while the Iris itself is still waking up.
  const [status, setStatus] = useState<EyeStatus | null>(null);
  const [network, setNetwork] = useState<EyeNetwork | null>(null);
  // The prices for someone with no wallet yet, from the service's health
  // call, read once when the tab opens.
  const [health, setHealth] = useState<EyeHealth | null>(null);
  // The Seeker walk-through, shown over the tab before the first open when
  // the finger is on and this phone has not been through it. The open that
  // asked waits on `verdict` for the answer.
  const [verifying, setVerifying] = useState(false);
  const verdict = useRef<((ok: boolean) => void) | null>(null);
  // The walk-through of the Eye: whether it has been seen (null while the
  // phone is asked), whether it is up, and each press of its last button.
  const [introSeen, setIntroSeen] = useState<boolean | null>(null);
  const [intro, setIntro] = useState(false);
  const [openRequest, setOpenRequest] = useState(0);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Blinks heard on the stream since the last read, for the line under the
  // title; the scene lights the rings itself.
  const [liveBlinks, setLiveBlinks] = useState(0);
  const [picked, setPicked] = useState<NetworkEye | null>(null);
  // Every blink heard, yours included: the pupil blinks with it.
  const [pupilBlink, setPupilBlink] = useState(0);
  const scene = useRef<IrisHandle>(null);
  // The list and where the Iris sits in it, for the card's nudge to look at
  // somebody's Eye: one press and the field is on screen.
  const list = useRef<ScrollView>(null);
  const sceneTop = useRef(0);
  const ticket = useRef(0);
  const reading = useRef(false);
  const wanted = useRef(false);
  const latestRead = useRef<(visible?: boolean) => Promise<void>>(async () => undefined);
  const blinked = useRef<Set<number>>(new Set());
  const meSerial = useRef<number | null>(null);
  const reread = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A status belongs to the wallet it was read for.
  useEffect(() => { setStatus(null); }, [wallet]);

  useEffect(() => {
    let live = true;
    fetchEyeHealth().then((next) => { if (live) setHealth(next); }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  // The field's view, as the scene reports it: the Eye at the centre moves
  // and grows with it, on the UI thread, without a render of the tab.
  const zoom = useSharedValue(1);
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const onView = useCallback((view: IrisView) => {
    zoom.value = view.zoom;
    panX.value = view.panX;
    panY.value = view.panY;
  }, [zoom, panX, panY]);
  const pupilStyle = useAnimatedStyle(() => ({ transform: [{ translateX: panX.value }, { translateY: panY.value }, { scale: zoom.value }] }));
  const scrollToIris = useCallback(() => {
    void Haptics.selectionAsync();
    list.current?.scrollTo({ y: Math.max(0, sceneTop.current - spacing.md), animated: true });
  }, []);

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
        // A Java class name is not a sentence: say what happened instead.
        const said = caught instanceof Error ? caught.message : '';
        setConnectError(said && !/^[a-z]+(\.[A-Za-z$]+)+(Exception|Error)\b/.test(said) ? said : t('The wallet did not connect. Try again.'));
      }
    } finally {
      setConnecting(false);
    }
  }, [connecting]);

  const read = useCallback(async (visible = false) => {
    // A read asked for while one is in flight runs right after it, with
    // whatever wallet is current by then, rather than being dropped.
    if (reading.current) { wanted.current = true; return; }
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
      if (wanted.current) { wanted.current = false; void latestRead.current(); }
    }
  }, [wallet]);
  latestRead.current = read;

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
          setPupilBlink((count) => count + 1);
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
    scene.current?.push({
      type: 'network',
      eyes: network.eyes.map((eye) => ({ s: eye.serial, r: eye.ring, b: eye.blinkedToday ? 1 : 0, pf: eye.perfect ? 1 : 0 })),
      ringCounts: network.ringCounts ?? null,
      me: me ? { serial: me.serial, ring: me.ring } : null,
      callout: me ? { title: t('you'), sub: `${serialName(me.serial)}, ${days(me.streak)}` } : null,
      empty: network.eyes.length === 0,
    });
  }, [network]);

  const pick = useCallback((eye: NetworkEye) => {
    void Haptics.selectionAsync();
    setPicked(eye);
  }, []);

  const onTap = useCallback((serial: number) => {
    const eye = network?.eyes.find((item) => item.serial === serial);
    if (eye) pick(eye);
  }, [network, pick]);

  // A name in a list: the Eye behind it, if the server listed it.
  const eyeOf = useCallback((serial: number) => network?.eyes.find((item) => item.serial === serial) ?? null, [network]);

  const onGazed = useCallback((sentToday: number, limit: number) => {
    setNetwork((current) => current ? { ...current, gazes: { ...current.gazes, sentToday, limit } } : current);
  }, []);

  const onStatus = useCallback((next: EyeStatus) => setStatus(next), []);

  // The walk-through of the Eye comes up by itself once: the first time the
  // tab is opened by someone with no wallet yet, or with a wallet that has no
  // Eye. Someone who already has one never sees it unasked.
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(INTRO_KEY)
      .then((value) => { if (live) setIntroSeen(value === '1'); })
      .catch(() => { if (live) setIntroSeen(false); });
    return () => { live = false; };
  }, []);
  const markIntroSeen = useCallback(() => {
    setIntroSeen(true);
    void AsyncStorage.setItem(INTRO_KEY, '1').catch(() => undefined);
  }, []);
  useEffect(() => {
    if (introSeen !== false || intro) return;
    if (wallet && !status) return;
    if (status?.eye) { markIntroSeen(); return; }
    setIntro(true);
  }, [introSeen, intro, wallet, status, markIntroSeen]);
  // Whether this phone has been through the Seeker walk-through, for the
  // last page's checklist and its button.
  useEffect(() => {
    let live = true;
    if (!intro || !wallet || !EYE_FINGER_ENABLED) { setPhoneVerified(false); return; }
    void getWitnessState(wallet).then((state) => { if (live) setPhoneVerified(state.kind === 'verified'); }).catch(() => undefined);
    return () => { live = false; };
  }, [intro, wallet]);
  const closeIntro = useCallback(() => { setIntro(false); markIntroSeen(); }, [markIntroSeen]);
  const openFromIntro = useCallback(() => { closeIntro(); setOpenRequest((count) => count + 1); }, [closeIntro]);
  const showIntro = useCallback(() => setIntro(true), []);

  const beforeOpen = useCallback(async () => {
    if (!EYE_FINGER_ENABLED || !wallet) return true;
    const state = await getWitnessState(wallet).catch(() => null);
    // Verified, or a phone without the module: nothing to walk through.
    if (!state || state.kind !== 'none') return true;
    return new Promise<boolean>((resolve) => { verdict.current = resolve; setVerifying(true); });
  }, [wallet]);

  const settleVerify = useCallback((ok: boolean) => {
    setVerifying(false);
    const resolve = verdict.current;
    verdict.current = null;
    resolve?.(ok);
  }, []);

  // Your own Blink went through: your Eye flashes like any other blink
  // arriving, and the count under the title moves with it.
  const onBlinked = useCallback(() => {
    const me = network?.me;
    setPupilBlink((count) => count + 1);
    if (!me) return;
    scene.current?.push({ type: 'blink', items: [{ serial: me.serial, ring: me.ring }] });
    if (!blinked.current.has(me.serial)) {
      blinked.current.add(me.serial);
      setLiveBlinks((count) => count + 1);
    }
  }, [network]);

  const size = Math.min(width, MAX_W);
  // The portal's glowing ring sits just inside the innermost ring.
  const pupil = Math.round(size * 0.39);
  const watching = network?.totals.watching ?? network?.totals.eyes ?? status?.network?.watching ?? status?.network?.eyes ?? null;
  const nextSerial = network ? network.totals.eyes + 1 : status ? status.network.eyes + 1 : null;
  const blinkedToday = network ? network.totals.blinkedToday + liveBlinks : null;
  const received = network?.gazes.received ?? [];
  const circles = network?.circles ?? [];
  const peak = circles.reduce((most, circle) => Math.max(most, circle.blinked), 0);
  // The sections below the Iris, each only when the server has sent its
  // numbers. The pulse comes by UTC hour; the phone shows it by its own
  // clock, the row running from the phone's midnight.
  const pulse = useMemo(
    () => (network?.pulse?.hours && network.pulse.hours.length === 24 ? pulseInPhoneTime(network.day, network.pulse.hours) : null),
    [network?.day, network?.pulse?.hours],
  );
  const pulsePeak = pulse ? pulse.reduce((most, count) => Math.max(most, count), 0) : 0;
  const peakHour = pulse ? pulse.indexOf(pulsePeak) : -1;
  const myHour = network?.me?.blinkHour != null ? localHourOf(network.day, network.me.blinkHour) : null;
  const ladder = network?.ladder?.rings && network.ladder.rings.length > 0 ? network.ladder.rings : null;
  const ladderPeak = ladder ? ladder.reduce((most, count) => Math.max(most, count), 0) : 0;
  const myRing = network?.me?.ring ?? null;
  const percentile = network?.me?.percentile ?? null;
  const streaks = network?.leaders?.streaks?.slice(0, 3) ?? [];
  const newest = network?.leaders?.newest?.slice(-5) ?? [];
  // The Eyes themselves, as small cards: yours first, then the ones that
  // blinked today, then the ones nearest the centre.
  const strip = useMemo(() => {
    if (!network) return [];
    const me = network.me?.serial ?? null;
    return [...network.eyes]
      .sort((a, b) => Number(b.serial === me) - Number(a.serial === me) || Number(b.blinkedToday) - Number(a.blinkedToday) || a.ring - b.ring || a.serial - b.serial)
      .slice(0, STRIP_MAX);
  }, [network]);
  const myEye = network?.me ? eyeOf(network.me.serial) : null;
  // The nudge to look at somebody's Eye: for a person with an Eye who has
  // not looked at anyone today, while there is somebody to look at.
  const lookNudge = Boolean(network?.me) && (network?.gazes.sentToday ?? 0) === 0 && (network?.eyes.length ?? 0) > 1;

  return (
    <View style={styles.screen}>
      <ScrollView
        ref={list}
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void read(true)} tintColor={colors.accent} colors={[colors.accent]} progressBackgroundColor={colors.panel} />}
      >
        <EyePanel
          wallet={wallet}
          onStatus={onStatus}
          onBlinked={onBlinked}
          onConnect={() => void connect()}
          onBeforeOpen={beforeOpen}
          onHowItWorks={showIntro}
          onOpenCard={myEye ? () => setPicked(myEye) : undefined}
          onLook={scrollToIris}
          openRequest={openRequest}
          nextSerial={nextSerial}
          eyesNow={network?.totals.eyes ?? status?.network.eyes ?? null}
          prices={health?.prices ?? null}
          looked={received.length}
          lookNudge={lookNudge}
          connecting={connecting}
          connectError={connectError}
        />

        <View style={styles.head}>
          <Eyebrow>{t('The Iris')}</Eyebrow>
          <Text style={styles.title}>
            {watching == null
              ? t('The Iris is waking up')
              : watching === 0 ? t('The Iris is waiting for its first Eye')
                : watching === 1 ? t('1 Eye is watching') : t('{count} Eyes are watching', { count: integer(watching) })}
          </Text>
          {network && blinkedToday != null ? (
            <Facts
              // A zero is never shown: at launch it reads as an empty room.
              items={[
                blinkedToday > 0 ? t('{count} blinked today', { count: integer(blinkedToday) }) : null,
                network.totals.perfect > 0 ? (network.totals.perfect === 1 ? t('1 Perfect Eye') : t('{count} Perfect Eyes', { count: integer(network.totals.perfect) })) : null,
                network.totals.newToday > 0 ? t('{count} new today', { count: integer(network.totals.newToday) }) : null,
              ].filter((item): item is string => item != null)}
            />
          ) : null}
        </View>

        <View style={styles.sceneBlock} onLayout={(event) => { sceneTop.current = event.nativeEvent.layout.y; }}>
          <View style={[styles.sceneWrap, { height: size }]}>
            <IrisScene ref={scene} size={size} onTap={onTap} onView={onView} />
            <Animated.View pointerEvents="none" style={[styles.pupilWrap, { top: (size - pupil) / 2, left: (size - pupil) / 2 }, pupilStyle]}>
              <PupilEye size={pupil} blink={pupilBlink} />
            </Animated.View>
          </View>
          <Text style={styles.sceneHint}>{t('Rings are streaks, the longest at the centre. Pinch to zoom, drag to look around, tap an Eye to see it.')}</Text>
        </View>

        {strip.length > 0 ? (
          <View style={styles.section}>
            <Eyebrow>{t('Eyes on the Iris')}</Eyebrow>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stripScroll} contentContainerStyle={styles.strip}>
              {strip.map((eye) => {
                const me = network?.me?.serial === eye.serial;
                return (
                  <Pressable key={eye.serial} onPress={() => pick(eye)} style={({ pressed }) => [styles.card, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={serialName(eye.serial)}>
                    <Image source={{ uri: `${EYE_BASE_URL}/eye/${eye.serial}.png` }} style={[styles.cardImage, me && styles.cardMine, !eye.blinkedToday && styles.cardShut]} />
                    <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={[styles.cardSerial, me && styles.cardSerialMine]}>{me ? t('you') : serialTag(eye.serial)}</Text>
                    <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={styles.cardFact}>{days(eye.streak)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {network?.me && received.length > 0 ? (
          <View style={styles.section}>
            <Eyebrow>{t('Looks at your Eye')}</Eyebrow>
            <Text style={styles.looksTitle}>
              {received.length === 1 ? t('1 person looked at your Eye today') : t('{count} people looked at your Eye today', { count: received.length })}
            </Text>
            <View style={styles.chips}>
              {received.map((look) => {
                const eye = eyeOf(look.serial);
                return (
                  <Pressable key={look.serial} disabled={!eye} onPress={() => { if (eye) pick(eye); }} style={({ pressed }) => [styles.chip, pressed && styles.pressed]} accessibilityRole="button">
                    <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={styles.chipText}>{look.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.sectionLine}>{t('Tap a name to look back. Its owner will see it.')}</Text>
          </View>
        ) : null}

        {pulse && pulsePeak > 0 ? (
          <View style={styles.section}>
            <Eyebrow>{t('Pulse of the day')}</Eyebrow>
            <View style={styles.pulse}>
              {pulse.map((count, hour) => {
                const mine = myHour === hour;
                const bar = count > 0 ? Math.max(4, Math.round((count / Math.max(1, pulsePeak)) * PULSE_H)) : 2;
                return <View key={hour} style={[styles.pulseBar, { height: bar, backgroundColor: mine ? colors.metal : count > 0 ? colors.positive : colors.line }]} />;
              })}
            </View>
            <View style={styles.pulseTicks}>
              {[0, 6, 12, 18].map((hour) => (
                <Text key={hour} maxFontSizeMultiplier={1.3} style={styles.pulseTick}>{String(hour).padStart(2, '0')}</Text>
              ))}
            </View>
            <Text style={styles.sectionLine}>
              {[
                t('Most Blinks came at {hour}.', { hour: hh(peakHour) }),
                myHour != null ? t('Yours came at {hour}.', { hour: hh(myHour) }) : null,
              ].filter(Boolean).join(' ')}
            </Text>
          </View>
        ) : null}

        {ladder && ladderPeak > 0 ? (
          <View style={styles.section}>
            <Eyebrow>{t('The ladder')}</Eyebrow>
            <View style={styles.ladder}>
              {ladder.map((_, position) => {
                // The service counts innermost first; the ladder climbs left
                // to right, from a streak of one to thirty and more.
                const index = ladder.length - 1 - position;
                const count = ladder[index] ?? 0;
                const mine = myRing === index;
                const bar = count > 0 ? Math.max(4, Math.round((count / Math.max(1, ladderPeak)) * LADDER_H)) : 2;
                return (
                  <View key={index} style={styles.rung}>
                    <Text numberOfLines={1} maxFontSizeMultiplier={1.25} style={[styles.rungCount, mine && styles.rungMine]}>{count > 0 ? integer(count) : ' '}</Text>
                    <View style={[styles.rungBar, { height: bar, backgroundColor: mine ? colors.metal : count > 0 ? colors.positive : colors.line }]} />
                    <Text numberOfLines={1} maxFontSizeMultiplier={1.25} style={[styles.rungLabel, mine && styles.rungMine]}>{RAIL[index] ?? ''}</Text>
                  </View>
                );
              })}
            </View>
            <Text style={styles.sectionLine}>
              {[
                t('Days in a row, and how many Eyes stand on each ring. A Blink every day moves your Eye one ring closer to the centre.'),
                network?.me && percentile != null ? t('You are ahead of {p}% of Eyes.', { p: integer(percentile) }) : null,
              ].filter(Boolean).join(' ')}
            </Text>
          </View>
        ) : null}

        {streaks.length > 0 ? (
          <View style={styles.section}>
            <Eyebrow>{t('Longest streaks')}</Eyebrow>
            {streaks.map((leader) => {
              const eye = eyeOf(leader.serial);
              return (
                <Pressable key={leader.serial} disabled={!eye} onPress={() => { if (eye) pick(eye); }} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="button">
                  <Text numberOfLines={1} style={styles.rowName}>{leader.name}</Text>
                  <Text numberOfLines={1} style={styles.rowValue}>{days(leader.streak)}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {newest.length > 0 ? (
          <View style={styles.section}>
            <Eyebrow>{t('New today')}</Eyebrow>
            {newest.map((fresh) => {
              const eye = eyeOf(fresh.serial);
              return (
                <Pressable key={fresh.serial} disabled={!eye} onPress={() => { if (eye) pick(eye); }} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="button">
                  <Text numberOfLines={1} style={styles.rowName}>{fresh.name}</Text>
                  <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={styles.rowSerial}>{serialName(fresh.serial)}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {network?.circlesShown === true && circles.length > 0 ? (
          <View style={styles.circles}>
            <Eyebrow>{t('Circles today')}</Eyebrow>
            {circles.map((circle) => (
              <View key={circle.pool} style={styles.circle}>
                <View style={styles.row}>
                  <Text numberOfLines={1} style={styles.rowName}>{circle.label}</Text>
                  <Text numberOfLines={1} style={styles.rowValue}>{t('{count} blinked', { count: integer(circle.blinked) })}</Text>
                </View>
                <Meter percent={peak > 0 ? (circle.blinked / peak) * 100 : 0} tone={colors.positive} height={3} />
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {intro ? (
        <View style={styles.walkthrough}>
          <EyeOnboarding
            wallet={wallet}
            status={status}
            nextSerial={nextSerial}
            verified={phoneVerified}
            connecting={connecting}
            connectError={connectError}
            onConnect={() => void connect()}
            onOpen={openFromIntro}
            onClose={closeIntro}
            watching={network?.totals.eyes ?? null}
            blinkedToday={network?.totals.blinkedToday ?? null}
          />
        </View>
      ) : null}

      {verifying && wallet ? (
        <View style={styles.walkthrough}>
          <WitnessWalkthrough wallet={wallet} onVerified={() => settleVerify(true)} onCancel={() => settleVerify(false)} />
        </View>
      ) : null}

      {picked ? (
        <EyeSheet
          eye={picked}
          gazes={network?.gazes ?? null}
          wallet={wallet}
          mine={network?.me?.serial === picked.serial}
          width={width}
          height={height}
          fontScale={fontScale}
          onClose={() => setPicked(null)}
          onGazed={onGazed}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  // Over the whole tab, under nothing: the walk-through has the screen to itself.
  walkthrough: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.bg, zIndex: 30 },
  // The tab bar under this list carries the navigation bar's inset itself,
  // so the list only needs room to breathe at its end.
  content: { width: '100%', maxWidth: MAX_W, alignSelf: 'center', paddingHorizontal: GUTTER, paddingTop: spacing.md, paddingBottom: spacing.xxl, gap: spacing.lg },
  pressed: { opacity: 0.7 },
  head: { gap: spacing.xs },
  title: { color: colors.text, fontFamily: font.bold, fontSize: 26, lineHeight: 32, letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
  facts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: 2 },
  factsCenter: { justifyContent: 'center' },
  fact: { color: colors.muted, fontFamily: font.medium, ...type.small, fontVariant: ['tabular-nums'] },
  // The field bleeds to both edges of the page, as the radar does.
  sceneBlock: { gap: spacing.sm, marginHorizontal: -GUTTER },
  // The field clips its own pupil: panned to the edge, the Eye slides out
  // of the field the way its small eyes do, and never over the page.
  sceneWrap: { backgroundColor: colors.bg, overflow: 'hidden' },
  pupilWrap: { position: 'absolute' },
  sceneHint: { color: colors.faint, fontFamily: font.regular, ...type.micro, textAlign: 'center', paddingHorizontal: GUTTER + spacing.sm },
  section: { gap: spacing.sm },
  sectionLine: { color: colors.muted, fontFamily: font.regular, ...type.small, fontVariant: ['tabular-nums'] },
  // The Eyes as small cards in a row that scrolls sideways: the picture, the
  // number, one fact.
  stripScroll: { marginHorizontal: -GUTTER },
  strip: { paddingHorizontal: GUTTER, gap: spacing.sm },
  card: { width: CARD, gap: 2 },
  cardImage: { width: CARD, height: CARD, borderRadius: radius.inner, backgroundColor: colors.inset },
  cardMine: { borderWidth: 1.5, borderColor: colors.metal },
  cardShut: { opacity: 0.55 },
  cardSerial: { color: colors.text, fontFamily: font.monoSemibold, fontSize: 11, lineHeight: 15, letterSpacing: 0.3 },
  cardSerialMine: { color: colors.metal },
  cardFact: { color: colors.faint, fontFamily: font.regular, ...type.micro, fontVariant: ['tabular-nums'] },
  looksTitle: { color: colors.text, fontFamily: font.bold, fontSize: 18, lineHeight: 24, letterSpacing: -0.3 },
  // The names of the people who looked, each its own small pill.
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { maxWidth: '100%', borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5, backgroundColor: colors.panel },
  chipText: { color: colors.text, fontFamily: font.medium, ...type.small },
  // Twenty-four bars, one an hour, grown from the baseline.
  pulse: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: PULSE_H, marginTop: spacing.xs },
  pulseBar: { flex: 1, borderRadius: 1.5 },
  // The phone's own hours under the bars: midnight, six, noon, six.
  pulseTicks: { flexDirection: 'row', marginTop: 2 },
  pulseTick: { flex: 1, color: colors.muted, fontFamily: font.regular, ...type.small, fontVariant: ['tabular-nums'] },
  // Nine columns, one a ring: the count on top, the bar, the streak under.
  ladder: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginTop: spacing.xs },
  rung: { flex: 1, alignItems: 'center', gap: 3 },
  rungCount: { color: colors.muted, fontFamily: font.semibold, fontSize: 11, lineHeight: 15, fontVariant: ['tabular-nums'] },
  rungBar: { width: '100%', borderRadius: 1.5 },
  rungLabel: { color: colors.muted, fontFamily: font.monoSemibold, fontSize: 10.5, lineHeight: 15, letterSpacing: 0.2 },
  rungMine: { color: colors.metal },
  row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md, minHeight: 24 },
  rowName: { flexShrink: 1, color: colors.text, fontFamily: font.medium, ...type.body },
  rowValue: { color: colors.text, fontFamily: font.semibold, ...type.body, fontVariant: ['tabular-nums'] },
  rowSerial: { color: colors.metal, fontFamily: font.monoBold, fontSize: 12, letterSpacing: 0.8 },
  circles: { gap: spacing.md },
  circle: { gap: spacing.sm },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(2, 4, 7, 0.72)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.panel, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderWidth: 1, borderColor: '#111B24', paddingHorizontal: GUTTER, paddingTop: spacing.sm },
  sheetGrip: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong, marginBottom: spacing.sm },
  sheetBody: { gap: spacing.sm },
  sheetHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  sheetSerial: { color: colors.metal, fontFamily: font.monoBold, fontSize: 12, letterSpacing: 0.8 },
  sheetImage: { alignSelf: 'center', borderRadius: radius.inner, backgroundColor: colors.inset, marginVertical: spacing.xs },
  sheetName: { color: colors.text, fontFamily: font.bold, fontSize: 18, lineHeight: 24, letterSpacing: -0.3, textAlign: 'center' },
  sheetAction: { marginTop: spacing.xs, gap: spacing.sm },
  sheetMicro: { color: colors.faint, fontFamily: font.regular, ...type.small, textAlign: 'center' },
  note: { color: colors.positive, fontFamily: font.medium, ...type.small, textAlign: 'center' },
  error: { color: colors.negative, fontFamily: font.medium, ...type.small, textAlign: 'center' },
});
