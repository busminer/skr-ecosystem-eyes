import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { resolveAlertThresholds } from '../alertThresholds';
import { fetchEcosystemState, fetchWalletProfile } from '../api';
import { LANGS, LANG_LABEL, lang, setLang, t, useLang, type Lang } from '../i18n';
import { compact } from '../format';
import { scheduleDailyNudge, clearStoredSchedule, hasUnlockAlerts, scheduleNotificationProof, scheduleUnlockAlerts } from '../notifications';
import { usePref } from '../prefs';
import { readSessionAddress } from '../session';
import { colors, font, numeric, radius, spacing, type } from '../theme';
import type { EcosystemState, WalletProfile } from '../types';
import { Button, Chevron, Evidence, Eyebrow, Hairline, Inset, Panel, RangeSwitch } from './kit';
import { TipSheet } from './TipSheet';

// A setting is a name and a control. The sentence that explains it is worth
// keeping and is not worth carrying down the screen forever.
//
// This panel used to be four of these rows in a column, each one a label, a
// three-line paragraph and a switch, and the paragraphs came to more of the
// screen than the settings did. Nobody reads the same explanation twice; they
// read it once, decide, and from then on they are looking for the switch. So
// the words go behind the name, and the chevron says they are still there.
//
// `open` is forced on when the control is dead: a switch you cannot move has
// to say why without being asked.
function Setting({ label, note, open, onPeek, control }: { label: string; note?: ReactNode; open?: boolean; onPeek?: () => void; control: ReactNode }) {
  return (
    <View>
      <View style={styles.settingRow}>
        <Pressable
          accessibilityRole={note ? 'button' : undefined}
          accessibilityState={note ? { expanded: open === true } : undefined}
          disabled={!note || !onPeek}
          onPress={onPeek}
          style={({ pressed }) => [styles.settingName, pressed && styles.pressed]}
        >
          <Text style={styles.settingLabel}>{label}</Text>
          {note ? <Chevron open={open} /> : null}
        </Pressable>
        {control}
      </View>
      {note && open ? <Inset style={styles.note}>{typeof note === 'string' ? <Text style={styles.noteText}>{note}</Text> : note}</Inset> : null}
    </View>
  );
}

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
  const [nudge, setNudge] = usePref('nudge:daily', true);
  // The opening: the turn from 1.0, back by request, or the first stone from 1.1.
  const [splashTurn, setSplashTurn] = usePref('splash:turn', true);
  const [tipping, setTipping] = useState(false);
  // One disclosure open at a time. Two paragraphs unfolded at once is the
  // screen we are leaving behind.
  const [peek, setPeek] = useState<string | null>(null);
  const [langsOpen, setLangsOpen] = useState(false);

  const toggle = useCallback((key: string) => {
    void Haptics.selectionAsync();
    setPeek((current) => (current === key ? null : key));
  }, []);

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
  const canArm = Boolean(profile && profile.nextUnlockAt);

  return (
    <View style={styles.screen}>
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* The one panel on this screen allowed to raise its hand, and only
          while the phone is refusing to wake anybody. Once it is allowed that
          is a settled fact, and a settled fact goes quiet. */}
      <Panel style={styles.panel} tone={granted === false ? colors.pending : undefined}>
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

      {/* Three switches, one column, one width. The opening moved out: it is a
          choice about the app, not about being woken, and its wide two-way
          control was the thing breaking the column. */}
      <Panel style={styles.panel}>
        <Setting
          label={t('Wake me at my unlock')}
          open={peek === 'unlock' || !canArm}
          onPeek={() => toggle('unlock')}
          note={(
            <View style={styles.noteStack}>
              <Text style={styles.noteText}>
                {!profile
                  ? t('Connect your wallet on the Me screen and this switch becomes live.')
                  : profile.nextUnlockAt
                    ? t('One hour before, and again the moment the cooldown ends. Scheduled by this phone from the exact on-chain time.')
                    : t('Nothing of yours is unlocking, so there is nothing to wake you for yet.')}
              </Text>
              {/* This used to hang at the bottom of the panel with no heading
                  and no control beside it, reading like a setting somebody
                  forgot to finish. It belongs to this switch, because this
                  switch is the only thing in the app that wakes the phone. */}
              <Text style={styles.noteText}>
                {t("Other people's moves do not wake the phone while the app is closed. Only your own unlock does.")}
              </Text>
            </View>
          )}
          control={arming
            ? <ActivityIndicator color={colors.accent} />
            : (
              <Switch
                value={armed === true}
                disabled={!canArm}
                onValueChange={(value) => void toggleUnlock(value)}
                trackColor={{ true: colors.accentDim, false: colors.line }}
                thumbColor={armed ? colors.accent : colors.faint}
              />
            )}
        />
        <Hairline />
        <Setting
          label={t('Large moves, heard and felt')}
          open={peek === 'large'}
          onPeek={() => toggle('large')}
          note={t('From 100K SKR only: a stake arrives on a rising note, an exit on a low tone that bends down, a withdrawal on a short fall. On every screen while the app is open, each with a short buzz.')}
          control={(
            <Switch
              value={largeAlerts}
              onValueChange={(value) => { void Haptics.selectionAsync(); setLargeAlerts(value); }}
              trackColor={{ true: colors.accentDim, false: colors.line }}
              thumbColor={largeAlerts ? colors.accent : colors.faint}
            />
          )}
        />
        <Hairline />
        <Setting
          label={t('A daily look in')}
          open={peek === 'nudge'}
          onPeek={() => toggle('nudge')}
          note={t('Once a day, around six in the evening, one line about the vault, a different one each day. It never asks you to stake. Set on the phone itself, nothing is sent anywhere.')}
          control={(
            <Switch
              value={nudge}
              onValueChange={(value) => { void Haptics.selectionAsync(); setNudge(value); void scheduleDailyNudge(value); }}
              trackColor={{ true: colors.accentDim, false: colors.line }}
              thumbColor={nudge ? colors.accent : colors.faint}
            />
          )}
        />
      </Panel>

      {/* Two columns of exactly 78 points used to hold these numbers, which is
          fine until somebody turns the system text up and the second column
          walks off the edge. Now they are recessed rows that can breathe, and
          the figures are tabular, so three rows line up the way a table
          should. */}
      <Panel style={styles.panel}>
        <Eyebrow>{t('What counts as large')}</Eyebrow>
        <View style={styles.thresholds}>
          {(['stake', 'unstake', 'withdraw'] as const).map((event) => (
            <Inset key={event} style={styles.thresholdRow}>
              <Text numberOfLines={1} style={styles.thresholdLabel}>{t(event)}</Text>
              <View style={styles.thresholdFigures}>
                <Text style={styles.thresholdValue}>{compact(config.events[event].standard)}</Text>
                <Text style={styles.thresholdCritical}>{compact(config.events[event].critical)}</Text>
              </View>
            </Inset>
          ))}
        </View>
        <Text style={styles.thresholdNote}>
          {fallback ? t('Built-in thresholds behind the bell and the boom, until the server publishes its own.') : t('These come from the server, move with real traffic, and drive the bell and the boom.')}
        </Text>
      </Panel>

      {/* Two choices about the app itself. The language used to be a wrapped
          field of up to ten identical pills — the densest run of buttons in
          the app — standing open for a decision made once. Now the row says
          which one is on, and opens when it is asked to. */}
      <Panel style={styles.panel}>
        <Setting
          label={t('Opening')}
          open={peek === 'opening'}
          onPeek={() => toggle('opening')}
          note={splashTurn ? t('The phone turns and the eye blinks, the opening from 1.0.') : t('One phone falls into the dark and the eye opens over the pile, the opening from 1.1.')}
          control={<RangeSwitch value={splashTurn ? 'turn' : 'stone'} options={['turn', 'stone']} label={(option) => option === 'turn' ? t('Turn') : t('First stone')} onChange={(next) => { void Haptics.selectionAsync(); setSplashTurn(next === 'turn'); }} />}
        />
        <Hairline />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: langsOpen }}
          onPress={() => { void Haptics.selectionAsync(); setLangsOpen((open) => !open); }}
          style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}
        >
          <Text style={styles.settingLabel}>{t('Language')}</Text>
          <View style={styles.langNow}>
            <Text style={styles.langNowText}>{LANG_LABEL[language]}</Text>
            <Chevron open={langsOpen} />
          </View>
        </Pressable>
        {langsOpen ? (
          <View style={styles.langBlock}>
            <Inset style={styles.note}>
              <Text style={styles.noteText}>
                {t('The app follows your phone until you choose here. The card you share stays in English, so it reads the same to everyone who sees it.')}
              </Text>
            </Inset>
            {/* Each language is written in its own script. Somebody looking for
                their language looks for the shape of their own writing, not for
                the English word for it. */}
            <View style={styles.langs}>
              {LANGS.map((option) => {
                const on = option === language;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    key={option}
                    onPress={() => { void Haptics.selectionAsync(); setLang(option); }}
                    style={({ pressed }) => [styles.lang, on && styles.langOn, pressed && styles.langPressed]}
                  >
                    <Text style={[styles.langText, on && styles.langTextOn]}>{LANG_LABEL[option]}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </Panel>

      {/* The status line used to appear out of nowhere and shove everything
          under it down the screen. The room for it is now always there. */}
      <View style={styles.proof}>
        <Button label={t('Send a test notification')} onPress={() => void proof()} quiet />
        <View style={styles.statusSlot}>{status ? <Text style={styles.status}>{status}</Text> : null}</View>
      </View>

      {/* Quiet, at the bottom, after everything that matters: a way to say
          thank you in SKR. Not a fee, not a nag, and it says where the tip
          goes and what happens to it. */}
      <Panel style={styles.panel} tone={colors.metal}>
        <View style={styles.tipRow}>
          <View style={styles.tipCopy}>
            <Eyebrow tone={colors.metal}>{t('Support SKR Eyes')}</Eyebrow>
            <Text style={styles.noteText}>{t('Free and open source, built by one Seeker. Tips go straight to kosa.skr.')}</Text>
          </View>
          <Button label={t('Send a tip')} tone={colors.metal} onPress={() => { void Haptics.selectionAsync(); setTipping(true); }} />
        </View>
      </Panel>

      <Evidence
        lines={[
          `threshold source  ${config.source}`,
          'delivery          the phone wakes itself at the exact unlock time',
          'privacy           no address sent for alerts, no push server',
        ]}
      />
    </ScrollView>
    {/* Outside the scroll view on purpose: a sheet inside it would sit at the
        top of the content and scroll away with it, leaving a blank screen. */}
    {tipping ? <TipSheet onClose={() => setTipping(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 130, gap: spacing.lg },
  panel: { padding: spacing.md },
  pressed: { opacity: 0.6 },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  tipCopy: { flex: 1, gap: 4 },
  permissionHead: { flexDirection: 'row', gap: spacing.md },
  permissionCopy: { flex: 1, gap: spacing.sm },
  permissionText: { color: colors.muted, fontFamily: font.regular, ...type.body },
  permissionAction: { marginTop: spacing.md },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, minHeight: 56 },
  settingName: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  settingLabel: { flexShrink: 1, color: colors.text, fontFamily: font.semibold, fontSize: 14 },
  note: { marginBottom: spacing.md },
  noteStack: { gap: spacing.sm },
  noteText: { color: colors.muted, fontFamily: font.regular, ...type.small },
  thresholds: { marginTop: spacing.md, gap: 5 },
  thresholdRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 9 },
  thresholdLabel: { flexShrink: 1, color: colors.muted, fontFamily: font.semibold, ...type.small, textTransform: 'uppercase', letterSpacing: 0.6 },
  thresholdFigures: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.lg, marginLeft: 'auto' },
  thresholdValue: { minWidth: 54, textAlign: 'right', color: colors.text, fontFamily: font.monoSemibold, ...type.small, ...numeric },
  thresholdCritical: { minWidth: 54, textAlign: 'right', color: colors.pending, fontFamily: font.monoSemibold, ...type.small, ...numeric },
  thresholdNote: { color: colors.faint, fontFamily: font.regular, ...type.small, marginTop: spacing.md },
  proof: { alignItems: 'flex-start', gap: spacing.xs },
  statusSlot: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.sm },
  status: { color: colors.positive, fontFamily: font.medium, ...type.small },
  langNow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  langNowText: { color: colors.accent, fontFamily: font.semibold, fontSize: 13 },
  langBlock: { gap: spacing.md, paddingBottom: spacing.sm },
  langs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  lang: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  langOn: { borderColor: colors.accent, backgroundColor: colors.accentWash },
  langPressed: { opacity: 0.7 },
  langText: { color: colors.muted, fontFamily: font.semibold, fontSize: 13 },
  langTextOn: { color: colors.accent },
});
