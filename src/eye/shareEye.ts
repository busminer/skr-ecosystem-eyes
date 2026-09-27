import { Buffer } from 'buffer';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { getSkrShare } from '../../modules/skr-share';
import { eyeImageUrl, type Eye } from './api';

// Sharing the Eye: the NFT's own picture, as the server draws it right now,
// and a caption written the way the staker card's is (src/lab/shareCard.tsx):
// lower case, no full stops, the app named once, no link (X pushes a post
// with a link down) and no @mention of ours, because the person is posting
// about themselves. Right after an Eye opens it says so; after a Blink it
// says which day was kept.

export type ShareMoment = 'open' | 'blink' | 'any';

export function eyeCaption(eye: Eye, moment: ShareMoment): string {
  const lines = moment === 'open'
    ? [`my Eye is open: ${eye.name}`, 'opened with a fingerprint on my Seeker']
    : moment === 'blink'
      ? [`day ${eye.streak} kept · ${eye.name}`, 'one Blink on Solana, one ring closer to the centre']
      : [`${eye.name} · ${eye.streak === 1 ? '1 day' : `${eye.streak} days`} in a row`, 'keeping watch on my Seeker'];
  return [...lines, '', 'SKR Eyes · #SKR #SolanaMobile'].join('\n');
}

export async function shareEye(eye: Eye, moment: ShareMoment, dialogTitle: string) {
  // The Blink count in the address: the picture is re-drawn after every
  // Blink, and the edge in front of the server would otherwise hand back
  // yesterday's for a day.
  const url = `${eyeImageUrl(eye.image)}?v=${eye.blinks}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The picture did not load (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const file = new File(Paths.cache, `skr-eye-${eye.serial}-${Date.now()}.png`);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes.toString('base64'), { encoding: 'base64' });
  const caption = eyeCaption(eye, moment);

  const native = getSkrShare();
  if (native) {
    await native.shareImageWithText(file.uri, caption, dialogTitle);
    return { caption, carried: true };
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error('This phone has nothing to share with.');
  await Clipboard.setStringAsync(caption).catch(() => undefined);
  await Sharing.shareAsync(file.uri, { mimeType: 'image/png', dialogTitle });
  return { caption, carried: false };
}
