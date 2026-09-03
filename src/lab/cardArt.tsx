import { forwardRef, useImperativeHandle, useRef } from 'react';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Image as SvgImage,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
  TSpan,
} from 'react-native-svg';

// The staker card: one drawing, used at two sizes.
//
// The same component is what the Me tab shows and what gets exported for X.
// Two drawings would drift — a tweak to the card in the app would quietly stop
// matching the picture people post — so there is only ever one, and the size it
// is asked for is the only difference between the two.
//
// Drawn with react-native-svg, which is already compiled into this app for the
// charts. Skia was the obvious candidate — it sits in package.json — but it is
// deliberately excluded from autolinking and has been since 1.0.0: its native
// library is 59 MB for a single architecture, against 40 MB for the whole
// released app. This costs nothing extra.

// The background was generated at 1672x941 and every coordinate here is in that
// space. The viewBox maps it onto whatever size the card is drawn at, so the
// layout is written once and never recomputed.
export const ART_WIDTH = 1672;
export const ART_HEIGHT = 941;

// 1600x900 is what X shows in the timeline.
export const EXPORT_WIDTH = 1600;
export const EXPORT_HEIGHT = 900;

// Two ways of framing the same drawing.
//
// The export keeps the whole canvas, because 1600x900 is the shape X reserves
// in the timeline, and anything else gets cropped by the timeline rather than
// by us. On the phone that shape wastes a third of the width on the empty air
// the generator left around the object, so the screen gets a window that hugs
// the object: its body runs x=174..1497, y=30..790, and the frame clears that
// by six units on each side with just enough below for the reflection to die
// out in.
//
// How big the card looks on the phone is decided entirely by this frame's
// width against the screen's. The card is a landscape object on a portrait
// screen, so once the frame hugs the body and the view runs edge to edge,
// that is the ceiling — there is no arrangement of a 1.7:1 object that fills
// three quarters of a 1:2.2 screen. Making it larger than this means a
// portrait background, not a different crop.
export type Frame = { x: number; y: number; width: number; height: number };
export const FULL_FRAME: Frame = { x: 0, y: 0, width: ART_WIDTH, height: ART_HEIGHT };
export const TIGHT_FRAME: Frame = { x: 168, y: 24, width: 1335, height: 838 };

export function frameRatio(frame: Frame) {
  return frame.height / frame.width;
}

// Where the object really is inside the canvas, measured off the cut-out asset
// rather than guessed: the body runs x=173..1498, y=49..792, and the reflection
// trails off below it to the bottom edge.
const BODY = { left: 173, top: 49, width: 1325, height: 743 };

// How the card is composed for a post.
//
// The picture is not simply the artwork with its white removed. Transparency is
// the wrong thing to hand a timeline: X flattens alpha against a colour of its
// own choosing, so the same file lands differently for different people, and
// the object floated in the raw canvas with 30 units of air above it and 150
// below — which reads as a mistake, not as a composition. So the post gets a
// backdrop we drew and a placement we chose: the body sits centred across the
// width with equal margins, a little above centre, and its reflection dissolves
// into the backdrop instead of being cut off by the edge of the file.
const POST = {
  bodyWidth: 1230,
  bodyTop: 82,
};
const POST_SCALE = POST.bodyWidth / BODY.width;
const POST_TX = (EXPORT_WIDTH - POST.bodyWidth) / 2 - BODY.left * POST_SCALE;
const POST_TY = POST.bodyTop - BODY.top * POST_SCALE;

// The calm part of the display. The notch takes the lower left, the portal ring
// takes everything right of x=950, so the text lives in the upper left corner
// and nowhere else.
const TEXT_LEFT = 272;

// Measured off the artwork, not guessed: the ring's bright band runs from
// x=959 to x=1385 and y=194 to y=633, which puts its middle here.
const RING = { x: 1170, y: 415, inner: 152 };

const BACKGROUND = require('../../assets/card/bg.png');

const SORA = { regular: 'Sora_400Regular', semibold: 'Sora_600SemiBold', bold: 'Sora_700Bold' };

export type CardFacts = {
  name: string;
  days: number | null;
  exactDays: boolean;
  firstSeenAt: number | null;
  positionSkr: number | null;
  networkPositions: number | null;
  // Two things the person may keep off a picture they post: who they are and
  // how much they hold. Asked for by @XPiritV and @baelor_sol, promised in
  // public. With the name hidden the eye in the ring closes — the card's own
  // way of saying "not showing", rather than an empty gap where a name was.
  hideName?: boolean;
  hideAmount?: boolean;
};

export type CardHandle = { toPng: () => Promise<string> };

function grouped(amount: number) {
  return Math.round(amount).toLocaleString('en-US').replace(/,/g, ' ');
}

function formatDate(seconds: number) {
  return new Date(seconds * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// The pressed-into-glass look: a dark copy down-left, a light copy up-right,
// then the face on top. The direction is not decoration — the ring on the right
// is the light source in this scene, so the rim light has to fall on the right
// of every letter, or the picture reads as a sticker laid over a photo.
//
// The offsets are smaller and fainter than the CSS study they came from. There
// the two copies were blurred drop-shadows; here they are hard copies of the
// glyphs, and at the study's values they read as double vision rather than as
// depth.
//
// Small text gets a halo as well: an offset shadow only darkens one side, which
// is enough on the calm upper left but not down by the ring, where the glyph
// has bright reflection on every side of it at once. The halo is a stroked copy
// of the same text drawn underneath the filled one — a real outline, so the
// letters keep their own weight instead of being fattened by a centred stroke.
function Embossed({ x, y, size, family, fill, opacity = 1, letterSpacing = 0, anchor = 'start', halo = 0, children }: {
  x: number;
  y: number;
  size: number;
  family: string;
  fill: string;
  opacity?: number;
  letterSpacing?: number;
  anchor?: 'start' | 'end';
  halo?: number;
  children: string;
}) {
  const common = { fontSize: size, fontFamily: family, letterSpacing, textAnchor: anchor } as const;
  return (
    <>
      <SvgText {...common} x={x - 2} y={y + 2} fill="#000A0E" fillOpacity={0.8}>{children}</SvgText>
      <SvgText {...common} x={x + 1} y={y - 1} fill="#C8FFF4" fillOpacity={0.22}>{children}</SvgText>
      {halo > 0 ? (
        <SvgText
          {...common}
          x={x}
          y={y}
          fill="none"
          stroke="#00141C"
          strokeOpacity={0.92}
          strokeWidth={halo}
          strokeLinejoin="round"
        >
          {children}
        </SvgText>
      ) : null}
      <SvgText {...common} x={x} y={y} fill={fill} fillOpacity={opacity}>{children}</SvgText>
    </>
  );
}

// Number and unit are one line with two runs rather than two lines placed side
// by side: SVG cannot be asked how wide a string came out, so the only way to
// butt them together is to let the text engine do it. The unit rides on `dx`,
// measured from wherever the number actually ended.
function DaysLine({ days, exact }: { days: number; exact: boolean }) {
  const count = `${exact ? '' : '≥'}${days}`;
  const pass = (dx: number, dy: number, fill: string, opacity: number, unitFill: string, unitOpacity: number) => (
    <SvgText x={TEXT_LEFT + dx} y={345 + dy} fontSize={64} fontFamily={SORA.bold} fill={fill} fillOpacity={opacity}>
      <TSpan>{count}</TSpan>
      <TSpan dx={16} fontSize={25} fontFamily={SORA.regular} fill={unitFill} fillOpacity={unitOpacity}>days in stake</TSpan>
    </SvgText>
  );
  return (
    <>
      {pass(-2, 2, '#000A0E', 0.8, '#000A0E', 0.8)}
      {pass(1, -1, '#C8FFF4', 0.22, '#C8FFF4', 0.22)}
      {pass(0, 0, 'url(#steel)', 1, '#FBFAF5', 0.8)}
    </>
  );
}

// Our mark, looking out of the portal.
//
// Only the iris goes inside the ring, not the whole Split Lens mark: the ring
// is already an eye-shaped opening, and putting the almond outline inside it
// puts one eye shape inside another, where they cut each other up. Here the
// ring itself does the work of the lid and the gold does the work of the iris.
function EyeInRing({ closed = false }: { closed?: boolean }) {
  if (closed) {
    // The lids meet in the middle: a lens with nothing looking out of it and a
    // fine seam where the two halves touch. Deliberate, not missing.
    return (
      <>
        <Circle cx={RING.x} cy={RING.y} r={RING.inner} fill="url(#lens)" stroke="#3A5B68" strokeWidth={9} />
        <Circle cx={RING.x} cy={RING.y} r={RING.inner - 6} fill="#111A20" fillOpacity={0.96} />
        <Circle cx={RING.x} cy={RING.y} r={RING.inner} fill="url(#litByRing)" />
        <Rect x={RING.x - RING.inner + 22} y={RING.y - 3} width={RING.inner * 2 - 44} height={6} rx={3} fill="#2B3B45" />
        <Rect x={RING.x - RING.inner + 22} y={RING.y - 6} width={RING.inner * 2 - 44} height={3} rx={1.5} fill="#000A0E" fillOpacity={0.7} />
      </>
    );
  }
  return (
    <>
      <Circle cx={RING.x} cy={RING.y} r={RING.inner} fill="url(#lens)" stroke="#3A5B68" strokeWidth={9} />
      <Circle cx={RING.x} cy={RING.y} r={RING.inner} fill="url(#litByRing)" />
      <Circle cx={RING.x} cy={RING.y} r={78} fill="url(#iris)" />
      <Circle cx={RING.x} cy={RING.y} r={33} fill="#020304" />
      <Circle cx={RING.x - 31} cy={RING.y - 35} r={16} fill="#F4FBFD" fillOpacity={0.92} />
      <Circle cx={RING.x + 28} cy={RING.y + 43} r={7} fill="#9DFFE0" fillOpacity={0.55} />
    </>
  );
}

export const CardArt = forwardRef<CardHandle, { facts: CardFacts; width: number; frame?: Frame; post?: boolean }>(
  function CardArt({ facts, width, frame = FULL_FRAME, post = false }, ref) {
    const svg = useRef<Svg>(null);

    useImperativeHandle(ref, () => ({
      toPng: () => new Promise<string>((resolve, reject) => {
        const node = svg.current as unknown as { toDataURL?: (cb: (base64: string) => void, options?: object) => void } | null;
        if (!node?.toDataURL) {
          reject(new Error('This phone could not export the card.'));
          return;
        }
        const timer = setTimeout(() => reject(new Error('The card took too long to draw.')), 15_000);
        node.toDataURL((base64) => {
          clearTimeout(timer);
          if (base64) resolve(base64);
          else reject(new Error('The card came back empty.'));
        }, { width: EXPORT_WIDTH, height: EXPORT_HEIGHT });
      }),
    }), []);

    const shownName = facts.hideName ? 'A Seeker' : facts.name;
    const isAddress = !facts.hideName && facts.name.includes('…');

    const line: string[] = [];
    if (facts.networkPositions != null) line.push(`One of ${grouped(facts.networkPositions)}`);
    if (facts.firstSeenAt != null) line.push(`staking since ${formatDate(facts.firstSeenAt)}`);

    return (
      <Svg
        ref={svg}
        width={width}
        height={post ? Math.round(width * (EXPORT_HEIGHT / EXPORT_WIDTH)) : Math.round(width * frameRatio(frame))}
        viewBox={post ? `0 0 ${EXPORT_WIDTH} ${EXPORT_HEIGHT}` : `${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
      >
        <Defs>
          {/* Brushed steel: bright at the top, a light band across the middle
              where the bevel catches the ring, dark at the foot. */}
          <LinearGradient id="steel" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#F7FCFF" />
            <Stop offset="0.26" stopColor="#DCEAF0" />
            <Stop offset="0.52" stopColor="#9FBDC7" />
            <Stop offset="0.62" stopColor="#EAF6FA" />
            <Stop offset="1" stopColor="#7E9BA6" />
          </LinearGradient>
          <RadialGradient id="lens" cx="0.34" cy="0.3" r="0.72">
            <Stop offset="0" stopColor="#4F7584" />
            <Stop offset="0.16" stopColor="#203B46" />
            <Stop offset="0.52" stopColor="#081116" />
            <Stop offset="1" stopColor="#010203" />
          </RadialGradient>
          <RadialGradient id="iris" cx="0.42" cy="0.38" r="0.68">
            <Stop offset="0" stopColor="#F0D898" />
            <Stop offset="0.4" stopColor="#D6B56A" />
            <Stop offset="0.75" stopColor="#745625" />
            <Stop offset="1" stopColor="#211707" />
          </RadialGradient>
          {/* The ring is the only light in the scene, so the eye has to catch
              it around its rim or it looks pasted in front rather than set
              inside. */}
          <RadialGradient id="litByRing" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0.72" stopColor="#9DFFE0" stopOpacity="0" />
            <Stop offset="1" stopColor="#9DFFE0" stopOpacity="0.55" />
          </RadialGradient>
          {/* The backdrop for a post. Near-black rather than black: a true
              black would make the card's own bezel disappear into it, and the
              object has to sit in a room, not in a void. */}
          <LinearGradient id="room" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#06070A" />
            <Stop offset="0.55" stopColor="#0A0C10" />
            <Stop offset="1" stopColor="#0E1116" />
          </LinearGradient>
          <RadialGradient id="spill" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#4FE3C4" stopOpacity="0.16" />
            <Stop offset="0.55" stopColor="#2A8F9B" stopOpacity="0.06" />
            <Stop offset="1" stopColor="#2A8F9B" stopOpacity="0" />
          </RadialGradient>
          {/* The reflection runs past the bottom of the file. Rather than let
              the edge chop it, the backdrop is drawn back over it so it dies
              out on its own. */}
          <LinearGradient id="dissolve" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#0C0F14" stopOpacity="0" />
            <Stop offset="0.62" stopColor="#0D1015" stopOpacity="0.72" />
            <Stop offset="1" stopColor="#0E1116" stopOpacity="1" />
          </LinearGradient>
        </Defs>

        {post ? (
          <>
            <Rect x={0} y={0} width={EXPORT_WIDTH} height={EXPORT_HEIGHT} fill="url(#room)" />
            {/* The ring is the only light in the picture, so it has to spill
                onto the room behind the card. Without this the card reads as a
                cut-out pasted on a dark rectangle, which is exactly what it
                would be. */}
            <Ellipse
              cx={POST_TX + RING.x * POST_SCALE}
              cy={POST_TY + RING.y * POST_SCALE}
              rx={620}
              ry={520}
              fill="url(#spill)"
            />
          </>
        ) : null}

        <G transform={post ? `translate(${POST_TX} ${POST_TY}) scale(${POST_SCALE})` : undefined}>
        <SvgImage href={BACKGROUND} x={0} y={0} width={ART_WIDTH} height={ART_HEIGHT} preserveAspectRatio="xMidYMid meet" />

        <EyeInRing closed={facts.hideName} />

        <Embossed x={TEXT_LEFT} y={165} size={19} family={SORA.semibold} fill="#FBFAF5" opacity={0.7} letterSpacing={6} halo={4}>
          SKR STAKER
        </Embossed>

        {/* The name is the hero. A wallet with no .skr name shows its short
            address here instead; that is longer and reads as machine text, so
            it is set a size down to keep the line clear of the ring. */}
        <Embossed x={TEXT_LEFT} y={253} size={isAddress ? 56 : 78} family={SORA.semibold} fill="url(#steel)" opacity={facts.hideName ? 0.82 : 1}>
          {shownName}
        </Embossed>

        {facts.days != null ? <DaysLine days={facts.days} exact={facts.exactDays} /> : null}

        {/* No "never unstaked" badge. The chain does not prove it at a price
            worth paying: the field that looked like proof means "an unstake is
            running right now", so the badge would have gone to people who left
            and came back. */}
        {line.length > 0 ? (
          <Embossed x={TEXT_LEFT} y={412} size={24} family={SORA.regular} fill="#FBFAF5" opacity={0.92} halo={4}>
            {line.join(' · ')}
          </Embossed>
        ) : null}

        {facts.positionSkr != null && !facts.hideAmount ? (
          <Embossed x={545} y={668} size={20} family={SORA.regular} fill="#FBFAF5" opacity={0.9} halo={5}>
            {`Position ${grouped(facts.positionSkr)} SKR`}
          </Embossed>
        ) : null}

        <Embossed x={ART_WIDTH - 262} y={674} size={22} family={SORA.semibold} fill="#FBFAF5" opacity={1} letterSpacing={5} anchor="end" halo={6}>
          SKR EYES
        </Embossed>
        {/* The smallest thing on the card and the one sitting closest to the
            ring's own glow, so it carries the heaviest halo and no dimming at
            all. It is also the only part that has a job after the picture
            leaves us: it is how somebody finds this. */}
        <Embossed x={ART_WIDTH - 262} y={706} size={19} family={SORA.semibold} fill="#FBFAF5" opacity={0.96} anchor="end" halo={6}>
          skr.alexkosa.dev
        </Embossed>
        </G>

        {post ? (
          <Rect x={0} y={EXPORT_HEIGHT - 160} width={EXPORT_WIDTH} height={160} fill="url(#dissolve)" />
        ) : null}
      </Svg>
    );
  },
);
