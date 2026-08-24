import { API_BASE_URL } from '../api';

// How long a position has been staked.
//
// The UserStake account keeps no creation time — its only timestamp is the
// moment an unstake was requested — but the chain remembers every signature
// that touched the account, and the oldest one is the first stake.
//
// Walking that history from a phone is unreliable: public RPC throttles it on
// mobile networks, and a busy position needs several pages. So the server does
// the walk with its own provider and remembers the date, and the phone simply
// asks for the answer.

const TIMEOUT_MS = 20_000;

export type PositionAge = {
  stakeAccount: string;
  firstSeenAt: number | null;
  days: number | null;
  signature: string | null;
  // False means the walk stopped early: the position is at least this old.
  exact: boolean;
};

export async function fetchPositionAge(stakeAccount: string): Promise<PositionAge> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}/api/position/${encodeURIComponent(stakeAccount)}/age`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`The age service answered ${response.status}`);
    return await response.json() as PositionAge;
  } finally {
    clearTimeout(timer);
  }
}

// A wallet can hold several positions. The one it has held longest is the one
// worth showing on the card.
export async function fetchWalletAge(stakeAccounts: string[], onPartial?: (age: PositionAge) => void): Promise<PositionAge | null> {
  const candidates = stakeAccounts.slice(0, 3);
  if (candidates.length === 0) return null;

  const failures: string[] = [];
  const results = await Promise.all(candidates.map(async (account) => {
    try {
      const age = await fetchPositionAge(account);
      if (age.firstSeenAt) onPartial?.(age);
      return age;
    } catch (caught) {
      failures.push(caught instanceof Error ? caught.message : String(caught));
      return null;
    }
  }));

  const dated = results.filter((result): result is PositionAge => Boolean(result?.firstSeenAt));
  // Silence would look like "no history"; a refusal has to say so.
  if (dated.length === 0 && failures.length > 0) throw new Error(failures[0]);
  if (dated.length === 0) return null;
  return dated.reduce((oldest, current) => (current.firstSeenAt! < oldest.firstSeenAt! ? current : oldest));
}
