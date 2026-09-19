import type { PropsWithChildren, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Path, Rect } from 'react-native-svg';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { colors, font, radius, spacing, type } from '../theme';

// The mark: the eye from the app icon, drawn again in vector so the header,
// the card and the launcher all show the same shape. The lens at its centre is
// the camera the whole idea started from.
//
// `open` is how far the lids are apart, 1 to 0. In the header it follows the
// freshness of what is on screen: wide open on fresh data, half-closed while it
// ages, shut when the source has gone quiet. The eye says it without a word.
export function Mark({ size = 26, tone = colors.accent, open = 1 }: { size?: number; tone?: string; open?: number }) {
  const gap = Math.max(0, Math.min(1, open));
  const height = 52 * gap;
  const y = 50 - height / 2;
  const lidTone = gap < 0.3 ? '#6C8593' : tone;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <ClipPath id="lids"><Rect x={0} y={y} width={100} height={Math.max(height, 0.01)} /></ClipPath>
      </Defs>
      <G clipPath="url(#lids)">
        <Path
          d="M12 50 C22 29 34 24 50 24 C66 24 78 29 88 50 C78 71 66 76 50 76 C34 76 22 71 12 50 Z"
          fill="#070B0E"
          stroke={lidTone}
          strokeWidth={5}
        />
        <Path d="M13 50 C24 37 34 33 50 33 L50 67 C34 67 24 63 13 50 Z" fill="#101A21" />
        <Path d="M87 50 C76 37 66 33 50 33 L50 67 C66 67 76 63 87 50 Z" fill="#16242D" />
        <Circle cx={50} cy={50} r={16} fill="#050B10" stroke="#3A5B68" strokeWidth={3} />
        <Circle cx={50} cy={50} r={8.5} fill={colors.metal} opacity={0.45 + 0.55 * gap} />
        <Circle cx={50} cy={50} r={3.6} fill="#020304" />
        {gap > 0.5 ? <Circle cx={46.5} cy={46.5} r={1.9} fill="#F4FBFD" /> : null}
      </G>
      {gap < 0.3 ? <Path d="M12 50 C30 50 70 50 88 50" fill="none" stroke={lidTone} strokeWidth={5} strokeLinecap="round" /> : null}
    </Svg>
  );
}

// The five tabs, drawn.
//
// The bar used to be five words and a 22-by-2 dash under the live one. On a
// 360-wide phone that is seventy-two points a tab, so "Alerts" and "Vault"
// were shrunk to ten and a half and the only thing telling you where you were
// was a dash two pixels tall. A person glancing at the phone had to read to
// find out which room they were standing in.
//
// Shapes are read without reading. Each one says what its tab holds — the
// vault door, the flow of events, the standings, a person, a bell — and the
// live one sits in a pool of accent light, which is the one place on any
// screen where the accent is spent by default.
export function TabIcon({ name, tone, size = 22 }: { name: 'pulse' | 'flow' | 'top' | 'me' | 'alerts'; tone: string; size?: number }) {
  const stroke = { stroke: tone, strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'pulse' ? (
        <G>
          <Rect x={3} y={4} width={18} height={16} rx={3} {...stroke} />
          <Circle cx={12} cy={12} r={4} {...stroke} />
          <Path d="M12 6.4v1.4M12 16.2v1.4M6.6 12h1.4M16 12h1.4" {...stroke} />
        </G>
      ) : null}
      {name === 'flow' ? <Path d="M2.5 14.5h4L9 6.5l4 11 2.2-5.5h4.3" {...stroke} /> : null}
      {name === 'top' ? (
        <G>
          <Path d="M4 20.5V13M12 20.5V4.5M20 20.5V9.5" {...stroke} />
        </G>
      ) : null}
      {name === 'me' ? (
        <G>
          <Circle cx={12} cy={8.5} r={3.6} {...stroke} />
          <Path d="M4.8 20c.6-3.8 3.6-6 7.2-6s6.6 2.2 7.2 6" {...stroke} />
        </G>
      ) : null}
      {name === 'alerts' ? (
        <G>
          <Path d="M18 9.5a6 6 0 1 0-12 0c0 6-2.5 8-2.5 8h17S18 15.5 18 9.5" {...stroke} />
          <Path d="M13.7 21a2 2 0 0 1-3.4 0" {...stroke} />
        </G>
      ) : null}
    </Svg>
  );
}

// A disclosure. The screens are full of paragraphs that explain a switch once
// and then sit under it forever, taking more room than the setting they
// describe. The chevron is the promise that the words are still there.
export function Chevron({ open = false, tone = colors.faint, size = 14 }: { open?: boolean; tone?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={open ? 'M6 14.75 12 8.75 18 14.75' : 'M9.25 5.75 15.5 12 9.25 18.25'}
        fill="none"
        stroke={tone}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function Eyebrow({ children, tone = colors.faint }: PropsWithChildren<{ tone?: string }>) {
  return <Text style={[styles.eyebrow, { color: tone }]}>{children}</Text>;
}

export function Hairline({ inset = 0 }: { inset?: number }) {
  return <View style={[styles.hairline, { marginHorizontal: inset }]} />;
}

// A raised surface, lit rather than outlined.
//
// The border is now dark enough to read as the shadow under an edge, and a
// hair of light runs along the top where a real surface would catch it. A
// `tone` replaces that light with a coloured edge — which is why a tone has to
// mean something: it is this panel putting its hand up. Twelve panels down a
// screen, each with its own coloured edge, is twelve hands up and no question
// answered, which is what the Pulse and Alerts tabs had become.
//
// `flat` is for a panel that sits inside another one: no light of its own, so
// the screen stops reading as boxes inside boxes.
export function Panel({ children, style, tone, flat = false }: PropsWithChildren<{ style?: object; tone?: string; flat?: boolean }>) {
  return (
    <View style={[styles.panel, flat && styles.panelFlat, style]}>
      {tone
        ? <View style={[styles.panelEdge, { backgroundColor: tone }]} />
        : flat ? null : <View style={styles.panelSheen} />}
      {children}
    </View>
  );
}

// A row that belongs to the panel around it: recessed into it, never given a
// border of its own. This is the second surface level the screens never had —
// before it, anything that needed to stand apart inside a panel was drawn as
// another panel.
export function Inset({ children, style }: PropsWithChildren<{ style?: object }>) {
  return <View style={[styles.insetBox, style]}>{children}</View>;
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

// A tile's coloured top edge used to default to the accent, so every tile on
// every screen wore it and the accent stopped meaning anything. Now a tile is
// lit like any other panel unless its number genuinely has a state — cooling
// down, ready, leaving — and then the edge is that state's colour and is worth
// looking at.
export function Tile({ label, value, unit, note, tone, onPress }: { label: string; value: string; unit?: string; note?: string; tone?: string; onPress?: () => void }) {
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
//
// `quiet` is the third rung, and the reason it exists: a row of three ghost
// buttons — Wake me, Refresh, Disconnect — reads as three offers of equal
// weight, when in truth one is a setting, one is housekeeping and one ends the
// session. Ghost was the only step down from filled, so everything secondary
// became a bordered rectangle. Quiet drops the box entirely and leaves a word
// with a touch target, which is what those three always were.
export function Button({ label, onPress, tone = colors.accent, ghost = false, quiet = false, disabled = false, fill = false }: { label: string; onPress?: () => void; tone?: string; ghost?: boolean; quiet?: boolean; disabled?: boolean; fill?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        fill && styles.buttonFill,
        quiet ? styles.buttonQuiet : ghost ? styles.buttonGhost : { backgroundColor: tone },
        disabled && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      {/* A button that grows a second line grows taller, and a label that
          changes with state then bounces the whole column under it. One line,
          shrunk a hair when it must. */}
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} maxFontSizeMultiplier={1.4} style={[styles.buttonText, (ghost || quiet) && styles.buttonTextGhost, quiet && styles.buttonTextQuiet]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  eyebrow: { ...type.eyebrow, fontFamily: font.semibold, textTransform: 'uppercase' },
  hairline: { height: 1, backgroundColor: colors.line },
  // The border dropped from #15212C to #111B24: dark enough to read as the
  // shadow under an edge rather than as a drawn outline. The light on top does
  // the work the outline used to do, and does it without shouting.
  panel: { backgroundColor: colors.panel, borderRadius: radius.card, borderWidth: 1, borderColor: '#111B24', overflow: 'hidden' },
  panelFlat: { backgroundColor: 'transparent', borderColor: 'transparent' },
  panelEdge: { position: 'absolute', left: 0, right: 0, top: 0, height: 1.5, opacity: 0.7 },
  panelSheen: { position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: colors.sheen },
  insetBox: { backgroundColor: colors.inset, borderRadius: radius.inner, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
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
  // radius.button, not radius.card. They used to share 14 and a filled button
  // was indistinguishable from a small panel; now 12 against 16 keeps a button
  // reading as something you press.
  button: { minHeight: 50, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  buttonFill: { flexGrow: 1, flexShrink: 1, flexBasis: 128 },
  buttonGhost: { borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: 'transparent' },
  buttonQuiet: { minHeight: 44, backgroundColor: 'transparent', paddingHorizontal: spacing.sm },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  buttonText: { color: colors.bg, fontFamily: font.bold, fontSize: 13, letterSpacing: 0.4, textAlign: 'center' },
  buttonTextGhost: { color: colors.text },
  buttonTextQuiet: { color: colors.muted, fontFamily: font.medium, letterSpacing: 0.2 },
});
