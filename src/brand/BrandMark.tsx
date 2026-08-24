import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '../theme';
import geometry from './brand-geometry.json';

// REPLACE brand-geometry.json when the final logo arrives. Keep this component's
// { size, color } signature and single-color rendering contract.
export function BrandMark({ size, color = colors.accent }: { size: number; color?: string }) {
  const polar = (angle: number) => { const radians = (angle - 90) * Math.PI / 180; return { x: 32 + geometry.outerRadius * Math.cos(radians), y: 32 + geometry.outerRadius * Math.sin(radians) }; };
  const arc = ([start = 0, end = 0]: number[]) => { const from = polar(end); const to = polar(start); return `M ${from.x} ${from.y} A ${geometry.outerRadius} ${geometry.outerRadius} 0 ${end - start <= 180 ? 0 : 1} 0 ${to.x} ${to.y}`; };
  return <Svg width={size} height={size} viewBox={geometry.viewBox} accessibilityRole="image" accessibilityLabel="SKR Eyes mark">{geometry.segments.map((segment) => <Path key={segment.join('-')} d={arc(segment)} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" />)}<Circle cx="32" cy="32" r={geometry.ringRadius} fill="none" stroke={color} strokeWidth="3" /><Circle cx="32" cy="32" r={geometry.pupilRadius} fill={color} /></Svg>;
}
