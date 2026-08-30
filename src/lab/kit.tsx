import type { PropsWithChildren, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { colors, font, radius, spacing, type } from '../theme';

// The mark: the eye from the app icon, drawn again in vector so the header,
// the card and the launcher all show the same shape. The lens at its centre is
// the camera the whole idea started from.
export function Mark({ size = 26, tone = colors.accent }: { size?: number; tone?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path
        d="M12 50 C22 29 34 24 50 24 C66 24 78 29 88 50 C78 71 66 76 50 76 C34 76 22 71 12 50 Z"
        fill="#070B0E"
        stroke={tone}
        strokeWidth={5}
      />
      <Path d="M13 50 C24 37 34 33 50 33 L50 67 C34 67 24 63 13 50 Z" fill="#101A21" />
      <Path d="M87 50 C76 37 66 33 50 33 L50 67 C66 67 76 63 87 50 Z" fill="#16242D" />
      <Circle cx={50} cy={50} r={16} fill="#050B10" stroke="#3A5B68" strokeWidth={3} />
      <Circle cx={50} cy={50} r={8.5} fill={colors.metal} />
      <Circle cx={50} cy={50} r={3.6} fill="#020304" />
      <Circle cx={46.5} cy={46.5} r={1.9} fill="#F4FBFD" />
    </Svg>
  );
}

export function Eyebrow({ children, tone = colors.faint }: PropsWithChildren<{ tone?: string }>) {
  return <Text style={[styles.eyebrow, { color: tone }]}>{children}</Text>;
}

export function Hairline({ inset = 0 }: { inset?: number }) {
  return <View style={[styles.hairline, { marginHorizontal: inset }]} />;
}

export function Panel({ children, style, tone }: PropsWithChildren<{ style?: object; tone?: string }>) {
  return (
    <View style={[styles.panel, style]}>
      {tone ? <View style={[styles.panelEdge, { backgroundColor: tone }]} /> : null}
      {children}
    </View>
  );
}

// One number owns each screen. Everything else is quieter by design.
export function Hero({ label, value, unit, note, tone = colors.text, small = false }: { label: string; value: string; unit?: string; note?: ReactNode; tone?: string; small?: boolean }) {
  return (
    <View style={styles.hero}>
      <Eyebrow>{label}</Eyebrow>
      <Animated.View key={value} entering={FadeInDown.duration(260)} style={styles.heroRow}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={[small ? styles.heroValueSmall : styles.heroValue, { color: tone }]}>{value}</Text>
        {unit ? <Text style={styles.heroUnit}>{unit}</Text> : null}
      </Animated.View>
      {typeof note === 'string' ? <Text style={styles.heroNote}>{note}</Text> : note}
    </View>
  );
}

export function Tile({ label, value, unit, note, tone = colors.accent, onPress }: { label: string; value: string; unit?: string; note?: string; tone?: string; onPress?: () => void }) {
  const body = (
    <Panel style={styles.tile} tone={tone}>
      <Text numberOfLines={1} style={styles.tileLabel}>{label}</Text>
      <View style={styles.tileRow}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.tileValue}>{value}</Text>
        {unit ? <Text style={styles.tileUnit}>{unit}</Text> : null}
      </View>
      {note ? <Text numberOfLines={2} style={styles.tileNote}>{note}</Text> : null}
    </Panel>
  );
  if (!onPress) return body;
  return <Pressable style={styles.tileWrap} onPress={onPress}>{body}</Pressable>;
}

export function Meter({ percent, tone = colors.accent, height = 3 }: { percent: number; tone?: string; height?: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <View style={[styles.meter, { height, borderRadius: height / 2 }]}>
      <View style={{ width: `${clamped}%`, height, borderRadius: height / 2, backgroundColor: tone }} />
    </View>
  );
}

// A period switch small enough to live inside a panel header.
export function RangeSwitch({ value, options, onChange, label }: { value: string; options: string[]; onChange: (next: string) => void; label?: (option: string) => string }) {
  return (
    <View style={styles.switchRow}>
      {options.map((option) => {
        const active = option === value;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            key={option}
            onPress={() => onChange(option)}
            style={({ pressed }) => [styles.switchItem, active && styles.switchItemActive, pressed && styles.switchPressed]}
          >
            <Text style={[styles.switchLabel, active && styles.switchLabelActive]}>{(label ? label(option) : option).toUpperCase()}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function HorizonRail({ bands }: { bands: Array<{ label: string; value: number; tone: string; display: string }> }) {
  const peak = Math.max(1, ...bands.map((band) => band.value));
  return (
    <View style={styles.rail}>
      {bands.map((band) => (
        <View key={band.label} style={styles.railRow}>
          <Text style={styles.railLabel}>{band.label}</Text>
          <View style={styles.railTrack}>
            <View style={{ width: `${Math.max(band.value > 0 ? 2 : 0, (band.value / peak) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: band.tone }} />
          </View>
          <Text style={styles.railValue}>{band.display}</Text>
        </View>
      ))}
    </View>
  );
}

// Every number carries where it came from. This is the line that says it.
export function Evidence({ lines }: { lines: string[] }) {
  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.evidence}>
      {lines.map((line) => <Text key={line} style={styles.evidenceLine}>{line}</Text>)}
    </Animated.View>
  );
}

export function Pill({ label, tone = colors.positive, filled = false }: { label: string; tone?: string; filled?: boolean }) {
  return (
    <View style={[styles.pill, { borderColor: filled ? tone : colors.lineStrong, backgroundColor: filled ? tone : 'transparent' }]}>
      {!filled ? <View style={[styles.pillDot, { backgroundColor: tone }]} /> : null}
      <Text style={[styles.pillText, { color: filled ? colors.bg : colors.text }]}>{label}</Text>
    </View>
  );
}

// `fill` lets a button share a row: it grows into the space it has and drops
// onto the next line when there is not enough. A row of fixed-width buttons
// looks fine at the default font and pushes its last button off the screen the
// moment someone enlarges the system text — which is exactly the person we
// should be looking after.
export function Button({ label, onPress, tone = colors.accent, ghost = false, disabled = false, fill = false }: { label: string; onPress?: () => void; tone?: string; ghost?: boolean; disabled?: boolean; fill?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.button, fill && styles.buttonFill, ghost ? styles.buttonGhost : { backgroundColor: tone }, disabled && styles.buttonDisabled, pressed && styles.buttonPressed]}
    >
      <Text maxFontSizeMultiplier={1.4} style={[styles.buttonText, ghost && styles.buttonTextGhost]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  eyebrow: { ...type.eyebrow, fontFamily: font.semibold, textTransform: 'uppercase' },
  hairline: { height: 1, backgroundColor: colors.line },
  panel: { backgroundColor: colors.panel, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  panelEdge: { position: 'absolute', left: 0, right: 0, top: 0, height: 1.5, opacity: 0.85 },
  hero: { paddingTop: spacing.sm },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: spacing.xs },
  heroValue: { fontFamily: font.black, fontVariant: ['tabular-nums'], ...type.hero },
  heroValueSmall: { fontFamily: font.black, fontVariant: ['tabular-nums'], ...type.heroSmall },
  heroUnit: { color: colors.muted, fontFamily: font.semibold, fontSize: 14 },
  heroNote: { color: colors.muted, fontFamily: font.regular, ...type.body, marginTop: spacing.sm },
  tileWrap: { flex: 1 },
  tile: { flex: 1, padding: spacing.md, minHeight: 92, justifyContent: 'space-between' },
  tileLabel: { color: colors.muted, fontFamily: font.semibold, ...type.eyebrow },
  tileRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5, marginTop: spacing.sm },
  tileValue: { color: colors.text, fontFamily: font.bold, fontVariant: ['tabular-nums'], ...type.tile },
  tileUnit: { color: colors.muted, fontFamily: font.medium, fontSize: 12 },
  tileNote: { color: colors.muted, fontFamily: font.regular, ...type.small, marginTop: spacing.xs },
  meter: { backgroundColor: colors.line, overflow: 'hidden', width: '100%' },
  switchRow: { flexDirection: 'row', gap: spacing.xs, backgroundColor: colors.bg, borderRadius: radius.pill, padding: 3, borderWidth: 1, borderColor: colors.line },
  switchItem: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill },
  switchItemActive: { backgroundColor: colors.panelHi },
  switchPressed: { opacity: 0.7 },
  switchLabel: { color: colors.faint, fontFamily: font.monoBold, fontSize: 10, letterSpacing: 0.8 },
  switchLabelActive: { color: colors.accent },
  rail: { gap: spacing.sm },
  railRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  railLabel: { width: 62, color: colors.muted, fontFamily: font.medium, ...type.small },
  railTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' },
  railValue: { width: 72, textAlign: 'right', color: colors.text, fontFamily: font.semibold, fontVariant: ['tabular-nums'], ...type.small },
  evidence: { gap: 3, paddingTop: spacing.md },
  evidenceLine: { color: colors.muted, fontFamily: font.mono, ...type.micro },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 },
  pillDot: { width: 5, height: 5, borderRadius: 3 },
  pillText: { fontFamily: font.bold, fontSize: 11, letterSpacing: 0.8 },
  button: { minHeight: 50, borderRadius: radius.card, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  buttonFill: { flexGrow: 1, flexShrink: 1, flexBasis: 128 },
  buttonGhost: { borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: 'transparent' },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  buttonText: { color: colors.bg, fontFamily: font.bold, fontSize: 13, letterSpacing: 0.4, textAlign: 'center' },
  buttonTextGhost: { color: colors.text },
});
