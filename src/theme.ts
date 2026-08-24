// Visual language for the SKR Eyes lab build.
// One accent, one metal, three state colours. Everything else is grey.
export const colors = {
  bg: '#04070B',
  panel: '#0A1017',
  panelHi: '#0E1721',
  line: '#15212C',
  lineStrong: '#22323F',
  text: '#F2F7FB',
  muted: '#8296A8',
  faint: '#54677A',
  accent: '#56E0FF',
  accentDim: '#1E4E63',
  metal: '#C9A96A',
  metalDim: '#4A3E27',
  positive: '#7CF0BC',
  negative: '#FF7E79',
  pending: '#FFC46B',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 22, xxl: 30 } as const;
export const radius = { inner: 10, card: 14, pill: 999 } as const;

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

export const type = {
  hero: { fontSize: 46, lineHeight: 50, letterSpacing: -2 },
  heroSmall: { fontSize: 34, lineHeight: 38, letterSpacing: -1.2 },
  tile: { fontSize: 21, lineHeight: 26, letterSpacing: -0.6 },
  body: { fontSize: 14, lineHeight: 21 },
  small: { fontSize: 12.5, lineHeight: 18 },
  micro: { fontSize: 11.5, lineHeight: 17 },
  eyebrow: { fontSize: 11, lineHeight: 15, letterSpacing: 1.1 },
} as const;
