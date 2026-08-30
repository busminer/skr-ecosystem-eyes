import { StyleSheet, Text, View } from 'react-native';
import { colors, font, spacing, type } from '../theme';
import { FlipNumber } from './FlipNumber';

// The day as twenty-four cells, two rows of twelve.
//
// Brightness is how much moved in that hour. Not which way — only how much.
//
// It carried colour for a day: green for hours that took more in than out, red
// for the rest. The trouble is that the network is in outflow, so twenty of the
// twenty-four hours came out red and the whole screen read as an alarm. The
// direction is already said, in words and in full colour, by the cards right
// underneath. Here it only shouted.
//
// The eye reads brightness faster than it reads height, so a strip this small
// still says more about the rhythm of a day than the bars it replaced — and it
// costs a tenth of the screen they cost.
//
// Two rows rather than one: at twenty-four across, each cell is thinner than a
// finger and the whole thing reads as a barcode.

const COLUMNS = 12;
const CELL_HEIGHT = 17;
const CELL_GAP = 4;
const CELL_RADIUS = 5;

export function DayHeat({ width, hours, percent, figure, unit, note }: {
  width: number;
  hours: Array<{ staked: number; unstaked: number }>;
  percent: number | null;
  figure: string;
  unit: string;
  note: string;
}) {
  // A single whale hour would flatten the other twenty-three, so brightness
  // follows the square root: big stays bright, small stays visible.
  const peak = Math.max(1, ...hours.map((hour) => hour.staked + hour.unstaked));
  const cellWidth = (width - CELL_GAP * (COLUMNS - 1)) / COLUMNS;

  // Twenty-four cells even when the server has answered with fewer, so the
  // strip is the same shape at four in the morning as it is at noon.
  const padded = [
    ...Array.from({ length: Math.max(0, 24 - hours.length) }, () => ({ staked: 0, unstaked: 0 })),
    ...hours.slice(-24),
  ];
  const rows = [padded.slice(0, COLUMNS), padded.slice(COLUMNS, COLUMNS * 2)];

  return (
    <View style={styles.wrap}>
      <View style={styles.figureRow}>
        <FlipNumber value={figure} size={60} />
        <Text style={styles.unit}>{unit}</Text>
      </View>

      <View style={styles.strip}>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {row.map((hour, index) => {
              const total = hour.staked + hour.unstaked;
              const tone = total === 0 ? colors.line : colors.accent;
              // A floor under the dimmest hour: below about a third, a colour on this
              // background stops reading as itself and turns muddy.
              const heat = total === 0 ? 1 : 0.34 + Math.sqrt(total / peak) * 0.66;
              return (
                <View
                  key={index}
                  style={{
                    width: cellWidth,
                    height: CELL_HEIGHT,
                    borderRadius: CELL_RADIUS,
                    backgroundColor: tone,
                    opacity: heat,
                  }}
                />
              );
            })}
          </View>
        ))}
      </View>

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }]} />
      </View>
      <Text style={styles.note}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  figureRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  unit: { color: colors.muted, fontFamily: font.semibold, fontSize: 14, letterSpacing: 0.8, marginBottom: 6 },
  strip: { gap: CELL_GAP },
  row: { flexDirection: 'row', gap: CELL_GAP },
  track: { height: 3, borderRadius: 2, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: 3, borderRadius: 2, backgroundColor: colors.accent },
  note: { color: colors.muted, fontFamily: font.regular, ...type.small, marginTop: -spacing.xs },
});
