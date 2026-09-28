import type { EyePrices } from './api';

// What an Eye costs, in the words a person reads: SOL, with as few places
// as the number needs and never fewer than two figures that mean something.
// No dollars anywhere on screen (Alex, 28.09): the server already works the
// mint out as a dollar in SOL, and the app shows the SOL and says who gets
// each part of it.

// The storage the wallet pays the chain when the Eye is born, measured on
// mainnet on 27.09.2026 (3,648,840 lamports) and rounded up. Used only when
// the server does not say it itself.
export const OPEN_RENT_FALLBACK = 3_700_000;
// A Blink every eight hours, unless the server says otherwise.
export const BLINK_COOLDOWN_FALLBACK = 8 * 3_600;

// 0.008, 0.0085, 0.0117, 0.00042: as many places as it takes to show two
// figures that mean something, never a trailing zero.
export function sol(lamports: number): string {
  const value = lamports / 1_000_000_000;
  const places = value >= 0.1 ? 3 : value >= 0.01 ? 4 : value >= 0.001 ? 5 : 6;
  return value.toFixed(places).replace(/0+$/, '').replace(/\.$/, '');
}

export const rentOf = (prices: EyePrices | null | undefined) => prices?.openRentLamports ?? OPEN_RENT_FALLBACK;
export const cooldownHours = (prices: EyePrices | null | undefined, seconds?: number | null) =>
  Math.round((seconds ?? prices?.blinkCooldownSeconds ?? BLINK_COOLDOWN_FALLBACK) / 3_600);

// How many Eyes are still sold at the current price, for the next serial.
export function leftAtPrice(prices: EyePrices | null | undefined, nextSerial: number | null): number | null {
  const tier = prices?.tier;
  if (!tier) return null;
  if (typeof tier.left === 'number') return tier.left;
  if (nextSerial == null) return null;
  return Math.max(0, tier.serial - nextSerial + 1);
}
