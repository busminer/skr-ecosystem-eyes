import Svg, { Circle, Path } from 'react-native-svg';

export type NavIconName = 'me' | 'pulse' | 'alerts';

export function NavIcon({ name, color, size = 24 }: { name: NavIconName; color: string; size?: number }) {
  if (name === 'me') return <Svg width={size} height={size} viewBox="0 0 24 24"><Circle cx="12" cy="8" r="3.5" fill="none" stroke={color} strokeWidth="1.7" /><Path d="M5.5 20c.8-4 3-6 6.5-6s5.7 2 6.5 6" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" /></Svg>;
  if (name === 'alerts') return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d="M6.8 10.3c0-3.4 2-5.8 5.2-5.8s5.2 2.4 5.2 5.8v3.2l1.8 2.7H5l1.8-2.7z" fill="none" stroke={color} strokeWidth="1.7" strokeLinejoin="round" /><Path d="M10 19h4" stroke={color} strokeWidth="1.7" strokeLinecap="round" /></Svg>;
  return <Svg width={size} height={size} viewBox="0 0 24 24"><Circle cx="12" cy="12" r="8" fill="none" stroke={color} strokeWidth="1.7" /><Circle cx="12" cy="12" r="3" fill={color} /><Path d="M12 1.8v3M22.2 12h-3M12 22.2v-3M1.8 12h3" stroke={color} strokeWidth="1.7" strokeLinecap="round" /></Svg>;
}
