import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { resolveAlertThresholds } from '../alertThresholds';
import { fetchEcosystemState, fetchWalletProfile } from '../api';
import { compact } from '../format';
import { clearStoredSchedule, hasUnlockAlerts, scheduleNotificationProof, scheduleUnlockAlerts } from '../notifications';
import { usePref } from '../prefs';
import { readSessionAddress } from '../session';
import { colors, font, spacing, type } from '../theme';
import type { EcosystemState, WalletProfile } from '../types';
import { Button, Evidence, Eyebrow, Hairline, Panel } from './kit';

export function AlertsLab() {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [state, setState] = useState<EcosystemState | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // The one alert that exists, and the truth about whether it is armed — read
  // from the schedule itself, never from a remembered intention.
  const [profile, setProfile] = useState<WalletProfile | null>(null);
  const [armed, setArmed] = useState<boolean | null>(null);
  const [arming, setArming] = useState(false);
  const [largeAlerts, setLargeAlerts] = usePref('alert:large', true);

  useEffect(() => {
    Notifications.getPermissionsAsync().then((result) => setGranted(result.granted)).catch(() => setGranted(null));
    fetchEcosystemState().then(setState).catch(() => undefined);
    void readSessionAddress().then(async (address) => {
      if (!address) return setArmed(false);
      setArmed(await hasUnlockAlerts(address));
      await fetchWalletProfile(address).then(setProfile).catch(() => undefined);
    }).catch(() => setArmed(false));
  }, []);

  const ask = useCallback(async () => {
    const result = await Notifications.requestPermissionsAsync();
    setGranted(result.granted);
    setStatus(result.granted ? 'This phone can now wake you.' : 'Android is holding notifications back for this app.');
  }, []);

  const toggleUnlock = useCallback(async (next: boolean) => {
    if (!profile) return;
    setArming(true);
    setStatus(null);
    void Haptics.selectionAsync();
    try {
      if (next) {
        const count = await scheduleUnlockAlerts(profile);
        setArmed(true);
        setStatus(`${count} reminder${count === 1 ? '' : 's'} set on this phone for your unlock.`);
      } else {
        await clearStoredSchedule(profile.wallet);
        setArmed(false);
        setStatus('The reminders for your unlock were cancelled.');
      }
    } catch (caught) {
      setArmed(await hasUnlockAlerts(profile.wallet).catch(() => false));
      setStatus(caught instanceof Error ? caught.message : 'The alert could not be changed.');
    } finally {
      setArming(false);
    }
  }, [profile]);

  const proof = useCallback(async () => {
    try {
      await scheduleNotificationProof();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStatus('A test notification will arrive in a few seconds.');
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : 'The test notification could not be scheduled');
    }
  }, []);

  const { config, fallback } = resolveAlertThresholds(state);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Panel style={styles.panel}>
        <View style={styles.permissionHead}>
          <View style={styles.permissionCopy}>
            <Eyebrow tone={granted ? colors.positive : colors.pending}>{granted ? 'Notifications allowed' : 'Notifications off'}</Eyebrow>
            <Text style={styles.permissionText}>
              {granted ? 'Alerts are scheduled on the phone itself. Nothing about you leaves the device.' : 'Allow notifications and this app can wake you exactly when your cooldown ends.'}
            </Text>
          </View>
        </View>
        {!granted ? <View style={styles.permissionAction}><Button label="Allow notifications" onPress={() => void ask()} /></View> : null}
      </Panel>

      <Panel style={styles.panel}>
        <View style={styles.toggleRow}>
          <View style={styles.toggleCopy}>
            <Text style={styles.toggleLabel}>Wake me at my unlock</Text>
            <Text style={styles.toggleNote}>
              {!profile
                ? 'Connect your wallet on the Me screen and this switch becomes live.'
                : profile.nextUnlockAt
                  ? 'One hour before, and again the moment the cooldown ends. Scheduled by this phone from the exact on-chain time.'
                  : 'Nothing of yours is unlocking, so there is nothing to wake you for yet.'}
            </Text>
          </View>
          {arming
            ? <ActivityIndicator color={colors.accent} />
            : (
              <Switch
                value={armed === true}
                disabled={!profile || !profile.nextUnlockAt}
                onValueChange={(value) => void toggleUnlock(value)}
                trackColor={{ true: colors.accentDim, false: colors.line }}
                thumbColor={armed ? colors.accent : colors.faint}
              />
            )}
        </View>
        <Hairline />
        <View style={styles.toggleRow}>
          <View style={styles.toggleCopy}>
            <Text style={styles.toggleLabel}>Large moves while you were away</Text>
            <Text style={styles.toggleNote}>
              Anything above the threshold below is summed up at the top of Flow when you come
              back to it, and lands with a chime and a buzz while you are watching.
            </Text>
          </View>
          <Switch
            value={largeAlerts}
            onValueChange={(value) => { void Haptics.selectionAsync(); setLargeAlerts(value); }}
            trackColor={{ true: colors.accentDim, false: colors.line }}
            thumbColor={largeAlerts ? colors.accent : colors.faint}
          />
        </View>
        <Hairline />
        <Text style={[styles.toggleNote, styles.spaced]}>
          Waking the phone for someone else's large move while the app is closed needs a
          background check that Android schedules on its own terms. That is the next version —
          promising it here before it exists would be the same lie this screen just removed.
        </Text>
      </Panel>

      <Panel style={styles.panel}>
        <Eyebrow>What counts as large in Flow</Eyebrow>
        <View style={styles.thresholds}>
          {(['stake', 'unstake', 'withdraw'] as const).map((event) => (
            <View key={event} style={styles.thresholdRow}>
              <Text style={styles.thresholdLabel}>{event}</Text>
              <Text style={styles.thresholdValue}>{compact(config.events[event].standard)}</Text>
              <Text style={styles.thresholdCritical}>{compact(config.events[event].critical)}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.thresholdNote}>
          {fallback ? 'Built-in thresholds, used by the chime and the buzz on the Flow screen, until the server publishes its own.' : 'These come from the server, move with real traffic, and drive the chime and the buzz on the Flow screen.'}
        </Text>
      </Panel>

      <Button label="Send a test notification" onPress={() => void proof()} ghost />
      {status ? <Text style={styles.status}>{status}</Text> : null}

      <Evidence
        lines={[
          `threshold source  ${config.source}`,
          'delivery          the phone wakes itself at the exact unlock time',
          'privacy           no address sent for alerts, no push server',
        ]}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 130, gap: spacing.lg },
  panel: { padding: spacing.md },
  permissionHead: { flexDirection: 'row', gap: spacing.md },
  permissionCopy: { flex: 1, gap: spacing.sm },
  permissionText: { color: colors.muted, fontFamily: font.regular, ...type.body },
  permissionAction: { marginTop: spacing.md },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  toggleCopy: { flex: 1, gap: 3 },
  toggleLabel: { color: colors.text, fontFamily: font.semibold, fontSize: 14 },
  toggleNote: { color: colors.muted, fontFamily: font.regular, ...type.small },
  thresholds: { marginTop: spacing.md, gap: spacing.sm },
  thresholdRow: { flexDirection: 'row', alignItems: 'center' },
  thresholdLabel: { flex: 1, color: colors.muted, fontFamily: font.semibold, ...type.small, textTransform: 'uppercase' },
  thresholdValue: { width: 78, textAlign: 'right', color: colors.text, fontFamily: font.semibold, ...type.small },
  thresholdCritical: { width: 78, textAlign: 'right', color: colors.pending, fontFamily: font.semibold, ...type.small },
  spaced: { marginTop: spacing.md },
  thresholdNote: { color: colors.faint, fontFamily: font.regular, ...type.small, marginTop: spacing.md },
  status: { color: colors.positive, fontFamily: font.medium, ...type.small },
});
