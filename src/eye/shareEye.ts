import { Buffer } from 'buffer';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { getSkrShare } from '../../modules/skr-share';
import { eyeImageUrl, type Eye } from './api';
import { EYE_FINGER_ENABLED } from './config';

// Sharing the Eye: the NFT's own picture, as the server draws it right now,
// and a caption. The rules Alex set on 27.09 (D-023): the person's own Eye
// number, the phone in plain words (Solana Mobile Seeker, untagged, so X
// indexes the phrase), the token by its cashtag ($SKR, once), the app by name
// with its maker's handle (@AlexKosa1; the app has no account of its own) and
// #SKREyes. No link: X pushes a post with a link down.
//
// Rewritten 28.09 on Alex's word: say plainly that an NFT was minted, sound
// professional, and pull people in. Every post is bait for the next Eye: the
// first line is the hook (the number, the day), then what really happened on
// the phone (the finger, the StrongBox secure element, the Seed Vault wallet,
// Solana), then the pull: how many of the first thousand are left, what a
// missed day costs, a question to answer. The numbers come from the server's
// answer to the open or the Blink, the same numbers the card is drawn from
// (from day two the card says "Streak N · M blinks").

export type ShareMoment = 'open' | 'blink' | 'any';

// What the network looks like right now, for the pull line; each is optional.
export type ShareContext = {
  // Eyes open in the whole collection.
  eyes?: number | null;
  // How many are left at the first price, and how many that price covers.
  left?: number | null;
  firstTier?: number | null;
};

const EYE = '\u{1F441}';

const count = (n: number) => n.toLocaleString('en-US');

export function eyeCaption(eye: Eye, moment: ShareMoment, context: ShareContext = {}): string {
  const { eyes, left, firstTier } = context;
  const scarce = left != null && left > 0 && firstTier != null && eye.serial <= firstTier
    ? `${count(left)} of the first ${count(firstTier)} left. How low will yours be?`
    : 'How low will yours be?';
  const lines = moment === 'open'
    ? [
      `I just minted ${eye.name}, an NFT on Solana ${EYE}`,
      EYE_FINGER_ENABLED
        ? 'Only a fingerprint on a Solana Mobile Seeker opens one: StrongBox secure element → Seed Vault → on-chain.'
        : 'Only a Solana Mobile Seeker opens one: signed in the Seed Vault wallet, written on-chain.',
      '',
      'One per wallet, $SKR stakers only.',
      scarce,
    ]
    : moment === 'blink'
      ? eye.streak >= 30
        ? [
          `${eye.streak} days unbroken. ${eye.name} is a Perfect Eye ${EYE}`,
          'Every day signed on my Solana Mobile Seeker, every Blink written into my NFT on Solana. Gold, at the centre of the Iris.',
          '',
          'Can you hold thirty days?',
        ]
        : [
          eye.streak <= 1 ? `Day 1 of a new streak ${EYE} ${eye.name}` : `Day ${eye.streak} unbroken ${EYE} ${eye.name}`,
          `Blink #${count(eye.blinks)} ${EYE_FINGER_ENABLED ? 'signed with my fingerprint and ' : ''}written into my Eye NFT on Solana. One day closer to a gold Eye.`,
          '',
          'Miss a day and the streak starts over. Still watching, Solana Mobile Seekers?',
        ]
      : [
        `${eye.name} · day ${eye.streak} · ${count(eye.blinks)} ${eye.blinks === 1 ? 'Blink' : 'Blinks'} ${EYE}`,
        `My Eye NFT on Solana, kept open ${EYE_FINGER_ENABLED ? 'by fingerprint ' : ''}on my Solana Mobile Seeker.${eyes != null && eyes > 1 ? ` One of ${count(eyes)} Eyes watching.` : ''}`,
        '',
        'Are you in?',
      ];
  const tags = moment === 'open' ? 'SKR Eyes by @AlexKosa1 · #SKREyes' : 'SKR Eyes by @AlexKosa1 · $SKR #SKREyes';
  return [...lines, '', tags].join('\n');
}

export async function shareEye(eye: Eye, moment: ShareMoment, dialogTitle: string, context: ShareContext = {}) {
  // The Blink count in the address: the picture is re-drawn after every
  // Blink, and the edge in front of the server would otherwise hand back
  // yesterday's for a day. The asset's address too: a wiped lab numbers its
  // Eyes from one again, and the edge still holds the last #1's picture.
  const url = `${eyeImageUrl(eye.image)}?v=${eye.asset.slice(0, 8)}-${eye.blinks}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The picture did not load (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const file = new File(Paths.cache, `skr-eye-${eye.serial}-${Date.now()}.png`);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes.toString('base64'), { encoding: 'base64' });
  const caption = eyeCaption(eye, moment, context);

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
