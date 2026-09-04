import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, fetchEcosystemState, fetchWalletProfile } from '../api';
import { t } from '../i18n';
import { compact, integer, shortAddress } from '../format';
import { connectReadOnlyWallet } from '../mwa';
import { clearStoredSchedule, scheduleUnlockAlerts } from '../notifications';
import { SESSION_KEY } from '../session';
import { usePref } from '../prefs';
import { Switch } from 'react-native';
import { colors, font, radius, spacing, type } from '../theme';
import type { WalletProfile } from '../types';
import { fetchWalletAge, type PositionAge } from './age';
import { forgetStakeRun } from './stake/useStakeRun';
import { Button, Evidence, Eyebrow, Meter, Panel, Tile } from './kit';
import { StakerCard, cardFacts } from './StakerCard';
import type { CardFacts } from './cardArt';
import { CardExporter, shareCardPng } from './shareCard';
import type { CardHandle } from './cardArt';
import { StakeSheet } from './stake/StakeSheet';

// The card is the reason to open the app daily, so the phone remembers who
// you are. Only the public address and the name the wallet gave us are stored.

// Kept beside the session key rather than inside it: disconnecting has to erase
// this too, and one key per thing is how that stays obvious.
const CARD_KEY = 'skr-eyes.card';

function countdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const remainder = safe % 60;
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${String(hours % 24).padStart(2, '0')}h`;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':');
}

export function MyLab() {
  const { width } = useWindowDimensions();
  const [address, setAddress] = useState('');
  const [walletLabel, setWalletLabel] = useState<string | null>(null);
  // True only for the wallet that answered Mobile Wallet Adapter. A pasted
  // address is looked at, never staked from: the phone cannot sign for it.
  const [connected, setConnected] = useState(false);
  const [profile, setProfile] = useState<WalletProfile | null>(null);
  const [age, setAge] = useState<PositionAge | null>(null);
  const ageExact = useRef(false);
  const session = useRef(0);
  const [ageError, setAgeError] = useState<string | null>(null);
  const [networkStake, setNetworkStake] = useState<number | null>(null);
  const [networkPositions, setNetworkPositions] = useState<number | null>(null);
  const [sharing, setSharing] = useState(false);
  const cardArt = useRef<CardHandle>(null);
  const [busy, setBusy] = useState(false);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alertStatus, setAlertStatus] = useState<string | null>(null);
  // Kept apart from alertStatus on purpose: that one also decides what the
  // unlock-alert button calls itself, so writing a note about the card into it
  // makes the button claim alerts were armed when none were.
  const [shareNote, setShareNote] = useState<string | null>(null);
  // The last card this phone drew, kept on disk.
  //
  // Everything the card shows arrives over the network, so a cold start used to
  // mean several seconds of empty space where the card belongs — and a cold
  // start is exactly what a share can cause, because the share sheet puts this
  // app in the background where Android is free to end it. Coming back to a
  // blank Me tab reads as "my card is gone", which is the one thing this screen
  // must never say. So the numbers are written down after each successful read
  // and drawn immediately on the next launch, then replaced by the live ones.
  const [remembered, setRemembered] = useState<CardFacts | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1_000));
  const [staking, setStaking] = useState(false);
  // The daily sixteen: the stake sheet opened with one SKR in sixteen parts.
  const [sixteen, setSixteen] = useState(false);
  // What the shared picture leaves out. Remembered between launches, and
  // applied to the card on this screen too, so what is seen is what is sent.
  const [hideName, setHideName] = usePref('card:hideName', false);
  const [hideAmount, setHideAmount] = usePref('card:hideAmount', false);
  const privacy = { hideName, hideAmount };

  useEffect(() => {
    fetchEcosystemState().then((state) => {
      setNetworkStake(state.metrics?.activeStaked ?? null);
      setNetworkPositions(state.metrics?.totalPositions ?? null);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(CARD_KEY).then((raw) => {
      if (cancelled || !raw) return;
      try {
        setRemembered(JSON.parse(raw) as CardFacts);
      } catch {
        // A card we cannot read is a card we do not have.
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(SESSION_KEY).then((raw) => {
      if (cancelled || !raw) return;
      try {
        const saved = JSON.parse(raw) as { address?: string; label?: string | null };
        if (saved.label) setWalletLabel(saved.label);
        // Connect saves the label key even when the wallet gave none; a look-up saves only the address.
        if ('label' in saved) setConnected(true);
        if (saved.address) void inspect(saved.address);
      } catch {
        // A corrupted session is simply a session we do not have.
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
    // inspect is stable; this restore runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1_000));
    const timer = setInterval(tick, 1_000);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') tick(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);

  const inspect = useCallback(async (wallet: string, quiet = false) => {
    const clean = wallet.trim();
    if (!clean) return;
    if (!quiet) setBusy(true);
    setError(null);
    // A quiet re-read keeps the age it already has; only a new look-up starts
    // the chain walk again, or the panel would blink to 'reading' every minute.
    if (!quiet) { setAge(null); ageExact.current = false; }
    // Disconnect moves the session on; an answer from before it is dropped, or
    // a slow read would quietly re-save the wallet the person just erased.
    const ticket = session.current;
    try {
      const next = await fetchWalletProfile(clean);
      if (ticket !== session.current) return;
      setAddress(clean);
      setProfile(next);
      setReadAt(Math.floor(Date.now() / 1_000));
      void AsyncStorage.mergeItem(SESSION_KEY, JSON.stringify({ address: clean })).catch(() => AsyncStorage.setItem(SESSION_KEY, JSON.stringify({ address: clean })).catch(() => undefined));
      const accounts = next.positions.map((position) => position.stakeAccount).filter(Boolean);
      if (quiet && ageExact.current) return;
      setAgeError(null);
      void fetchWalletAge(accounts, (partial) => { if (ticket === session.current) setAge((current) => current?.exact ? current : partial); })
        .then((final) => { if (ticket !== session.current) return; if (final) { setAge(final); ageExact.current = Boolean(final.exact); } else setAgeError(t('the chain returned no signatures')); })
        .catch((caught) => setAgeError(caught instanceof Error ? caught.message : t('age lookup failed')));
    } catch (caught) {
      if (quiet || ticket !== session.current) return;
      setProfile(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (caught instanceof ApiError && caught.status === 503) setError(t('The finalized snapshot is still warming up. Try again in a moment.'));
      else setError(caught instanceof Error ? caught.message : t('This position could not be read'));
    } finally {
      if (!quiet) setBusy(false);
    }
  }, []);

  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const account = await connectReadOnlyWallet();
      setWalletLabel(account.label ?? null);
      setConnected(true);
      void AsyncStorage.setItem(SESSION_KEY, JSON.stringify({ address: account.address, label: account.label ?? null })).catch(() => undefined);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await inspect(account.address);
    } catch (caught) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(caught instanceof Error ? caught.message : t('The wallet request was cancelled'));
      setBusy(false);
    }
  }, [inspect]);

  const enableAlerts = useCallback(async () => {
    if (!profile) return;
    setBusy(true);
    setAlertStatus(null);
    try {
      const count = await scheduleUnlockAlerts(profile);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAlertStatus(count ? (count === 1 ? t('1 unlock alert armed on this phone.') : t('{count} unlock alerts armed on this phone.', { count })) : t('Nothing left to wait for — the cooldown is already over.'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('Alerts could not be scheduled'));
    } finally {
      setBusy(false);
    }
  }, [profile]);

  // The picture is built from what the chain proved, and from nothing else.
  // A fact still on its way is left off the card rather than guessed at.
  const shareCard = useCallback(async () => {
    if (!profile) return;
    setSharing(true);
    setError(null);
    setShareNote(null);
    try {
      void Haptics.selectionAsync();
      const png = await cardArt.current?.toPng();
      if (!png) throw new Error(t('The card is not ready yet'));
      const shared = await shareCardPng(png, cardFacts(profile, age, shownName, networkPositions, privacy));
      setShareNote(shared.carried
        ? null
        : shared.copied
          ? t('Caption copied. Paste it next to the picture.')
          : t('This phone would not take the caption — type it yourself.'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('The card could not be drawn'));
    } finally {
      setSharing(false);
    }
  }, [age, networkPositions, profile, walletLabel, hideName, hideAmount]);

  // What the card calls the person: the .skr name the server knows, else
  // whatever label the wallet app gave when it connected, else nothing.
  const shownName = profile?.name ? `${profile.name}.skr` : walletLabel;
  const live = profile ? cardFacts(profile, age, shownName, networkPositions, privacy) : null;

  // Written down only when the card is worth remembering: a profile that was
  // read and an age that finished walking. Half a card saved now is half a card
  // shown on the next launch.
  useEffect(() => {
    if (!live || live.days == null) return;
    void AsyncStorage.setItem(CARD_KEY, JSON.stringify(live)).catch(() => undefined);
    setRemembered(live);
    // The facts are a fresh object each render; the values inside it are what
    // matter, so the write is keyed on those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.name, live?.days, live?.exactDays, live?.firstSeenAt, live?.positionSkr, live?.networkPositions]);

  const claimed = Boolean(profile?.found);
  const share = profile && networkStake ? (profile.totals.activeStaked / networkStake) * 100 : null;
  const nextUnlock = profile?.nextUnlockAt ?? null;

  // Disconnect erases everything this app kept about the wallet, because that
  // is exactly what the privacy page promises: the stored session, the saved
  // stake run, and the unlock alerts — which are stored under a key named
  // after the address and carry it in their payload. Leaving any of those
  // behind would make the promise untrue.
  useEffect(() => {
    const wallet = profile?.wallet;
    if (!wallet) return;
    const timer = setInterval(() => { if (AppState.currentState === 'active') void inspect(wallet, true); }, 60_000);
    const subscription = AppState.addEventListener('change', (next) => { if (next === 'active') void inspect(wallet, true); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [inspect, profile?.wallet]);

  const disconnect = useCallback(async () => {
    session.current += 1;
    const previous = profile?.wallet ?? address;
    await AsyncStorage.removeItem(SESSION_KEY).catch(() => undefined);
    await AsyncStorage.removeItem(CARD_KEY).catch(() => undefined);
    setRemembered(null);
    await forgetStakeRun().catch(() => undefined);
    if (previous) await clearStoredSchedule(previous).catch(() => undefined);
    setProfile(null);
    setAge(null);
    setWalletLabel(null);
    setConnected(false);
    setAddress('');
    setAlertStatus(null);
  }, [address, profile]);

  return (
    <View style={styles.screen}>
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <StakerCard
        profile={profile}
        age={age}
        share={share}
        claimed={claimed}
        name={shownName}
        networkPositions={networkPositions}
        fallback={remembered}
        width={width - spacing.lg * 2}
        privacy={privacy}
      />

      {profile ? <CardExporter ref={cardArt} facts={cardFacts(profile, age, shownName, networkPositions, privacy)} /> : null}

      {claimed ? (
        <>
          <View style={styles.tiles}>
            <Tile
              label={t('Leaving')}
              value={compact(profile!.totals.pendingUnstake)}
              unit="SKR"
              note={profile!.totals.pendingPositions === 1 ? t('1 position in cooldown') : t('{count} positions in cooldown', { count: integer(profile!.totals.pendingPositions) })}
              tone={colors.pending}
            />
            <Tile
              label={profile!.totals.withdrawable > 0 ? t('Ready now') : t('Next unlock')}
              value={profile!.totals.withdrawable > 0 ? compact(profile!.totals.withdrawable) : nextUnlock ? countdown(nextUnlock - now) : '—'}
              unit={profile!.totals.withdrawable > 0 ? 'SKR' : undefined}
              note={profile!.totals.withdrawable > 0 ? t('Cooldown finished') : nextUnlock ? t('Until this position is free') : t('Nothing queued')}
              tone={profile!.totals.withdrawable > 0 ? colors.positive : colors.accent}
            />
          </View>

          <Panel style={styles.sharePanel}>
            <View style={styles.shareHead}>
              <View style={styles.shareLabel}><Eyebrow>{t('Your weight in the vault')}</Eyebrow></View>
              <Text style={styles.shareValue}>{share != null ? `${share.toFixed(5)}%` : '—'}</Text>
            </View>
            <View style={styles.shareMeter}>
              <Meter percent={share != null ? Math.max(share > 0 ? 1 : 0, Math.min(100, share)) : 0} tone={colors.metal} height={4} />
            </View>
            <Text style={styles.shareNote}>
              {age?.days != null
                ? age.exact
                  ? t('First stake {days} days ago, read from the oldest signature on your position account.', { days: age.days })
                  : t('Held at least {days} days. Your position has a long signature history, so the walk back is still going.', { days: age.days })
                : t('Reading the age of your position from the chain…')}
            </Text>
          </Panel>

          {connected ? <Button label={t('Stake SKR')} onPress={() => { void Haptics.selectionAsync(); setSixteen(false); setStaking(true); }} /> : null}

          {/* The sixteen is a stake too: only the wallet that can sign gets the button. */}
          {connected ? (
          <Panel style={styles.dailyPanel}>
            <View style={styles.dailyRow}>
              <View style={styles.dailyCopy}>
                <Eyebrow tone={colors.metal}>{t('The daily sixteen')}</Eyebrow>
                <Text style={styles.dailyNote}>{t('16 parts of 1 SKR, one approval. A small daily habit that keeps your position moving.')}</Text>
              </View>
              <Button label={t('Sixteen')} tone={colors.metal} onPress={() => { void Haptics.selectionAsync(); setSixteen(true); setStaking(true); }} />
            </View>
          </Panel>
          ) : null}

          <Panel style={styles.privacyPanel}>
            <View style={styles.privacyRow}>
              <View style={styles.privacyCopy}>
                <Text style={styles.privacyLabel}>{t('Hide my name on the card')}</Text>
                <Text style={styles.privacyNote}>{t('The eye in the ring closes and the card says A Seeker.')}</Text>
              </View>
              <Switch value={hideName} onValueChange={(value) => { void Haptics.selectionAsync(); setHideName(value); }} trackColor={{ true: colors.accentDim, false: colors.line }} thumbColor={hideName ? colors.accent : colors.faint} />
            </View>
            <View style={[styles.privacyRow, styles.privacyDivided]}>
              <View style={styles.privacyCopy}>
                <Text style={styles.privacyLabel}>{t('Hide my amount on the card')}</Text>
                <Text style={styles.privacyNote}>{t('Days, since and one-of stay; the position line goes.')}</Text>
              </View>
              <Switch value={hideAmount} onValueChange={(value) => { void Haptics.selectionAsync(); setHideAmount(value); }} trackColor={{ true: colors.accentDim, false: colors.line }} thumbColor={hideAmount ? colors.accent : colors.faint} />
            </View>
            {hideName && !hideAmount ? <Text style={styles.privacyWarn}>{t('An exact amount next to a start date is close to a fingerprint. Your choice, said plainly.')}</Text> : null}
          </Panel>

          <Button
            label={sharing ? t('Drawing your card…') : t('Share your card')}
            onPress={() => void shareCard()}
            disabled={sharing || busy}
            tone={colors.metal}
          />

          <View style={styles.actions}>
            <Button fill label={alertStatus ? t('Alerts armed') : t('Wake me at unlock')} onPress={() => void enableAlerts()} disabled={busy || !nextUnlock} ghost />
            <Button fill label={t('Refresh')} onPress={() => void inspect(address)} disabled={busy} ghost />
            <Button fill label={t('Disconnect')} onPress={() => void disconnect()} ghost />
          </View>
          {shareNote ? <Text style={styles.status}>{shareNote}</Text> : null}
          {alertStatus ? <Text style={styles.status}>{alertStatus}</Text> : null}

          <Evidence
            lines={[
              `read       ${readAt ? `${Math.max(0, now - readAt)}s ago · re-read every minute` : 'pending'}`,
              `wallet     ${profile!.wallet}`,
              `name       ${profile?.name ? `${profile.name}.skr · from the .skr registry` : walletLabel ? `${walletLabel} · from the wallet` : 'no .skr name on this wallet'}`,
              `accuracy   ${profile!.provenance.accuracy} · ${profile!.provenance.commitment}`,
              `age proof  ${age?.signature ? `${shortAddress(age.signature)} · ${age.exact ? 'first signature' : 'oldest seen so far'}` : ageError ? ageError : 'pending'}`,
              `tier rule  share of active stake, nothing else`,
            ]}
          />
        </>
      ) : (
        <>
          <Text style={styles.lead}>
            {profile && !profile.found
              ? connected ? t('This wallet holds no SKR position yet. The first stake opens one; the position account costs a little rent once.') : t('This address holds no SKR position right now.')
              : t('Connect the wallet that holds your stake, or paste any public address. Nothing is signed.')}
          </Text>
          {profile && !profile.found && connected
            ? <Button label={t('Stake SKR')} onPress={() => { void Haptics.selectionAsync(); setSixteen(false); setStaking(true); }} />
            : <Button label={t('Connect Solana Mobile')} onPress={() => void connect()} disabled={busy} />}
          <View style={styles.orRow}>
            <View style={styles.orLine} />
            <Text style={styles.or}>{t('OR')}</Text>
            <View style={styles.orLine} />
          </View>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('Paste a Solana address')}
            placeholderTextColor={colors.faint}
            value={address}
            onChangeText={setAddress}
            style={styles.input}
          />
          <Button label={t('Look up')} onPress={() => { setWalletLabel(null); setConnected(false); void inspect(address); }} disabled={busy || !address.trim()} ghost />
        </>
      )}

      {busy ? <ActivityIndicator color={colors.accent} style={styles.spinner} /> : null}
      {error ? <Pressable onPress={() => setError(null)}><Text style={styles.error}>{error}</Text></Pressable> : null}
    </ScrollView>
    {/* Outside the scroll view: the sheet used to be absolute inside the
        content, so opening it from the daily-sixteen button, far down the
        page, showed its empty lower half and nothing else. */}
    {staking && profile ? <StakeSheet wallet={profile.wallet} hasPosition={profile.positions.length > 0} presetAmount={sixteen ? '1' : undefined} presetSplit={sixteen ? 16 : undefined} onClose={() => { setStaking(false); void inspect(profile.wallet); }} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 130, gap: spacing.lg },
  card: { backgroundColor: colors.panelHi, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: spacing.lg, overflow: 'hidden' },
  cardClaimed: { borderColor: colors.metalDim },
  cardEdge: { position: 'absolute', left: 0, right: 0, top: 0, height: 2, backgroundColor: colors.metal, opacity: 0.55 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardBrand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardBrandText: { color: colors.muted, fontFamily: font.monoBold, ...type.eyebrow, textTransform: 'uppercase' },
  cardName: { color: colors.text, fontFamily: font.monoSemibold, fontSize: 15, letterSpacing: 0.4, marginTop: spacing.lg },
  cardAmountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: spacing.xs },
  cardAmount: { color: colors.text, fontFamily: font.black, fontVariant: ['tabular-nums'], fontSize: 38, lineHeight: 44, letterSpacing: -1.6 },
  cardUnit: { color: colors.muted, fontFamily: font.semibold, fontSize: 13 },
  cardEmpty: { color: colors.faint, fontFamily: font.regular, fontSize: 15, lineHeight: 44, marginTop: spacing.xs },
  cardStats: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing.lg },
  cardStat: { gap: 3 },
  cardStatLabel: { color: colors.faint, fontFamily: font.monoBold, fontSize: 9, letterSpacing: 1.3 },
  cardStatValue: { color: colors.text, fontFamily: font.monoSemibold, fontSize: 14, fontVariant: ['tabular-nums'] },
  cardStatAccent: { color: colors.metal },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line },
  cardFooterText: { color: colors.faint, fontFamily: font.mono, fontSize: 10 },
  tiles: { flexDirection: 'row', gap: spacing.md },
  dailyPanel: { padding: spacing.md },
  dailyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dailyCopy: { flex: 1, gap: 4 },
  dailyNote: { color: colors.muted, fontFamily: font.regular, ...type.small },
  privacyPanel: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  privacyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  privacyDivided: { borderTopWidth: 1, borderTopColor: colors.line },
  privacyCopy: { flex: 1, gap: 3 },
  privacyLabel: { color: colors.text, fontFamily: font.semibold, fontSize: 14 },
  privacyNote: { color: colors.muted, fontFamily: font.regular, ...type.small },
  privacyWarn: { color: colors.pending, fontFamily: font.regular, ...type.small, paddingBottom: spacing.md },
  sharePanel: { padding: spacing.md },
  shareHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  shareLabel: { flexShrink: 1 },
  shareValue: { color: colors.metal, fontFamily: font.bold, fontSize: 15, fontVariant: ['tabular-nums'] },
  shareMeter: { marginTop: spacing.md },
  shareNote: { color: colors.muted, fontFamily: font.regular, ...type.small, marginTop: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  status: { color: colors.positive, fontFamily: font.medium, ...type.small },
  lead: { color: colors.muted, fontFamily: font.regular, ...type.body },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  orLine: { flex: 1, height: 1, backgroundColor: colors.line },
  or: { color: colors.muted, fontFamily: font.semibold, fontSize: 11, letterSpacing: 1 },
  input: { minHeight: 50, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.inner, paddingHorizontal: spacing.lg, color: colors.text, backgroundColor: colors.panel, fontFamily: font.mono, fontSize: 13 },
  spinner: { marginTop: spacing.sm },
  error: { color: colors.negative, fontFamily: font.medium, ...type.small },
});
