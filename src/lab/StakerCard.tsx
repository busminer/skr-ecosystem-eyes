import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, Polygon, RadialGradient, Rect, Stop, LinearGradient as SvgLinearGradient } from 'react-native-svg';
import { integer, shortAddress } from '../format';
import { colors, font, spacing, type } from '../theme';
import type { WalletProfile } from '../types';
import type { PositionAge } from './age';
import { Mark, Pill } from './kit';

// The card is the thing a staker owns inside the app, so it is drawn, not
// borrowed: an aurora scene of our own over a night sky whose stars are
// derived from the wallet address itself. Two people never get the same sky.

function seedFrom(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function starsFor(text: string, count: number, width: number, height: number) {
  let state = seedFrom(text) || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
  return Array.from({ length: count }, () => ({
    x: next() * width,
    y: next() * height,
    r: 0.5 + next() * 1.4,
    o: 0.2 + next() * 0.6,
  }));
}

function tierOf(share: number | null): { label: string; tone: string } {
  if (share == null) return { label: 'unclaimed', tone: colors.faint };
  if (share >= 0.05) return { label: 'whale', tone: colors.metal };
  if (share >= 0.005) return { label: 'deep', tone: colors.accent };
  if (share > 0) return { label: 'staker', tone: colors.positive };
  return { label: 'no position', tone: colors.faint };
}

function Aurora({ width, height, seed }: { width: number; height: number; seed: string }) {
  const stars = useMemo(() => starsFor(seed, 90, width, height), [seed, width, height]);
  return (
    <Svg width={width} height={height}>
      <Defs>
        <SvgLinearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#0B0A1F" />
          <Stop offset="0.55" stopColor="#0A1830" />
          <Stop offset="1" stopColor="#04121A" />
        </SvgLinearGradient>
        <RadialGradient id="violet" cx="0.22" cy="0.35" r="0.6">
          <Stop offset="0" stopColor="#7B4FD0" stopOpacity="0.55" />
          <Stop offset="1" stopColor="#7B4FD0" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="teal" cx="0.62" cy="0.3" r="0.55">
          <Stop offset="0" stopColor="#2BE3C8" stopOpacity="0.5" />
          <Stop offset="1" stopColor="#2BE3C8" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="lamp" cx="0.9" cy="0.42" r="0.5">
          <Stop offset="0" stopColor="#DFFFFA" stopOpacity="0.95" />
          <Stop offset="1" stopColor="#8FF3E4" stopOpacity="0" />
        </RadialGradient>
        <SvgLinearGradient id="beam" x1="1" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#CFFAF3" stopOpacity="0.34" />
          <Stop offset="1" stopColor="#CFFAF3" stopOpacity="0" />
        </SvgLinearGradient>
      </Defs>

      <Rect x={0} y={0} width={width} height={height} fill="url(#sky)" />
      {stars.map((star, index) => (
        <Circle key={index} cx={star.x} cy={star.y} r={star.r} fill="#EAF6FF" opacity={star.o} />
      ))}
      <Ellipse cx={width * 0.26} cy={height * 0.34} rx={width * 0.38} ry={height * 0.42} fill="url(#violet)" />
      <Ellipse cx={width * 0.62} cy={height * 0.28} rx={width * 0.34} ry={height * 0.34} fill="url(#teal)" />
      <Polygon points={`${width},${height * 0.34} ${width},${height * 0.62} ${width * 0.12},${height} ${width * 0.02},${height}`} fill="url(#beam)" opacity={0.5} />
      <Ellipse cx={width * 0.93} cy={height * 0.44} rx={width * 0.15} ry={height * 0.38} fill="url(#lamp)" />
    </Svg>
  );
}

export function StakerCard({ profile, age, share, claimed, name, width }: {
  profile: WalletProfile | null;
  age: PositionAge | null;
  share: number | null;
  claimed: boolean;
  name?: string | null;
  width: number;
}) {
  const tier = tierOf(claimed ? share : null);
  const artHeight = Math.round(width * 0.58);
  const seed = profile?.wallet || 'skr-eyes-unclaimed';
  const title = name || (profile ? shortAddress(profile.wallet) : 'not connected');

  return (
    <View style={[styles.card, claimed && styles.cardClaimed]}>
      <View style={[styles.art, { height: artHeight }]}>
        <Aurora width={width} height={artHeight} seed={seed} />
        <View style={styles.artOverlay}>
          <View style={styles.artTop}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={styles.name}>{title}</Text>
            <Pill label={tier.label.toUpperCase()} tone={tier.tone} />
          </View>
          <View style={styles.artBottom}>
            <View style={styles.markPlate}><Mark size={22} /></View>
            <Text style={styles.seekerId}>SEEKER STAKER</Text>
          </View>
        </View>
      </View>

      <View style={styles.body}>
        {profile ? (
          <View style={styles.amountRow}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={styles.amount}>{integer(profile.totals.activeStaked)}</Text>
            <Text style={styles.unit}>SKR</Text>
          </View>
        ) : (
          <Text style={styles.empty}>your stake shows here</Text>
        )}

        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>HELD</Text>
            <Text style={styles.statValue}>{age?.days != null ? `${age.exact ? '' : '≥'}${age.days}d` : profile ? '…' : '—'}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>SHARE</Text>
            <Text style={[styles.statValue, claimed && styles.statAccent]}>{share != null ? `${share < 0.001 ? share.toFixed(5) : share.toFixed(3)}%` : '—'}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>POSITIONS</Text>
            <Text style={styles.statValue}>{profile ? integer(profile.totals.positions) : '—'}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>{profile?.positions?.[0]?.stakeAccount ? shortAddress(profile.positions[0].stakeAccount) : 'connect to claim your card'}</Text>
          <Text style={styles.footerText}>{profile?.provenance?.sourceSlot ? `slot ${integer(profile.provenance.sourceSlot)}` : 'finalized'}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panelHi, overflow: 'hidden' },
  cardClaimed: { borderColor: colors.metalDim },
  art: { width: '100%', position: 'relative' },
  artOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, padding: spacing.lg, justifyContent: 'space-between' },
  artTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  name: { flex: 1, color: '#EAFBF7', fontFamily: font.semibold, fontSize: 30, letterSpacing: -0.8 },
  artBottom: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  markPlate: { width: 42, height: 42, borderRadius: 13, backgroundColor: 'rgba(4,7,11,0.55)', borderWidth: 1, borderColor: 'rgba(234,246,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  seekerId: { color: 'rgba(234,251,247,0.82)', fontFamily: font.semibold, fontSize: 11, letterSpacing: 1.4 },
  body: { padding: spacing.lg, gap: spacing.lg },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  amount: { color: colors.text, fontFamily: font.black, fontVariant: ['tabular-nums'], fontSize: 38, lineHeight: 44, letterSpacing: -1.6 },
  unit: { color: colors.muted, fontFamily: font.semibold, fontSize: 13 },
  empty: { color: colors.muted, fontFamily: font.regular, fontSize: 16 },
  stats: { flexDirection: 'row', gap: spacing.xxl },
  stat: { gap: 3 },
  statLabel: { color: colors.muted, fontFamily: font.semibold, fontSize: 10.5, letterSpacing: 1 },
  statValue: { color: colors.text, fontFamily: font.semibold, fontSize: 16, fontVariant: ['tabular-nums'] },
  statAccent: { color: colors.metal },
  footer: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line },
  footerText: { color: colors.muted, fontFamily: font.mono, ...type.micro },
});
