import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

// One share that carries the picture and the caption together.
//
// Android only: on any other platform this is absent and the caller falls back
// to expo-sharing plus the clipboard. The app ships to the Solana dApp Store,
// so Android is the only platform that exists for it today, but the fallback
// keeps the card working anywhere the app is opened during development.
type SkrShareModule = {
  shareImageWithText: (fileUri: string, text: string, dialogTitle: string) => Promise<void>;
};

let cached: SkrShareModule | null | undefined;

export function getSkrShare(): SkrShareModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== 'android') {
    cached = null;
    return cached;
  }
  try {
    cached = requireNativeModule<SkrShareModule>('SkrShare');
  } catch {
    // An older build of the app without this module in it. The caller shares
    // the picture the long way round rather than failing.
    cached = null;
  }
  return cached;
}
