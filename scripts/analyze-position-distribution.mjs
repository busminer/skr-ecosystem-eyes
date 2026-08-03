const root = process.env.APP_ROOT || '/opt/skr-ecosystem-eyes-current';
const { SolanaRpc } = await import(`file://${root}/src/rpc.js`);
const { decodeStakeConfig, sharesToRawTokens } = await import(`file://${root}/src/decoder.js`);
const { parseUserStakeSlice } = await import(`file://${root}/src/metrics.js`);
const rpc = new SolanaRpc();
const [core, scan] = await Promise.all([rpc.getCoreInputs(), rpc.getUserStakeAccounts()]);
const config = decodeStakeConfig(core.configData);
const now = Math.floor(Date.now() / 1000);
const tokenScale = 1_000_000n;
const amount = (raw) => Number(raw / tokenScale) + Number(raw % tokenScale) / Number(tokenScale);
const positions = scan.accounts
  .map((entry) => parseUserStakeSlice(entry, config.cooldownSeconds, now))
  .filter(Boolean)
  .map((position) => ({
    active: amount(sharesToRawTokens(position.shares, config.sharePriceRaw)),
    pending: amount(position.pendingRaw),
  }));

function stats(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (point) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * point) - 1)] : null;
  return { count: sorted.length, p50: at(.5), p90: at(.9), p99: at(.99), p99_5: at(.995), p99_9: at(.999), p99_95: at(.9995), max: sorted.at(-1) ?? null };
}

console.log(JSON.stringify({
  commitment: 'finalized',
  slot: scan.slot,
  pageCount: scan.pageCount,
  paginated: scan.paginated,
  accounts: positions.length,
  active: stats(positions.filter((item) => item.active > 0).map((item) => item.active)),
  pending: stats(positions.filter((item) => item.pending > 0).map((item) => item.pending)),
}, null, 2));
