import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, fetchEcosystemState, fetchWalletProfile } from '../api';
import { compact, integer, shortAddress } from '../format';
import { connectReadOnlyWallet } from '../mwa';
import { clearStoredSchedule, scheduleUnlockAlerts } from '../notifications';
import { SESSION_KEY } from '../session';
import { colors, font, radius, spacing, type } from '../theme';
import type { WalletProfile } from '../types';
import { fetchWalletAge, type PositionAge } from './age';
import { forgetStakeRun } from './stake/useStakeRun';
import { Button, Evidence, Eyebrow, Meter, Panel, Tile } from './kit';
import { StakerCard, cardFacts } from './StakerCard';
import { CardExporter, shareCardPng } from './shareCard';
import type { CardHandle } from './cardArt';
import { StakeSheet } from './stake/StakeSheet';

// The card is the reason to open the app daily, so the phone remembers who
// you are. Only the public address and the name the wallet gave us are stored.

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
  const [profile, setProfile] = useState<WalletProfile | null>(null);
  const [age, setAge] = useState<PositionAge | null>(null);
  const [ageError, setAgeError] = useState<string | null>(null);
  const [networkStake, setNetworkStake] = useState<number | null>(null);
  const [networkPositions, setNetworkPositions] = useState<number | null>(null);
  const [sharing, setSharing] = useState(false);
  const cardArt = useRef<CardHandle>(null);
  const [busy, setBusy] = useState(false);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alertStatus, setAlertStatus] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1_000));
  const [staking, setStaking] = useState(false);

  useEffect(() => {
    fetchEcosystemState().then((state) => {
      setNetworkStake(state.metrics?.activeStaked ?? null);
      setNetworkPositions(state.metrics?.totalPositions ?? null);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(SESSION_KEY).then((raw) => {
      if (cancelled || !raw) return;
      try {
        const saved = JSON.parse(raw) as { address?: string; label?: string };
        if (saved.label) setWalletLabel(saved.label);
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
    setAge(null);
    try {
      const next = await fetchWalletProfile(clean);
      setAddress(clean);
      setProfile(next);
      setReadAt(Math.floor(Date.now() / 1_000));
      void AsyncStorage.mergeItem(SESSION_KEY, JSON.stringify({ address: clean })).catch(() => AsyncStorage.setItem(SESSION_KEY, JSON.stringify({ address: clean })).catch(() => undefined));
      const accounts = next.positions.map((position) => position.stakeAccount).filter(Boolean);
      setAgeError(null);
      void fetchWalletAge(accounts, (partial) => setAge((current) => current?.exact ? current : partial))
        .then((final) => { if (final) setAge(final); else setAgeError('the chain returned no signatures'); })
        .catch((caught) => setAgeError(caught instanceof Error ? caught.message : 'age lookup failed'));
    } catch (caught) {
      if (quiet) return;
      setProfile(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (caught instanceof ApiError && caught.status === 503) setError('The finalized snapshot is still warming up. Try again in a moment.');
      else setError(caught instanceof Error ? caught.message : 'This position could not be read');
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
      void AsyncStorage.setItem(SESSION_KEY, JSON.stringify({ address: account.address, label: account.label ?? null })).catch(() => undefined);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await inspect(account.address);
    } catch (caught) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(caught instanceof Error ? caught.message : 'The wallet request was cancelled');
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
      setAlertStatus(count ? `${count} unlock alert${count === 1 ? '' : 's'} armed on this phone.` : 'Nothing left to wait for — the cooldown is already over.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Alerts could not be scheduled');
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
    try {
      void Haptics.selectionAsync();
      const png = await cardArt.current?.toPng();
      if (!png) throw new Error('The card is not ready yet');
      await shareCardPng(png);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The card could not be drawn');
    } finally {
      setSharing(false);
    }
  }, [age, networkPositions, profile, walletLabel]);

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
    const previous = profile?.wallet ?? address;
    await AsyncStorage.removeItem(SESSION_KEY).catch(() => undefined);
    await forgetStakeRun().catch(() => undefined);
    if (previous) await clearStoredSchedule(previous).catch(() => undefined);
    setProfile(null);
    setAge(null);
    setWalletLabel(null);
    setAddress('');
    setAlertStatus(null);
  }, [address, profile]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <StakerCard
        profile={profile}
        age={age}
        share={share}
        claimed={claimed}
        name={walletLabel}
        networkPositions={networkPositions}
        width={width - spacing.lg * 2}
      />

      {profile ? <CardExporter ref={cardArt} facts={cardFacts(profile, age, walletLabel, networkPositions)} /> : null}

      {claimed ? (
        <>
          <View style={styles.tiles}>
            <Tile
              label="Leaving"
              value={compact(profile!.totals.pendingUnstake)}
              unit="SKR"
              note={`${integer(profile!.totals.pendingPositions)} position(s) in cooldown`}
              tone={colors.pending}
            />
            <Tile
              label={profile!.totals.withdrawable > 0 ? 'Ready now' : 'Next unlock'}
              value={profile!.totals.withdrawable > 0 ? compact(profile!.totals.withdrawable) : nextUnlock ? countdown(nextUnlock - now) : '—'}
              unit={profile!.totals.withdrawable > 0 ? 'SKR' : undefined}
              note={profile!.totals.withdrawable > 0 ? 'Cooldown finished' : nextUnlock ? 'Until this position is free' : 'Nothing queued'}
              tone={profile!.totals.withdrawable > 0 ? colors.positive : colors.accent}
            />
          </View>

          <Panel style={styles.sharePanel}>
            <View style={styles.shareHead}>
              <View style={styles.shareLabel}><Eyebrow>Your weight in the vault</Eyebrow></View>
              <Text style={styles.shareValue}>{share != null ? `${share.toFixed(5)}%` : '—'}</Text>
            </View>
            <View style={styles.shareMeter}>
              <Meter percent={share != null ? Math.min(100, share * 100) : 0} tone={colors.metal} height={4} />
            </View>
            <Text style={styles.shareNote}>
              {age?.days != null
                ? age.exact
                  ? `First stake ${age.days} days ago, read from the oldest signature on your position account.`
                  : `Held at least ${age.days} days. Your position has a long signature history, so the walk back is still going.`
                : 'Reading the age of your position from the chain…'}
            </Text>
          </Panel>

          <Button label="Stake SKR" onPress={() => { void Haptics.selectionAsync(); setStaking(true); }} />
          <Button
            label={sharing ? 'Drawing your card…' : 'Share your card'}
            onPress={() => void shareCard()}
            disabled={sharing || busy}
            tone={colors.metal}
          />

          <View style={styles.actions}>
            <Button fill label={alertStatus ? 'Alerts armed' : 'Wake me at unlock'} onPress={() => void enableAlerts()} disabled={busy || !nextUnlock} ghost />
            <Button fill label="Refresh" onPress={() => void inspect(address)} disabled={busy} ghost />
            <Button fill label="Disconnect" onPress={() => void disconnect()} ghost />
          </View>
          {alertStatus ? <Text style={styles.status}>{alertStatus}</Text> : null}

          <Evidence
            lines={[
              `read       ${readAt ? `${Math.max(0, now - readAt)}s ago · re-read every minute` : 'pending'}`,
              `wallet     ${profile!.wallet}`,
              `name       ${walletLabel ? `${walletLabel} · from the wallet` : 'the wallet returned no name'}`,
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
              ? 'This address holds no SKR position right now.'
              : 'Connect the wallet that holds your stake, or paste any public address. Nothing is signed.'}
          </Text>
          <Button label="Connect Solana Mobile" onPress={() => void connect()} disabled={busy} />
          <View style={styles.orRow}>
            <View style={styles.orLine} />
            <Text style={styles.or}>OR</Text>
            <View style={styles.orLine} />
          </View>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Paste a Solana address"
            placeholderTextColor={colors.faint}
            value={address}
            onChangeText={setAddress}
            style={styles.input}
          />
          <Button label="Look up" onPress={() => void inspect(address)} disabled={busy || !address.trim()} ghost />
        </>
      )}

      {staking && profile ? <StakeSheet wallet={profile.wallet} hasPosition={profile.positions.length > 0} onClose={() => { setStaking(false); void inspect(profile.wallet); }} /> : null}
      {busy ? <ActivityIndicator color={colors.accent} style={styles.spinner} /> : null}
      {error ? <Pressable onPress={() => setError(null)}><Text style={styles.error}>{error}</Text></Pressable> : null}
    </ScrollView>
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
