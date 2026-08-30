import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { resolveAlertThresholds } from '../alertThresholds';
import { fetchEcosystemState, fetchWalletProfile } from '../api';
import { LANGS, LANG_LABEL, lang, setLang, t, useLang, type Lang } from '../i18n';
import { compact } from '../format';
import { clearStoredSchedule, hasUnlockAlerts, scheduleNotificationProof, scheduleUnlockAlerts } from '../notifications';
import { usePref } from '../prefs';
import { readSessionAddress } from '../session';
import { colors, font, spacing, type } from '../theme';
import type { EcosystemState, WalletProfile } from '../types';
import { Button, Evidence, Eyebrow, Hairline, Panel, RangeSwitch } from './kit';

export function AlertsLab() {
  // The language switch lives here because this is the only settings screen the
  // app has. Reading it through the hook is what redraws every other screen the
  // moment it changes.
  const language = useLang();
  const [granted, setGranted] = useState<boolean | null>(null);
  // False once Android has refused for good and stopped showing its dialog.
  const [canAsk, setCanAsk] = useState(true);
  const [state, setState] = useState<EcosystemState | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // The one alert that exists, and the truth about whether it is armed — read
  // from the schedule itself, never from a remembered intention.
  const [profile, setProfile] = useState<WalletProfile | null>(null);
  const [armed, setArmed] = useState<boolean | null>(null);
  const [arming, setArming] = useState(false);
  const [largeAlerts, setLargeAlerts] = usePref('alert:large', true);

  useEffect(() => {
    Notifications.getPermissionsAsync().then((result) => {
      setGranted(result.granted);
      setCanAsk(result.canAskAgain !== false);
    }).catch(() => setGranted(null));
    fetchEcosystemState().then(setState).catch(() => undefined);
    void readSessionAddress().then(async (address) => {
      if (!address) return setArmed(false);
      setArmed(await hasUnlockAlerts(address));
      await fetchWalletProfile(address).then(setProfile).catch(() => undefined);
    }).catch(() => setArmed(false));
  }, []);

  // Android stops showing the dialog once it has been refused for good. Asking
  // again then does nothing at all, and a button that does nothing is worse
  // than no button: the only way back is the system settings, so offer that.
  const ask = useCallback(async () => {
    try {
      const result = await Notifications.requestPermissionsAsync();
      setGranted(result.granted);
      setCanAsk(result.canAskAgain !== false);
      setStatus(result.granted
        ? t('This phone can now wake you.')
        : result.canAskAgain === false
          ? t('Android will not ask again. Turn notifications on for SKR Eyes in the system settings.')
          : t('Android is holding notifications back for this app.'));
    } catch {
      setStatus(t('Android did not answer the permission request. Try again, or turn notifications on in the system settings.'));
    }
  }, []);

  const openSettings = useCallback(() => {
    void Linking.openSettings().catch(() => setStatus(t('This phone would not open its settings screen.')));
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
        setStatus(count === 1 ? t('1 reminder set on this phone for your unlock.') : t('{count} reminders set on this phone for your unlock.', { count }));
      } else {
        await clearStoredSchedule(profile.wallet);
        setArmed(false);
        setStatus(t('The reminders for your unlock were cancelled.'));
      }
    } catch (caught) {
      setArmed(await hasUnlockAlerts(profile.wallet).catch(() => false));
      setStatus(caught instanceof Error ? caught.message : t('The alert could not be changed.'));
    } finally {
      setArming(false);
    }
  }, [profile]);

  const proof = useCallback(async () => {
    try {
      await scheduleNotificationProof();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStatus(t('A test notification will arrive in a few seconds.'));
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : t('The test notification could not be scheduled'));
    }
  }, []);

  const { config, fallback } = resolveAlertThresholds(state);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Panel style={styles.panel}>
        <View style={styles.permissionHead}>
          <View style={styles.permissionCopy}>
            <Eyebrow tone={granted ? colors.positive : colors.pending}>{granted ? t('Notifications allowed') : t('Notifications off')}</Eyebrow>
            <Text style={styles.permissionText}>
              {granted ? t('Alerts are scheduled on the phone itself. Nothing about you leaves the device.') : t('Allow notifications and this app can wake you exactly when your cooldown ends.')}
            </Text>
          </View>
        </View>
        {!granted ? (
          <View style={styles.permissionAction}>
            {canAsk
              ? <Button label={t('Allow notifications')} onPress={() => void ask()} />
              : <Button label={t('Open settings')} onPress={openSettings} />}
          </View>
        ) : null}
      </Panel>

      <Panel style={styles.panel}>
        <View style={styles.toggleRow}>
          <View style={styles.toggleCopy}>
            <Text style={styles.toggleLabel}>{t('Wake me at my unlock')}</Text>
            <Text style={styles.toggleNote}>
              {!profile
                ? t('Connect your wallet on the Me screen and this switch becomes live.')
                : profile.nextUnlockAt
                  ? t('One hour before, and again the moment the cooldown ends. Scheduled by this phone from the exact on-chain time.')
                  : t('Nothing of yours is unlocking, so there is nothing to wake you for yet.')}
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
            <Text style={styles.toggleLabel}>{t('Large moves while you were away')}</Text>
            <Text style={styles.toggleNote}>
              {t('Anything above the threshold below is summed up at the top of Flow when you come back to it, and lands with a chime and a buzz while you are watching.')}
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
          {t("Waking the phone for someone else's large move while the app is closed needs a background check that Android schedules on its own terms. That is the next version — promising it here before it exists would be the same lie this screen just removed.")}
        </Text>
      </Panel>

      <Panel style={styles.panel}>
        <Eyebrow>{t('What counts as large in Flow')}</Eyebrow>
        <View style={styles.thresholds}>
          {(['stake', 'unstake', 'withdraw'] as const).map((event) => (
            <View key={event} style={styles.thresholdRow}>
              <Text style={styles.thresholdLabel}>{t(event)}</Text>
              <Text style={styles.thresholdValue}>{compact(config.events[event].standard)}</Text>
              <Text style={styles.thresholdCritical}>{compact(config.events[event].critical)}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.thresholdNote}>
          {fallback ? t('Built-in thresholds, used by the chime and the buzz on the Flow screen, until the server publishes its own.') : t('These come from the server, move with real traffic, and drive the chime and the buzz on the Flow screen.')}
        </Text>
      </Panel>

      <Panel style={styles.panel}>
        <View style={styles.toggleRow}>
          <View style={styles.toggleCopy}>
            <Text style={styles.toggleLabel}>{t('Language')}</Text>
            <Text style={styles.toggleNote}>
              {t('The app follows your phone until you choose here. The card you share stays in English, so it reads the same to everyone who sees it.')}
            </Text>
          </View>
          <RangeSwitch
            value={language}
            options={[...LANGS]}
            label={(option) => LANG_LABEL[option as Lang] ?? option}
            onChange={(next) => { void Haptics.selectionAsync(); setLang(next as Lang); }}
          />
        </View>
      </Panel>

      <Button label={t('Send a test notification')} onPress={() => void proof()} ghost />
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
