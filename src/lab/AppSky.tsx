import { memo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

// The night every tab stands in (30.09, Alex: the whole app should feel
// worked over). One still picture behind all five tabs: a deep vertical
// gradient, a scatter of faint stars in the upper half, one breath of aurora
// high on the right and a teal glow low on the left — the same night the
// NFT card, the walk-through and the Iris already live in. It never moves
// and is drawn once: atmosphere, not a screensaver.

const hash = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const STARS = Array.from({ length: 54 }, (_, i) => ({
  x: hash(i * 3 + 1),
  y: hash(i * 7 + 2) * 0.55,
  r: 0.5 + hash(i * 11 + 3) * 0.9,
  a: 0.08 + hash(i * 13 + 4) * 0.22,
}));

export const AppSky = memo(function AppSky() {
  const { width, height } = useWindowDimensions();
  const w = Math.max(width, 2);
  const h = Math.max(height, 2);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={w} height={h}>
        <Defs>
          <LinearGradient id="appsky-g" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#060A11" />
            <Stop offset="0.45" stopColor="#050910" />
            <Stop offset="1" stopColor="#03060A" />
          </LinearGradient>
          <LinearGradient id="appsky-au" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#3CF2C0" stopOpacity="0" />
            <Stop offset="0.5" stopColor="#3CF2C0" stopOpacity="0.045" />
            <Stop offset="1" stopColor="#56E0FF" stopOpacity="0" />
          </LinearGradient>
          <RadialGradient id="appsky-low" cx="0.18" cy="0.9" rx="0.7" ry="0.35">
            <Stop offset="0" stopColor="#12808F" stopOpacity="0.07" />
            <Stop offset="1" stopColor="#12808F" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={w} height={h} fill="url(#appsky-g)" />
        <Path d={`M${w * 0.35} ${h * 0.02} C ${w * 0.62} ${h * 0.06} ${w * 0.8} ${h * 0.04} ${w * 1.02} ${h * 0.12} L ${w * 1.02} ${h * 0.3} C ${w * 0.8} ${h * 0.2} ${w * 0.6} ${h * 0.22} ${w * 0.38} ${h * 0.14} Z`} fill="url(#appsky-au)" />
        <Rect x={0} y={0} width={w} height={h} fill="url(#appsky-low)" />
        {STARS.map((s, i) => <Circle key={i} cx={s.x * w} cy={s.y * h} r={s.r} fill="#D8F4FF" opacity={s.a} />)}
      </Svg>
    </View>
  );
});
