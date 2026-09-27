import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { t } from '../i18n';
import { integer } from '../format';
import { isWalletCancel, connectReadOnlyWallet } from '../mwa';
import { rememberConnectedWallet, useConnectedWallet } from '../wallet';
import { colors, font, radius, spacing, type } from '../theme';
import { Button, Eyebrow, Meter } from '../lab/kit';
import { EyeApiError, fetchEyeNetwork, sendGaze, type EyeNetwork, type EyeStatus, type NetworkEye } from './api';
import { EYE_BASE_URL, EYE_FINGER_ENABLED } from './config';
import { EyePanel } from './EyePanel';
import { EyeOnboarding } from './EyeOnboarding';
import { PortalEye } from './PortalEye';
import { WitnessWalkthrough, getWitnessState } from './WitnessWalkthrough';
import { IrisScene, type IrisHandle } from './IrisScene';
import { openEyeStream } from './stream';
import { clock, epochMs, localHourOf, pulseInPhoneTime } from './time';

// The Eyes tab: your Eye, then the network as one eye.
//
// On top, your own Eye — the card to open one, or the picture, the streak
// and the Blink — and, with no wallet, the one button that connects. Then
// the Iris: every open Eye is a ring on it, closer to the pupil the longer
// its streak, lit if it blinked today, and the pupil counts down to the next
// Blink. Under the Iris: who gazed at you today; the day's pulse, hour by
// hour; the ladder of the nine rings; the longest streaks and the Eyes that
// opened today. The Guardian circles are drawn only when the server says
// there is more than one to compare. A tap on a ring opens that Eye — its
// card, its streak, and a Gaze, five a day.
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
// Set once the walk-through of the Eye has been seen or skipped.
const INTRO_KEY = 'skr-eyes:eye-intro:v1';
const RINGS = 9;
// The tallest bar of the day's pulse.
const PULSE_H = 34;

const hh = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

const serialName = (serial: number) => `EYE #${String(serial).padStart(4, '0')}`;

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

// What each ring of the Iris stands for: the streak an Eye needs to stand
// on it, innermost first (the service's src/iris.mjs).
const RING_FLOOR = [30, 21, 14, 10, 7, 5, 3, 2, 0];
function ringDays(index: number): string {
  if (index === 0) return `${t('Perfect Eye')} · 30+`;
  const from = RING_FLOOR[index] ?? 0;
  const to = (RING_FLOOR[index - 1] ?? 1) - 1;
  if (from <= 1) return t('New, or 1 day');
  return from === to ? t('{count} days', { count: from }) : t('{from} to {to} days', { from, to });
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
  const ticket = useRef(0);
  const reading = useRef(false);
  const wanted = useRef(false);
  const latestRead = useRef<(visible?: boolean) => Promise<void>>(async () => undefined);
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

  // Your own Blink went through: your ring flashes like any other blink
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

  const size = width;
  // The portal's glowing ring sits just inside the innermost rail.
  const pupil = Math.round(size * 0.39);
  const watching = network?.totals.watching ?? network?.totals.eyes ?? status?.network?.watching ?? status?.network?.eyes ?? null;
  const nextSerial = network ? network.totals.eyes + 1 : status ? status.network.eyes + 1 : null;
  const blinkedToday = network ? network.totals.blinkedToday + liveBlinks : null;
  const received = network?.gazes.received ?? [];
  const circles = network?.circles ?? [];
  const peak = circles.reduce((most, circle) => Math.max(most, circle.blinked), 0);
  // The new sections, each only when the server has sent its numbers.
  // The pulse comes by UTC hour; the phone shows it by its own clock, the row
  // running from the phone's midnight, and the hours it names are local too.
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
  // The Eyes themselves, as their cards: the ones that blinked today first,
  // then the ones nearest the pupil. Yours among them.
  const gallery = useMemo(() => {
    if (!network) return [];
    return [...network.eyes]
      .sort((a, b) => Number(b.blinkedToday) - Number(a.blinkedToday) || a.ring - b.ring || a.serial - b.serial)
      .slice(0, 40);
  }, [network]);
  const myEye = network?.me ? network.eyes.find((eye) => eye.serial === network.me?.serial) ?? null : null;

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void read(true)} tintColor={colors.accent} />}
      >
        <EyePanel wallet={wallet} onStatus={onStatus} onBlinked={onBlinked} onConnect={() => void connect()} onBeforeOpen={beforeOpen} onHowItWorks={showIntro} onOpenCard={myEye ? () => setPicked(myEye) : undefined} openRequest={openRequest} nextSerial={nextSerial} connecting={connecting} connectError={connectError} />

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
            <PupilEye size={pupil} blink={pupilBlink} />
          </View>
        </View>

        {gallery.length > 0 ? (
          <View style={styles.section}>
            <Eyebrow>{t('Eyes on the Iris')}</Eyebrow>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -spacing.lg }} contentContainerStyle={styles.gallery}>
              {gallery.map((eye) => {
                const me = network?.me?.serial === eye.serial;
                return (
                  <Pressable key={eye.serial} onPress={() => { void Haptics.selectionAsync(); setPicked(eye); }} style={styles.galleryItem} accessibilityRole="button" accessibilityLabel={serialName(eye.serial)}>
                    <Image source={{ uri: `${EYE_BASE_URL}/eye/${eye.serial}.png` }} style={[styles.galleryImage, me && styles.galleryMine, !eye.blinkedToday && styles.galleryShut]} />
                    <Text numberOfLines={1} style={[styles.galleryName, me && styles.galleryNameMine]}>{me ? t('you') : eye.name}</Text>
                    <Text numberOfLines={1} style={styles.galleryMeta}>{`${serialName(eye.serial)} · ${eye.streak === 1 ? t('1 day') : t('{count} days', { count: integer(eye.streak) })}`}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

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

        {pulse ? (
          <View style={styles.section}>
            <Eyebrow>{t('Pulse of the day')}</Eyebrow>
            <View style={styles.pulse}>
              {pulse.map((count, hour) => {
                const mine = myHour === hour;
                const height = count > 0 ? Math.max(4, Math.round((count / Math.max(1, pulsePeak)) * PULSE_H)) : 2;
                return <View key={hour} style={[styles.pulseBar, { height, backgroundColor: mine ? colors.metal : count > 0 ? colors.positive : colors.line }]} />;
              })}
            </View>
            <View style={styles.pulseTicks}>
              {[0, 6, 12, 18].map((hour) => (
                <Text key={hour} style={styles.pulseTick}>{String(hour).padStart(2, '0')}</Text>
              ))}
            </View>
            {pulsePeak > 0 ? (
              <Text style={styles.sectionLine}>
                {[
                  t('{count} blinked at {hour}', { count: integer(pulsePeak), hour: hh(peakHour) }),
                  myHour != null ? t('you blinked at {hour}', { hour: hh(myHour) }) : null,
                ].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
          </View>
        ) : null}

        {ladder ? (
          <View style={styles.section}>
            <Eyebrow>{t('The ladder')}</Eyebrow>
            <Text style={styles.sectionLine}>{t('Each ring is a streak. A Blink every day moves your Eye one ring closer to the pupil.')}</Text>
            {ladder.map((count, index) => {
              const mine = myRing === index;
              return (
                <View key={index} style={styles.rung}>
                  <View style={styles.circleRow}>
                    <Text numberOfLines={1} style={[styles.rungName, mine && styles.rungMine]}>{ringDays(index)}</Text>
                    <Text numberOfLines={1} style={[styles.circleCount, mine && styles.rungMine]}>{count === 1 ? t('1 eye') : t('{count} eyes', { count: integer(count) })}</Text>
                  </View>
                  <Meter percent={ladderPeak > 0 ? (count / ladderPeak) * 100 : 0} tone={mine ? colors.metal : colors.positive} height={3} />
                </View>
              );
            })}
            {network?.me && percentile != null ? <Text style={styles.sectionLine}>{t('You are ahead of {p}% of Eyes', { p: integer(percentile) })}</Text> : null}
          </View>
        ) : null}

        {streaks.length > 0 ? (
          <View style={styles.section}>
            <Eyebrow>{t('Leaders')}</Eyebrow>
            {streaks.map((eye) => (
              <View key={eye.serial} style={styles.circleRow}>
                <Text numberOfLines={1} style={styles.circleName}>{eye.name}</Text>
                <Text numberOfLines={1} style={styles.circleCount}>{eye.streak === 1 ? t('1 day') : t('{count} days', { count: integer(eye.streak) })}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {newest.length > 0 ? (
          <View style={styles.section}>
            <Eyebrow>{t('New today')}</Eyebrow>
            {newest.map((eye) => (
              <View key={eye.serial} style={styles.circleRow}>
                <Text numberOfLines={1} style={styles.circleName}>{eye.name}</Text>
                <Text numberOfLines={1} style={styles.serialText}>{serialName(eye.serial)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {network?.circlesShown === true && circles.length > 0 ? (
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
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 130, gap: spacing.lg },
  head: { gap: spacing.xs },
  title: { color: colors.text, fontFamily: font.bold, fontSize: 26, lineHeight: 32, letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
  sub: { color: colors.muted, fontFamily: font.regular, ...type.body, fontVariant: ['tabular-nums'] },
  sceneWrap: { backgroundColor: colors.bg },
  pupilWrap: { position: 'absolute' },
  // The Eyes as cards, in a row that scrolls sideways.
  gallery: { paddingHorizontal: spacing.lg, gap: spacing.md },
  galleryItem: { width: 96, gap: 3 },
  galleryImage: { width: 96, height: 96, borderRadius: radius.inner, backgroundColor: colors.inset },
  galleryMine: { borderWidth: 1.5, borderColor: colors.metal },
  galleryShut: { opacity: 0.55 },
  galleryName: { color: colors.text, fontFamily: font.semibold, ...type.micro },
  galleryNameMine: { color: colors.metal },
  galleryMeta: { color: colors.faint, fontFamily: font.regular, fontSize: 10.5, lineHeight: 14, fontVariant: ['tabular-nums'] },
  pupil: { alignItems: 'center', justifyContent: 'center', gap: 2 },
  pupilEyebrow: { color: colors.muted, fontFamily: font.semibold, ...type.eyebrow },
  pupilTime: { color: colors.text, fontFamily: font.black, fontSize: 24, lineHeight: 30, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  pupilLabel: { color: colors.muted, fontFamily: font.regular, ...type.micro, maxWidth: '86%' },
  gazes: { gap: spacing.xs },
  gazesTitle: { color: colors.text, fontFamily: font.bold, fontSize: 18, lineHeight: 24, letterSpacing: -0.3 },
  gazesNames: { color: colors.muted, fontFamily: font.regular, ...type.body },
  section: { gap: spacing.sm },
  sectionLine: { color: colors.muted, fontFamily: font.regular, ...type.small, fontVariant: ['tabular-nums'] },
  // Twenty-four bars, one an hour, grown from the baseline.
  pulse: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: PULSE_H, marginTop: spacing.xs },
  pulseBar: { flex: 1, borderRadius: 1.5 },
  // The phone's own hours under the bars: midnight, six, noon, six.
  pulseTicks: { flexDirection: 'row', marginTop: 2 },
  pulseTick: { flex: 1, color: colors.muted, fontFamily: font.regular, ...type.small, fontVariant: ['tabular-nums'] },
  rung: { gap: spacing.xs },
  rungName: { flexShrink: 1, color: colors.muted, fontFamily: font.medium, ...type.small },
  rungMine: { color: colors.metal },
  serialText: { color: colors.metal, fontFamily: font.monoBold, fontSize: 12, letterSpacing: 0.8 },
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
