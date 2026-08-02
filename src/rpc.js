import { DEFAULT_RPC_URL, MINT, PROGRAM_ID, STAKE_CONFIG, STAKE_VAULT } from './constants.js';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class SolanaRpc {
  constructor(
    url = process.env.SOLANA_RPC_URL || DEFAULT_RPC_URL,
    scanUrl = process.env.SOLANA_RPC_SCAN_URL || url,
  ) {
    this.url = url;
    this.scanUrl = scanUrl;
    this.id = 0;
    this.minimumInterval = Number(process.env.RPC_MIN_INTERVAL_MS || 250);
    this.lastCallAt = 0;
    this.queue = Promise.resolve();
  }

  call(method, params = [], attempts = 4, url = this.url) {
    const task = this.queue.then(() => this.execute(method, params, attempts, url));
    this.queue = task.catch(() => {});
    return task;
  }

  async execute(method, params, attempts, url = this.url) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const wait = Math.max(0, this.minimumInterval - (Date.now() - this.lastCallAt));
        if (wait) await sleep(wait);
        this.lastCallAt = Date.now();
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
        const payload = await response.json();
        if (payload.error) throw new Error(`RPC ${payload.error.code}: ${payload.error.message}`);
        return payload.result;
      } catch (error) {
        lastError = error;
        if (attempt + 1 < attempts) await sleep(1_000 * 2 ** attempt);
      }
    }
    throw lastError;
  }

  async getCoreInputs() {
    const [config, vault, supply] = await Promise.all([
      this.call('getAccountInfo', [STAKE_CONFIG, { encoding: 'base64', commitment: 'finalized' }]),
      this.call('getTokenAccountBalance', [STAKE_VAULT, { commitment: 'finalized' }]),
      this.call('getTokenSupply', [MINT, { commitment: 'finalized' }]),
    ]);
    if (!config?.value?.data?.[0]) throw new Error('StakeConfig account was not returned');
    return {
      configData: Buffer.from(config.value.data[0], 'base64'),
      vaultRaw: BigInt(vault.value.amount),
      supplyRaw: BigInt(supply.value.amount),
      sourceSlots: {
        stakeConfig: config.context?.slot ?? null,
        stakeVault: vault.context?.slot ?? null,
        mint: supply.context?.slot ?? null,
      },
    };
  }

  async getUserStakeAccounts() {
    const accounts = [];
    const seenPageKeys = new Set();
    const configuredMaxPages = Number(process.env.RPC_MAX_PAGES || 1_000);
    const maxPages = Number.isSafeInteger(configuredMaxPages) && configuredMaxPages > 0
      ? configuredMaxPages
      : 1_000;
    let pageKey = null;
    let pageCount = 0;
    let slot = null;

    do {
      const config = {
        encoding: 'base64',
        commitment: 'finalized',
        withContext: true,
        filters: [{ dataSize: 169 }],
        dataSlice: { offset: 41, length: 128 },
      };
      if (pageKey) config.pageKey = pageKey;

      const snapshot = await this.call('getProgramAccounts', [PROGRAM_ID, config], 3, this.scanUrl);
      pageCount += 1;

      // Standard Solana RPC returns one array and does not expose pagination.
      if (Array.isArray(snapshot)) {
        accounts.push(...snapshot);
        break;
      }

      accounts.push(...(snapshot?.value || []));
      slot ??= snapshot?.context?.slot ?? null;

      const nextPageKey = snapshot?.pageKey || null;
      if (!nextPageKey) break;
      if (seenPageKeys.has(nextPageKey)) {
        throw new Error(`RPC repeated getProgramAccounts pageKey: ${nextPageKey}`);
      }
      if (pageCount >= maxPages) {
        throw new Error(`RPC getProgramAccounts exceeded ${maxPages} pages`);
      }

      seenPageKeys.add(nextPageKey);
      pageKey = nextPageKey;
    } while (pageKey);

    return { accounts, slot, pageCount, paginated: pageCount > 1 };
  }

  getRecentSignatures(limit = 50) {
    return this.call('getSignaturesForAddress', [PROGRAM_ID, { limit, commitment: 'finalized' }]);
  }

  getTransaction(signature) {
    return this.call('getTransaction', [signature, {
      encoding: 'json',
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    }]);
  }
}
