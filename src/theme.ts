// Visual language for the SKR Eyes lab build.
// One accent, one metal, three state colours. Everything else is grey.
//
// 1.3 — light instead of borders.
//
// Until now every block on every screen was the same thing: a #0A1017
// rectangle with a #15212C outline, radius 14. Twelve of them down a screen
// and nothing was more important than anything else, because an outline can
// only say "here is an edge" — it cannot say "this one matters".
//
// So the panels stop being outlined and start being lit: a hair of light
// along the top edge where a real surface would catch it, and a border dark
// enough to be a shadow rather than a line. On an OLED panel in a dark room
// that reads as depth. It costs one View per panel and no frames per second.
export const colors = {
  bg: '#04070B',
  panel: '#0A1017',
  panelHi: '#0E1721',
  // Recessed: a row that sits *inside* a panel, darker than the panel and
  // darker than the screen. Gives a second level without a second border.
  inset: '#070C12',
  line: '#15212C',
  lineStrong: '#22323F',
  // The lit edge. Never a fill, never text — only the one-pixel highlight
  // along the top of a raised surface.
  sheen: 'rgba(214, 238, 255, 0.055)',
  text: '#F2F7FB',
  muted: '#8296A8',
  // Was #54677A, which on this background measures about 4:1 — under the bar
  // for the 11 to 12 px type it was mostly used for. Alex reads the phone at a
  // large system font on a lit desk; a label he has to lean into is a label we
  // may as well not have drawn.
  faint: '#6F849A',
  // What #54677A became: decoration only. Hairline separators, a dot that is
  // not a state, the tail of a rail. Never a word anybody has to read.
  dim: '#46586B',
  accent: '#56E0FF',
  accentDim: '#1E4E63',
  // Accent at a whisper, for the fill behind a selected control. Reads as the
  // accent without spending it.
  accentWash: 'rgba(86, 224, 255, 0.10)',
  metal: '#C9A96A',
  metalDim: '#4A3E27',
  metalWash: 'rgba(201, 169, 106, 0.12)',
  positive: '#7CF0BC',
  negative: '#FF7E79',
  pending: '#FFC46B',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 22, xxl: 30 } as const;

// Three families, deliberately far enough apart that a button can never be
// mistaken for a card. They used to share radius 14 and did exactly that.
export const radius = { inner: 10, button: 12, card: 16, sheet: 20, pill: 999 } as const;

export const font = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
  black: 'Geist_900Black',
  mono: 'GeistMono_400Regular',
  monoSemibold: 'GeistMono_600SemiBold',
  monoBold: 'GeistMono_700Bold',
  monoBlack: 'GeistMono_900Black',
} as const;

// A Seeker ID is the one thing on these screens that belongs to a person, so
// it gets the one treatment nothing else may use: struck into the metal.
// A dark shadow a hair below the letters and a gold that is warm rather than
// bright — on this near-black background that reads as depth, not as glow.
export const gold = {
  color: colors.metal,
  textShadowColor: 'rgba(0, 0, 0, 0.9)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 2.5,
  letterSpacing: 0.2,
} as const;

export const type = {
  hero: { fontSize: 46, lineHeight: 50, letterSpacing: -2 },
  heroSmall: { fontSize: 34, lineHeight: 38, letterSpacing: -1.2 },
  tile: { fontSize: 21, lineHeight: 26, letterSpacing: -0.6 },
  // The number a panel is actually about, when it is not the screen's hero.
  figure: { fontSize: 20, lineHeight: 24, letterSpacing: -0.5 },
  body: { fontSize: 14, lineHeight: 21 },
  small: { fontSize: 12.5, lineHeight: 18 },
  micro: { fontSize: 11.5, lineHeight: 17 },
  eyebrow: { fontSize: 11, lineHeight: 15, letterSpacing: 1.1 },
} as const;

// Every number on these screens is read, not skimmed: a figure that changes
// must not shift the ones beside it. One import instead of the same two lines
// repeated in nine StyleSheets.
export const numeric = { fontVariant: ['tabular-nums'] as const } as const;
