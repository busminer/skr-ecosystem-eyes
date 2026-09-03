import { StyleSheet, View } from 'react-native';
import { colors, spacing } from '../theme';

// The day as twenty-four cells, two rows of twelve.
//
// Brightness is how much moved in that hour. Not which way — only how much.
// The direction is already said, in words and in full colour, by the cards
// right underneath. Here it only shouted.
//
// The headline number used to sit above this strip; it now lives over the
// living scene, so the strip is only the strip, with the staked-share track
// under it.

const COLUMNS = 12;
const CELL_HEIGHT = 17;
const CELL_GAP = 4;
const CELL_RADIUS = 5;

export function DayHeat({ width, hours, percent }: {
  width: number;
  hours: Array<{ staked: number; unstaked: number }>;
  percent: number | null;
}) {
  const peak = Math.max(1, ...hours.map((hour) => hour.staked + hour.unstaked));
  const cellWidth = (width - CELL_GAP * (COLUMNS - 1)) / COLUMNS;
  const padded = [
    ...Array.from({ length: Math.max(0, 24 - hours.length) }, () => ({ staked: 0, unstaked: 0 })),
    ...hours.slice(-24),
  ];
  const rows = [padded.slice(0, COLUMNS), padded.slice(COLUMNS, COLUMNS * 2)];

  return (
    <View style={styles.wrap}>
      <View style={styles.strip}>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {row.map((hour, index) => {
              const total = hour.staked + hour.unstaked;
              const tone = total === 0 ? colors.line : colors.accent;
              const heat = total === 0 ? 1 : 0.34 + Math.sqrt(total / peak) * 0.66;
              return <View key={index} style={{ width: cellWidth, height: CELL_HEIGHT, borderRadius: CELL_RADIUS, backgroundColor: tone, opacity: heat }} />;
            })}
          </View>
        ))}
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  strip: { gap: CELL_GAP },
  row: { flexDirection: 'row', gap: CELL_GAP },
  track: { height: 3, borderRadius: 2, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: 3, borderRadius: 2, backgroundColor: colors.accent },
});
