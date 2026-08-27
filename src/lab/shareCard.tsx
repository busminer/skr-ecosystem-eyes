import { forwardRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { CardArt, EXPORT_HEIGHT, EXPORT_WIDTH, type CardFacts, type CardHandle } from './cardArt';

// Exporting the card is a second, full-size copy of the same drawing.
//
// The visible card in the Me tab is only as wide as the phone, and asking that
// one for a 1600-wide picture would blow the background up from the size it was
// laid out at. So the export gets its own instance at the size it will be
// posted, mounted off to the side of the screen — react-native-svg can only
// photograph a view that is really laid out, and a card that exists only while
// a dialog is open has nothing to photograph.
export const CardExporter = forwardRef<CardHandle, { facts: CardFacts }>(function CardExporter({ facts }, ref) {
  return (
    <View style={styles.stage} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <CardArt ref={ref} facts={facts} width={EXPORT_WIDTH} />
    </View>
  );
});

export async function shareCardPng(base64: string) {
  const file = new File(Paths.cache, `skr-eyes-card-${Date.now()}.png`);
  if (file.exists) file.delete();
  file.create();
  file.write(base64, { encoding: 'base64' });
  if (!(await Sharing.isAvailableAsync())) throw new Error('This phone has nothing to share with.');
  await Sharing.shareAsync(file.uri, { mimeType: 'image/png', dialogTitle: 'Your SKR staker card' });
  return file.uri;
}

const styles = StyleSheet.create({
  // Off to the side rather than hidden: a view that is not laid out cannot be
  // photographed, and on Android zero opacity sometimes photographs as blank.
  stage: { position: 'absolute', left: -20_000, top: 0, width: EXPORT_WIDTH, height: EXPORT_HEIGHT },
});
