import { PixelRatio } from 'react-native';

// Room for large type. A person who enlarged the system font gets their
// words at that size, every one of them; what gives way is the picture,
// which shrinks before the text does. Android 14 scales large text
// non-linearly, so this reads the phone's own factor rather than guessing.

export const fontScale = () => Math.max(1, PixelRatio.getFontScale());

// Past this the pages say less and draw smaller: the words keep their size,
// the pictures give way, and lines that only repeat the body are dropped.
export const isBig = () => fontScale() >= 1.2;

// A number between two bounds.
export const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

// A picture's size at this font scale: the base, divided by the enlargement
// softened a little, never under `floor`.
export const artSize = (base: number, floor: number) => Math.max(floor, Math.round(base / Math.pow(fontScale(), 0.85)));
