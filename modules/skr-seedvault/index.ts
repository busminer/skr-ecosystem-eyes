import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

// The Seed Vault side of deferred staking.
//
// A wallet signs and sends in one motion, so a part meant for the afternoon
// would leave the moment it was approved. Seed Vault signs and hands the bytes
// back, which is the only way a schedule can exist without anyone holding the
// person's signatures but the person's own phone.
//
// Two facts measured on a Seeker shape everything above this module:
//   - a batch costs one fingerprint, not one per transaction;
//   - the batch is capped, and on vault 1.1.1 the cap is three.
// So a day is approved in groups of three, and `limits()` is asked rather than
// assumed, because a later vault may allow more.

export type SeedVaultAccount = {
  derivationPath: string;
  address: string;
  name: string;
  isUserWallet: boolean;
};

export type SeedVaultLimits = {
  maxSigningRequests: number;
  maxRequestedSignatures: number;
};

type SkrSeedVaultModule = {
  isAvailable: () => boolean;
  hasPermission: () => boolean;
  requestPermission: () => Promise<boolean>;
  limits: () => SeedVaultLimits;
  authorizedSeeds: () => { authToken: string; name: string }[];
  authorize: () => Promise<string>;
  deauthorize: (authToken: string) => void;
  accounts: (authToken: string) => SeedVaultAccount[];
  signMessages: (authToken: string, derivationPath: string, payloadsBase64: string[]) => Promise<string[]>;
};

let cached: SkrSeedVaultModule | null | undefined;

export function getSeedVault(): SkrSeedVaultModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== 'android') {
    cached = null;
    return cached;
  }
  try {
    cached = requireNativeModule<SkrSeedVaultModule>('SkrSeedVault');
  } catch {
    // An older build without the module compiled in. The caller falls back to
    // the wallet, which can still stake — just not on a schedule.
    cached = null;
  }
  return cached;
}

/**
 * Whether this phone can hold a schedule at all: the vault must be present and
 * must have let us in. A Seeker whose owner keeps their keys in Phantom answers
 * no here, and the app offers plain staking instead of pretending.
 */
export function seedVaultUsable(): boolean {
  const vault = getSeedVault();
  if (!vault) return false;
  try {
    return vault.isAvailable();
  } catch {
    return false;
  }
}
