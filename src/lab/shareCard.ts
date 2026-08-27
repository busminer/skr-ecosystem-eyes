import { Skia, ImageFormat, TileMode, FilterMode, MipmapMode, type SkCanvas, type SkFont, type SkPaint, type SkTypeface } from '@shopify/react-native-skia';
import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

// The card a staker posts to X.
//
// It is drawn here rather than on the server because the server carries no
// dependencies at all — no canvas, no font engine — and adding a headless
// browser to it for one picture would cost half a gigabyte on a disk already
// 55% full. Skia is in this app for the charts, so the phone draws the card
// and the server keeps answering with numbers only.
//
// Everyone still gets the same picture: the background and the typeface are
// bundled here, not taken from the device, so nothing depends on which fonts a
// particular phone happens to have.

// The background was generated once at 1672x941 and every coordinate below is
// in that space. The canvas is scaled to the export size once, at the end, so
// the layout never has to be recomputed when the export size changes.
const ART_WIDTH = 1672;
const ART_HEIGHT = 941;

// 1600x900 is what X shows in the timeline.
const OUT_WIDTH = 1600;
const OUT_HEIGHT = 900;

// The calm part of the display. The notch takes the lower left, the portal
// ring takes everything right of x=950, so the text lives in the upper left
// corner and nowhere else.
const TEXT_LEFT = 272;

const SHADOW = Skia.Color('rgba(0, 10, 14, 0.92)');
const RIM = Skia.Color('rgba(200, 255, 244, 0.42)');

export type CardFacts = {
  name: string;
  days: number | null;
  exactDays: boolean;
  firstSeenAt: number | null;
  positionSkr: number | null;
  networkPositions: number | null;
};

let cachedBackground: ReturnType<typeof Skia.Image.MakeImageFromEncoded> | null = null;
const cachedTypefaces = new Map<string, SkTypeface>();

async function dataFrom(moduleRef: number) {
  const asset = Asset.fromModule(moduleRef);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  const data = await Skia.Data.fromURI(uri);
  if (!data) throw new Error('The card asset could not be read.');
  return data;
}

async function background() {
  if (cachedBackground) return cachedBackground;
  const image = Skia.Image.MakeImageFromEncoded(await dataFrom(require('../../assets/card/bg.png')));
  if (!image) throw new Error('The card background could not be decoded.');
  cachedBackground = image;
  return image;
}

async function typeface(weight: 'regular' | 'semibold' | 'bold') {
  const cached = cachedTypefaces.get(weight);
  if (cached) return cached;
  const moduleRef = weight === 'regular'
    ? require('@expo-google-fonts/sora/400Regular/Sora_400Regular.ttf')
    : weight === 'semibold'
      ? require('@expo-google-fonts/sora/600SemiBold/Sora_600SemiBold.ttf')
      : require('@expo-google-fonts/sora/700Bold/Sora_700Bold.ttf');
  const face = Skia.Typeface.MakeFreeTypeFaceFromData(await dataFrom(moduleRef));
  if (!face) throw new Error('The card typeface could not be loaded.');
  cachedTypefaces.set(weight, face);
  return face;
}

function widthOf(font: SkFont, text: string, tracking = 0) {
  return font.measureText(text).width + tracking * Math.max(0, text.length - 1);
}

// Letters are drawn one at a time only where the design asks for tracking;
// Skia has no letter-spacing of its own.
function drawRun(canvas: SkCanvas, text: string, x: number, y: number, font: SkFont, paint: SkPaint, tracking: number) {
  if (tracking === 0) {
    canvas.drawText(text, x, y, paint, font);
    return;
  }
  let cursor = x;
  for (const character of text) {
    canvas.drawText(character, cursor, y, paint, font);
    cursor += font.measureText(character).width + tracking;
  }
}

// The pressed-into-glass look: a dark copy down-left, a mint copy up-right,
// then the metal face on top. The direction is not decoration — the ring on
// the right is the light source in the scene, so the rim light has to fall on
// the right of every letter, or the whole picture reads as a sticker.
function drawEmbossed(
  canvas: SkCanvas,
  text: string,
  x: number,
  y: number,
  font: SkFont,
  options: { tracking?: number; flat?: number; gradient?: boolean } = {},
) {
  const tracking = options.tracking ?? 0;
  const size = font.getSize();

  const shadow = Skia.Paint();
  shadow.setColor(SHADOW);
  shadow.setAntiAlias(true);
  drawRun(canvas, text, x - 3, y + 3, font, shadow, tracking);

  const rim = Skia.Paint();
  rim.setColor(RIM);
  rim.setAntiAlias(true);
  drawRun(canvas, text, x + 2, y - 2, font, rim, tracking);

  const face = Skia.Paint();
  face.setAntiAlias(true);
  if (options.gradient) {
    // Brushed steel: bright at the top, a light band across the middle where
    // the bevel catches the ring, dark at the foot.
    face.setShader(Skia.Shader.MakeLinearGradient(
      { x, y: y - size },
      { x, y: y + size * 0.22 },
      [Skia.Color('#F7FCFF'), Skia.Color('#DCEAF0'), Skia.Color('#9FBDC7'), Skia.Color('#EAF6FA'), Skia.Color('#7E9BA6')],
      [0, 0.26, 0.52, 0.62, 1],
      TileMode.Clamp,
    ));
  } else {
    face.setColor(Skia.Color(`rgba(251, 250, 245, ${options.flat ?? 1})`));
  }
  drawRun(canvas, text, x, y, font, face, tracking);
}

function grouped(amount: number) {
  return Math.round(amount).toLocaleString('en-US').replace(/,/g, ' ');
}

function formatDate(seconds: number) {
  return new Date(seconds * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export async function renderStakerCard(facts: CardFacts): Promise<string> {
  const surface = Skia.Surface.MakeOffscreen(OUT_WIDTH, OUT_HEIGHT);
  if (!surface) throw new Error('This phone could not open a drawing surface.');
  const canvas = surface.getCanvas();

  const image = await background();
  const [regular, semibold, bold] = await Promise.all([
    typeface('regular'), typeface('semibold'), typeface('bold'),
  ]);

  canvas.save();
  canvas.scale(OUT_WIDTH / ART_WIDTH, OUT_HEIGHT / ART_HEIGHT);

  canvas.drawImageRectOptions(
    image,
    { x: 0, y: 0, width: image.width(), height: image.height() },
    { x: 0, y: 0, width: ART_WIDTH, height: ART_HEIGHT },
    FilterMode.Linear,
    MipmapMode.Linear,
  );

  drawEmbossed(canvas, 'SKR STAKER', TEXT_LEFT, 165, Skia.Font(semibold, 19), { tracking: 6, flat: 0.62 });

  // The name is the hero. A wallet with no .skr name shows its short address
  // here instead; that is longer and reads as machine text, so it is set a
  // size down to keep the line clear of the ring.
  const isAddress = facts.name.includes('…');
  const nameFont = Skia.Font(semibold, isAddress ? 56 : 78);
  drawEmbossed(canvas, facts.name, TEXT_LEFT, 253, nameFont, { gradient: true });

  if (facts.days != null) {
    const daysFont = Skia.Font(bold, 64);
    const daysText = `${facts.exactDays ? '' : '≥'}${facts.days}`;
    drawEmbossed(canvas, daysText, TEXT_LEFT, 345, daysFont, { gradient: true });
    drawEmbossed(canvas, 'days in stake', TEXT_LEFT + widthOf(daysFont, daysText) + 16, 345, Skia.Font(regular, 25), { flat: 0.8 });
  }

  // No "never unstaked" badge. The chain does not prove it at a price worth
  // paying: the field that looked like proof means "an unstake is running
  // right now", so the badge would have gone to people who left and came back.
  const parts: string[] = [];
  if (facts.networkPositions != null) parts.push(`One of ${grouped(facts.networkPositions)}`);
  if (facts.firstSeenAt != null) parts.push(`staking since ${formatDate(facts.firstSeenAt)}`);
  if (parts.length > 0) {
    drawEmbossed(canvas, parts.join(' · '), TEXT_LEFT, 412, Skia.Font(regular, 24), { flat: 0.86 });
  }

  if (facts.positionSkr != null) {
    drawEmbossed(canvas, `Position ${grouped(facts.positionSkr)} SKR`, 545, 668, Skia.Font(regular, 20), { flat: 0.72 });
  }

  const brandFont = Skia.Font(semibold, 22);
  const siteFont = Skia.Font(regular, 17);
  const rightEdge = ART_WIDTH - 262;
  drawEmbossed(canvas, 'SKR EYES', rightEdge - widthOf(brandFont, 'SKR EYES', 5), 674, brandFont, { tracking: 5, flat: 0.92 });
  drawEmbossed(canvas, 'skr.alexkosa.dev', rightEdge - widthOf(siteFont, 'skr.alexkosa.dev'), 704, siteFont, { flat: 0.62 });

  canvas.restore();

  const snapshot = surface.makeImageSnapshot();
  const base64 = snapshot.encodeToBase64(ImageFormat.PNG, 100);

  const file = new File(Paths.cache, `skr-eyes-card-${Date.now()}.png`);
  if (file.exists) file.delete();
  file.create();
  file.write(base64, { encoding: 'base64' });
  return file.uri;
}

export async function shareStakerCard(facts: CardFacts) {
  const uri = await renderStakerCard(facts);
  if (!(await Sharing.isAvailableAsync())) throw new Error('This phone has nothing to share with.');
  await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Your SKR staker card' });
  return uri;
}
