import { Buffer } from 'buffer';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { getSkrShare } from '../../modules/skr-share';
import { eyeImageUrl, type Eye } from './api';

// Sharing the Eye: the NFT's own picture, as the server draws it right now,
// and a caption Alex set on 27.09: the person's own Eye number, the phone it
// was opened on (Solana Mobile Seeker, in plain words so X indexes them), the token by its cashtag ($SKR), the
// app by name with its maker's handle (@AlexKosa1; the app has no account of
// its own) and #SKREyes. Right after an Eye opens it says so and dares the
// reader to get a lower number; after a Blink it says which day was kept.
// No link: X pushes a post with a link down.

export type ShareMoment = 'open' | 'blink' | 'any';

const EYE = '\u{1F441}';

export function eyeCaption(eye: Eye, moment: ShareMoment): string {
  const days = eye.streak === 1 ? '1 day' : `${eye.streak} days`;
  const lines = moment === 'open'
    ? [
      `${eye.name} is open ${EYE}`,
      'opened with my fingerprint on a Solana Mobile Seeker',
      '',
      'one Eye per wallet, for $SKR stakers only, and the number never changes',
      'how low will yours be?',
    ]
    : moment === 'blink'
      ? [
        `day ${eye.streak} kept ${EYE} ${eye.name}`,
        'one Blink on Solana, one ring closer to the centre of the Iris',
        '',
        'still watching, Solana Mobile Seekers?',
      ]
      : [
        `${eye.name} · ${days} in a row ${EYE}`,
        'keeping watch on my Solana Mobile Seeker',
      ];
  return [...lines, '', 'SKR Eyes by @AlexKosa1 · $SKR #SKREyes'].join('\n');
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
