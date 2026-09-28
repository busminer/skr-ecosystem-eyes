import type { PropsWithChildren } from 'react';
import { StyleSheet, Text } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { colors, font } from '../theme';

// The Eye's own set of small drawings: one per thing the phone does, drawn
// once and shown everywhere that thing is named. The walk-through of the Eye
// puts the fingerprint next to "Finger" on its third page; the sheet that
// really opens the Eye puts the same fingerprint next to the same word when
// the real step turns, and so does the Seeker verification. Nothing a person
// meets later is a shape they have not seen before.
//
// One stroke weight, round joins, a 24-unit box, no fills except the smallest
// marks. The colour is the caller's: accent for a thing that is live, the
// faint grey for one still to come, the metal for gold moments.

export type GlyphName =
  | 'finger' // the fingerprint: the key signs only under it
  | 'wallet' // the Seeker wallet, which approves and pays
  | 'network' // Solana: three blocks in a row
  | 'eye' // the Eye itself
  | 'key' // the key born in the StrongBox chip
  | 'chip' // the StrongBox secure element
  | 'vault' // Seed Vault: the wallet's keys, behind a door
  | 'token' // the Seeker Genesis Token
  | 'cert' // Google's attestation: a shield with a check
  | 'phone' // the Seeker
  | 'share' // out to X
  | 'check' // done, verified
  | 'skr'; // an SKR position

export function Glyph({ name, size = 22, tone = colors.accent, strokeWidth = 1.7 }: { name: GlyphName; size?: number; tone?: string; strokeWidth?: number }) {
  const s = { fill: 'none', stroke: tone, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'finger' ? (
        <G {...s}>
          <Path d="M4.5 10.2a7.5 7.5 0 0 1 15 0" />
          <Path d="M7.4 19.6c-.9-1.9-1.4-3.9-1.4-6.2a6 6 0 0 1 12 0c0 1.2-.1 2.3-.3 3.4" />
          <Path d="M10.2 21.3c-1.1-2.3-1.6-4.7-1.6-7.3a3.4 3.4 0 0 1 6.8 0c0 2-.3 3.9-.9 5.6" />
          <Path d="M12 13.6c0 3 .6 5.6 1.8 7.8" />
        </G>
      ) : null}
      {name === 'wallet' ? (
        <G {...s}>
          <Path d="M5.5 7.6 16.2 4.3l1.2 3.3" />
          <Rect x={3} y={7.6} width={18} height={12.4} rx={2.6} />
          <Path d="M21 11.6h-4.6a2.2 2.2 0 0 0 0 4.4H21" />
        </G>
      ) : null}
      {name === 'network' ? (
        <G {...s}>
          <Rect x={2} y={9.2} width={5.6} height={5.6} rx={1.4} />
          <Rect x={9.2} y={9.2} width={5.6} height={5.6} rx={1.4} />
          <Rect x={16.4} y={9.2} width={5.6} height={5.6} rx={1.4} />
          <Path d="M7.6 12h1.6M14.8 12h1.6" />
        </G>
      ) : null}
      {name === 'eye' ? (
        <G {...s}>
          <Path d="M2.5 12c2.6-4.3 5.8-6.4 9.5-6.4s6.9 2.1 9.5 6.4c-2.6 4.3-5.8 6.4-9.5 6.4S5.1 16.3 2.5 12Z" />
          <Circle cx={12} cy={12} r={3.1} />
        </G>
      ) : null}
      {name === 'key' ? (
        <G {...s}>
          <Circle cx={8.3} cy={12} r={4.3} />
          <Path d="M12.6 12h8.2M17.6 12v3.2M20.4 12v2.3" />
        </G>
      ) : null}
      {name === 'chip' ? (
        <G {...s}>
          <Rect x={7} y={7} width={10} height={10} rx={1.6} />
          <Rect x={10.2} y={10.2} width={3.6} height={3.6} rx={0.8} />
          <Path d="M9.5 7V4M12 7V4M14.5 7V4M9.5 20v-3M12 20v-3M14.5 20v-3M4 9.5h3M4 12h3M4 14.5h3M17 9.5h3M17 12h3M17 14.5h3" />
        </G>
      ) : null}
      {name === 'vault' ? (
        <G {...s}>
          <Circle cx={12} cy={12} r={8.6} />
          <Circle cx={12} cy={12} r={3.1} />
          <Path d="M12 3.4v3.2M12 17.4v3.2M3.4 12h3.2M17.4 12h3.2" />
        </G>
      ) : null}
      {name === 'token' ? (
        <G {...s}>
          <Path d="M12 2.8l7.8 4.5v9.4L12 21.2l-7.8-4.5V7.3L12 2.8Z" />
          <Path d="M12 8.4l1.1 2.5 2.5 1.1-2.5 1.1L12 15.6l-1.1-2.5-2.5-1.1 2.5-1.1L12 8.4Z" fill={tone} stroke="none" />
        </G>
      ) : null}
      {name === 'cert' ? (
        <G {...s}>
          <Path d="M12 3l7 3v5.4c0 4.4-3 8.1-7 9.6-4-1.5-7-5.2-7-9.6V6l7-3Z" />
          <Path d="M8.8 12.2l2.2 2.2 4.4-4.6" />
        </G>
      ) : null}
      {name === 'phone' ? (
        <G {...s}>
          <Rect x={6} y={2.5} width={12} height={19} rx={2.6} />
          <Path d="M10 5.3h4" />
          <Circle cx={12} cy={18.3} r={0.9} fill={tone} stroke="none" />
        </G>
      ) : null}
      {name === 'share' ? (
        <G {...s}>
          <Path d="M12 3.5v11" />
          <Path d="M8.2 7.3 12 3.5l3.8 3.8" />
          <Path d="M5 12.5v5.2A2.3 2.3 0 0 0 7.3 20h9.4a2.3 2.3 0 0 0 2.3-2.3v-5.2" />
        </G>
      ) : null}
      {name === 'check' ? (
        <G {...s}>
          <Circle cx={12} cy={12} r={8.6} />
          <Path d="M8 12.3l2.6 2.6 5.4-5.6" />
        </G>
      ) : null}
      {name === 'skr' ? (
        <G {...s}>
          <Path d="M12 4 4 8l8 4 8-4-8-4Z" />
          <Path d="M4 12l8 4 8-4" />
          <Path d="M4 16l8 4 8-4" />
        </G>
      ) : null}
    </Svg>
  );
}

// The small line over a page or a section, in mono and spaced out: the part
// of a sequence a person is in ("02 · Inside your Seeker", "Once · Verify my
// Seeker"). Uppercased by the style, so the source keeps its sentence.
export function Overline({ children, tone = colors.accent, align = 'left' }: PropsWithChildren<{ tone?: string; align?: 'left' | 'center' }>) {
  return <Text maxFontSizeMultiplier={1.2} style={[styles.overline, { color: tone, textAlign: align }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  overline: { fontFamily: font.monoSemibold, fontSize: 11.5, lineHeight: 16, letterSpacing: 2.2, textTransform: 'uppercase' },
});
