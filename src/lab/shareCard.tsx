import { forwardRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { t } from '../i18n';
import { getSkrShare } from '../../modules/skr-share';
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
      <CardArt ref={ref} facts={facts} width={EXPORT_WIDTH} post />
    </View>
  );
});

// The caption that goes with the picture.
//
// Android's share sheet takes an image or text, not both — apps on the other
// side pick one and quietly drop the other, and which one they drop varies. So
// the picture goes through the share sheet and the caption goes to the
// clipboard at the same moment, ready to paste.
//
// It is written the way a person writes, not the way a brand does: lower case,
// no full stops, the app named once and the address that is already printed on
// the card. There is no @mention of ours in it on purpose — somebody posting
// this is posting about themselves, and turning that into our advertisement is
// how you make people stop posting it.
// No link in the caption on purpose. X pushes down anything carrying one, so
// a URL here costs the person posting it their reach. The address is printed on
// the card itself, where it is a picture rather than a link and costs nothing.
export function captionFor(facts: CardFacts) {
  const days = facts.days == null
    ? null
    : `${facts.days}${facts.exactDays ? '' : '+'} days`;

  return [
    days ? `I'm staking $SKR for ${days}` : `I'm staking $SKR`,
    '',
    'my card from SKR Eyes',
    '#SKR #SolanaMobile',
  ].join('\n');
}

export async function shareCardPng(base64: string, facts: CardFacts) {
  const file = new File(Paths.cache, `skr-eyes-card-${Date.now()}.png`);
  if (file.exists) file.delete();
  file.create();
  file.write(base64, { encoding: 'base64' });
  const caption = captionFor(facts);

  // The good path: one Android intent carrying the picture and the caption
  // together, so the caption lands in the post instead of in the clipboard.
  const native = getSkrShare();
  if (native) {
    await native.shareImageWithText(file.uri, caption, t('Your SKR staker card'));
    return { uri: file.uri, caption, carried: true, copied: false };
  }

  // The fallback, for a build without the module compiled in. Whether the copy
  // worked is reported rather than assumed: a note saying the caption is on the
  // clipboard, shown after a copy that quietly failed, sends somebody to paste
  // nothing into a post they have already started. Copied before the sheet
  // opens, because once it is up this app is in the background and the write
  // can be refused.
  if (!(await Sharing.isAvailableAsync())) throw new Error(t('This phone has nothing to share with.'));
  const copied = await Clipboard.setStringAsync(caption).then(() => true).catch(() => false);
  await Sharing.shareAsync(file.uri, { mimeType: 'image/png', dialogTitle: t('Your SKR staker card') });
  return { uri: file.uri, caption, carried: false, copied };
}

const styles = StyleSheet.create({
  // Off to the side rather than hidden: a view that is not laid out cannot be
  // photographed, and on Android zero opacity sometimes photographs as blank.
  stage: { position: 'absolute', left: -20_000, top: 0, width: EXPORT_WIDTH, height: EXPORT_HEIGHT },
});
