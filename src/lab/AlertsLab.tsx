import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { resolveAlertThresholds } from '../alertThresholds';
import { sampleCheckin, syncCheckins, useCheckinsPerDay } from '../checkins';
import { PER_DAY_OPTIONS, slotTimesLabel, type PerDay } from '../checkinPlan';
import { fetchEcosystemState } from '../api';
import { LANGS, LANG_LABEL, setLang, t, useLang } from '../i18n';
import { compact } from '../format';
import { usePref } from '../prefs';
import { colors, font, numeric, radius, spacing, type } from '../theme';
import type { EcosystemState } from '../types';
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
//
// `detail` is the instrument's own reading under the name ("09:00 · 19:30"),
// not an explanation. `stack` puts the control under the name instead of
// beside it: a four-way pill does not fit next to a label on a 360-wide
// phone, and wraps in Russian or Turkish at a large system font on any phone.
function Setting({ label, detail, note, open, onPeek, control, stack = false }: { label: string; detail?: string; note?: ReactNode; open?: boolean; onPeek?: () => void; control: ReactNode; stack?: boolean }) {
  return (
    <View>
      <View style={[styles.settingRow, stack && styles.settingStack]}>
        <Pressable
          accessibilityRole={note ? 'button' : undefined}
          accessibilityState={note ? { expanded: open === true } : undefined}
          disabled={!note || !onPeek}
          onPress={onPeek}
          style={({ pressed }) => [styles.settingName, stack && styles.settingNameStack, pressed && styles.pressed]}
        >
          <View style={styles.settingCopy}>
            <Text style={styles.settingLabel}>{label}</Text>
            {detail ? <Text style={styles.settingDetail}>{detail}</Text> : null}
          </View>
          {note ? <Chevron open={open} /> : null}
        </Pressable>
        {control}
      </View>
      {note && open ? <Inset style={styles.note}>{typeof note === 'string' ? <Text style={styles.noteText}>{note}</Text> : note}</Inset> : null}
    </View>
  );
}

// `embedded`: the tail of Me rather than a screen of its own. Then it is a
// run of panels inside Me's scroll view, and the tip sheet is Me's to show,
// over the whole screen, through `onTip`.
export function AlertsLab({ embedded = false, onTip }: { embedded?: boolean; onTip?: () => void } = {}) {
  // The language switch lives here because this is the only settings screen the
  // app has. Reading it through the hook is what redraws every other screen the
  // moment it changes.
  const language = useLang();
  const [granted, setGranted] = useState<boolean | null>(null);
  // False once Android has refused for good and stopped showing its dialog.
  const [canAsk, setCanAsk] = useState(true);
  const [state, setState] = useState<EcosystemState | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [largeAlerts, setLargeAlerts] = usePref('alert:large', true);
  // How many times a day the phone invites a look at the position.
  const [perDay, setPerDay] = useCheckinsPerDay();
  const [sample, setSample] = useState<string | null>(null);
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
    const read = () => {
      Notifications.getPermissionsAsync().then((result) => {
        setGranted(result.granted);
        setCanAsk(result.canAskAgain !== false);
        // Allowed in the system settings while we were away: plan the week
        // now, not on the next launch. The stamp makes a repeat call a no-op.
        if (result.granted) void syncCheckins();
      }).catch(() => setGranted(null));
    };
    read();
    fetchEcosystemState().then(setState).catch(() => undefined);
    const subscription = AppState.addEventListener('change', (next) => { if (next === 'active') read(); });
    return () => subscription.remove();
  }, []);

  // Android stops showing the dialog once it has been refused for good. Asking
  // again then does nothing at all, and a button that does nothing is worse
  // than no button: the only way back is the system settings, so offer that.
  const ask = useCallback(async () => {
    try {
      const result = await Notifications.requestPermissionsAsync();
      setGranted(result.granted);
      setCanAsk(result.canAskAgain !== false);
      if (result.granted) void syncCheckins();
      setStatus(result.granted
        ? t('This phone can now wake you.')
        : result.canAskAgain === false
          ? t('Android will not ask again. Turn notifications on for SKR Eyes in the system settings.')
          : t('Android is holding notifications back for this app.'));
    } catch {
      setStatus(t('Android did not answer the permission request. Try again, or turn notifications on in the system settings.'));
    }
  }, []);

  const showSample = useCallback(async () => {
    void Haptics.selectionAsync();
    const sent = await sampleCheckin();
    setSample(sent ? t('Coming in a few seconds.') : t('Android is holding notifications back for this app.'));
    setTimeout(() => setSample(null), 8_000);
  }, []);

  const openSettings = useCallback(() => {
    void Linking.openSettings().catch(() => setStatus(t('This phone would not open its settings screen.')));
  }, []);

  const { config, fallback } = resolveAlertThresholds(state);

  const body = (
    <>
      {/* One panel for the whole topic: how often the phone invites a look at
          the position, the hours it will do it, and, only while the phone is
          refusing, the permission standing in the way. Once allowed, that is a
          settled fact and lives folded in the note. The panel raises its hand
          only when the person wants check-ins and the phone will not deliver
          them. "Show me one" is a link, not a button beside a sentence: the two
          were the same grey and nothing said which one to touch. */}
      <Panel style={styles.panel} tone={granted === false && perDay > 0 ? colors.pending : undefined}>
        <Setting
          label={t('Position check-ins')}
          detail={perDay > 0 ? slotTimesLabel(perDay) : undefined}
          stack
          open={peek === 'checkins'}
          onPeek={() => toggle('checkins')}
          note={perDay > 0
            ? `${t('A short invitation to look at your position, at {times} in your own time zone. The words change through the week; none of them asks for a stake.', { times: slotTimesLabel(perDay) })} ${t('Check-ins are scheduled on the phone itself. Nothing about you leaves the device.')}`
            : t('No invitations. The app stays quiet unless you open it.')}
          control={(
            <RangeSwitch
              value={String(perDay)}
              options={PER_DAY_OPTIONS.map(String)}
              label={(option) => option === '0' ? t('Off') : option}
              onChange={(next) => { void Haptics.selectionAsync(); setPerDay(Number(next) as PerDay); }}
            />
          )}
        />
        {granted === false ? (
          <>
            <Hairline />
            <View style={styles.permission}>
              <Eyebrow tone={colors.pending}>{t('Notifications off')}</Eyebrow>
              <Text style={styles.noteText}>{t('Allow notifications and SKR Eyes can invite you to look at your position.')}</Text>
              {canAsk
                ? <Button label={t('Allow notifications')} onPress={() => void ask()} />
                : <Button label={t('Open settings')} onPress={openSettings} />}
            </View>
          </>
        ) : null}
        {granted && perDay > 0 ? (
          <>
            <Hairline />
            <Pressable accessibilityRole="button" disabled={sample != null} onPress={() => void showSample()} style={({ pressed }) => [styles.sampleRow, pressed && styles.pressed]}>
              <Text style={[styles.sampleLink, sample != null && styles.sampleSent]}>{sample ?? t('Show me one')}</Text>
            </Pressable>
          </>
        ) : null}
        {/* The answer to the permission button, under the button it answers. */}
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </Panel>

      {/* One switch, the sound of large moves while the app is open; nothing
          here wakes the phone about staking (29.09.2026). The opening moved out: it is a
          choice about the app, not about being woken, and its wide two-way
          control was the thing breaking the column. */}
      <Panel style={styles.panel}>
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

      {/* Quiet, at the bottom, after everything that matters: a way to say
          thank you in SKR. Not a fee, not a nag, and it says where the tip
          goes and what happens to it. */}
      <Panel style={styles.panel} tone={colors.metal}>
        <View style={styles.tipRow}>
          <View style={styles.tipCopy}>
            <Eyebrow tone={colors.metal}>{t('Support SKR Eyes')}</Eyebrow>
            <Text style={styles.noteText}>{t('Free and open source, built by one Seeker. Tips go straight to kosa.skr.')}</Text>
          </View>
          <Button label={t('Send a tip')} tone={colors.metal} onPress={() => { void Haptics.selectionAsync(); if (onTip) onTip(); else setTipping(true); }} />
        </View>
      </Panel>

      {/* The policy and the terms, reachable from inside the app (the store's
          developer agreement asks for it), as two quiet links at the very
          end: read once, if at all. */}
      <View style={styles.legal}>
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://skr-eyes.alexkosa.dev/privacy').catch(() => undefined)} style={({ pressed }) => [styles.legalItem, pressed && styles.pressed]}>
          <Text style={styles.legalText}>{t('Privacy policy')}</Text>
        </Pressable>
        <Text style={styles.legalDot}>·</Text>
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://skr-eyes.alexkosa.dev/terms').catch(() => undefined)} style={({ pressed }) => [styles.legalItem, pressed && styles.pressed]}>
          <Text style={styles.legalText}>{t('Terms of use')}</Text>
        </Pressable>
      </View>

      <Evidence
        lines={[
          `threshold source  ${config.source}`,
          `delivery          ${perDay > 0 ? `${perDay} a day · ${slotTimesLabel(perDay)} · set on the phone` : 'no check-ins'}`,
          'privacy           no push server · no address sent for check-ins',
        ]}
      />
    </>
  );
  if (embedded) return <View style={styles.embedded}>{body}</View>;
  return (
    <View style={styles.screen}>
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>{body}</ScrollView>
    {/* Outside the scroll view on purpose: a sheet inside it would sit at the
        top of the content and scroll away with it, leaving a blank screen. */}
    {tipping ? <TipSheet onClose={() => setTipping(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 130, gap: spacing.lg },
  embedded: { gap: spacing.lg },
  panel: { padding: spacing.md },
  pressed: { opacity: 0.6 },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  legal: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm },
  legalItem: { minHeight: 40, justifyContent: 'center' },
  legalText: { color: colors.muted, fontFamily: font.medium, ...type.small },
  legalDot: { color: colors.dim, fontFamily: font.medium, ...type.small },
  tipCopy: { flex: 1, gap: 4 },
  permission: { gap: spacing.md, paddingTop: spacing.md },
  sampleRow: { minHeight: 44, justifyContent: 'center', paddingTop: spacing.sm },
  sampleLink: { color: colors.accent, fontFamily: font.semibold, fontSize: 13 },
  sampleSent: { color: colors.positive, fontFamily: font.medium },
  settingStack: { flexDirection: 'column', alignItems: 'flex-end', gap: spacing.sm },
  settingNameStack: { alignSelf: 'stretch' },
  settingCopy: { flexShrink: 1, gap: 2 },
  settingDetail: { color: colors.faint, fontFamily: font.mono, ...type.micro, letterSpacing: 0.3, ...numeric },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, minHeight: 56 },
  settingName: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  settingLabel: { flexShrink: 1, color: colors.text, fontFamily: font.semibold, fontSize: 14 },
  note: { marginBottom: spacing.md },
  noteText: { color: colors.muted, fontFamily: font.regular, ...type.small },
  thresholds: { marginTop: spacing.md, gap: 5 },
  thresholdRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 9 },
  thresholdLabel: { flexShrink: 1, color: colors.muted, fontFamily: font.semibold, ...type.small, textTransform: 'uppercase', letterSpacing: 0.6 },
  thresholdFigures: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.lg, marginLeft: 'auto' },
  thresholdValue: { minWidth: 54, textAlign: 'right', color: colors.text, fontFamily: font.monoSemibold, ...type.small, ...numeric },
  thresholdCritical: { minWidth: 54, textAlign: 'right', color: colors.pending, fontFamily: font.monoSemibold, ...type.small, ...numeric },
  thresholdNote: { color: colors.faint, fontFamily: font.regular, ...type.small, marginTop: spacing.md },
  status: { color: colors.positive, fontFamily: font.medium, ...type.small, paddingTop: spacing.sm },
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
