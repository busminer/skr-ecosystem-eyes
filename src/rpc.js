import { DEFAULT_RPC_URL, MINT, PROGRAM_ID, STAKE_CONFIG, STAKE_VAULT } from './constants.js';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function parseFallbackUrls(value, primaryUrl) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item, index, items) => item && item !== primaryUrl && items.indexOf(item) === index);
}

function normalizeBatchedTransaction(entry) {
  const wrapped = entry?.transaction?.transaction && entry?.transaction?.meta
    ? entry.transaction
    : null;
  const transaction = wrapped || (entry?.transaction && entry?.meta
    ? {
        slot: entry.slot,
        blockTime: entry.blockTime,
        meta: entry.meta,
        transaction: entry.transaction,
      }
    : entry);
  const signature = entry?.signature
    || transaction?.transaction?.signatures?.[0]
    || null;

  if (!signature || !transaction?.transaction || !transaction?.meta) {
    throw new Error('RPC getTransactionsForAddress returned an invalid full transaction');
  }

  return {
    signature,
    err: transaction.meta.err ?? entry?.err ?? null,
    blockTime: transaction.blockTime ?? entry?.blockTime ?? null,
    transaction,
  };
}

export class SolanaRpc {
  constructor(
    url = process.env.SOLANA_RPC_URL || DEFAULT_RPC_URL,
    scanUrl = process.env.SOLANA_RPC_SCAN_URL || url,
    fallbackUrls = process.env.SOLANA_RPC_FALLBACK_URLS || process.env.SOLANA_RPC_FALLBACK_URL || '',
  ) {
    this.url = url;
    this.scanUrl = scanUrl;
    this.fallbackUrls = parseFallbackUrls(fallbackUrls, url);
    this.id = 0;
    this.minimumInterval = Number(process.env.RPC_MIN_INTERVAL_MS || 500);
    this.lastCallAt = 0;
    this.queue = Promise.resolve();
    this.lastSuccessfulUrl = url;
    this.failoverCount = 0;
    this.cursorSlots = new Map();
  }

  call(method, params = [], attempts = 4, url = this.url, fallbackUrls = this.fallbackUrls) {
    const candidates = [url, ...fallbackUrls]
      .filter((item, index, items) => item && items.indexOf(item) === index);
    const task = this.queue.then(() => this.executeAcrossUrls(method, params, attempts, candidates));
    this.queue = task.catch(() => {});
    return task;
  }

  async executeAcrossUrls(method, params, attempts, urls) {
    let lastError;
    for (let index = 0; index < urls.length; index += 1) {
      const url = urls[index];
      try {
        const result = await this.execute(method, params, attempts, url);
        this.lastSuccessfulUrl = url;
        if (index > 0) this.failoverCount += 1;
        return result;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
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
        if (!response.ok) {
          const error = new Error(`RPC HTTP ${response.status}`);
          const retryAfter = Number(response.headers.get('retry-after'));
          if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = Math.min(60_000, retryAfter * 1_000);
          throw error;
        }
        const payload = await response.json();
        if (payload.error) throw new Error(`RPC ${payload.error.code}: ${payload.error.message}`);
        return payload.result;
      } catch (error) {
        lastError = error;
        if (attempt + 1 < attempts) {
          const exponentialBackoff = 1_000 * 2 ** attempt;
          await sleep(Math.max(exponentialBackoff, Number(error.retryAfterMs) || 0));
        }
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

  async getSignaturesSince(
    until,
    {
      pageLimit = Number(process.env.SIGNATURE_PAGE_LIMIT || 1_000),
      maxPages = Number(process.env.SIGNATURE_MAX_PAGES || 20),
    } = {},
  ) {
    if (!until) throw new Error('A persisted signature cursor is required for incremental sync');
    const limit = Number.isSafeInteger(pageLimit) && pageLimit > 0 ? Math.min(1_000, pageLimit) : 1_000;
    const pageCap = Number.isSafeInteger(maxPages) && maxPages > 0 ? maxPages : 20;
    const signatures = [];
    let before = null;

    for (let page = 0; page < pageCap; page += 1) {
      const options = { limit, commitment: 'finalized', until };
      if (before) options.before = before;
      const batch = await this.call('getSignaturesForAddress', [PROGRAM_ID, options]);
      if (!Array.isArray(batch)) throw new Error('RPC getSignaturesForAddress returned an invalid response');
      signatures.push(...batch);
      if (batch.length < limit) return signatures;
      const nextBefore = batch.at(-1)?.signature;
      if (!nextBefore || nextBefore === before) throw new Error('RPC signature pagination did not advance');
      before = nextBefore;
    }

    throw new Error(`RPC signature backlog exceeded ${pageCap * limit} transactions; cursor was not advanced`);
  }

  async getTransactionsSince(
    until,
    {
      pageLimit = Number(process.env.TRANSACTION_BATCH_LIMIT || 100),
      maxPages = Number(process.env.TRANSACTION_BATCH_MAX_PAGES || 20),
    } = {},
  ) {
    if (!until) throw new Error('A persisted signature cursor is required for incremental sync');
    const limit = Number.isSafeInteger(pageLimit) && pageLimit > 0 ? Math.min(1_000, pageLimit) : 100;
    const pageCap = Number.isSafeInteger(maxPages) && maxPages > 0 ? maxPages : 20;
    const transactions = [];
    const seenTokens = new Set();
    let cursorSlot = this.cursorSlots.get(until) || null;
    if (!Number.isSafeInteger(cursorSlot)) {
      const cursorTransaction = await this.getTransaction(until);
      cursorSlot = Number(cursorTransaction?.slot);
      if (!Number.isSafeInteger(cursorSlot)) {
        throw new Error('RPC could not resolve the persisted signature cursor slot');
      }
      this.cursorSlots.set(until, cursorSlot);
    }
    let cursorSeen = false;
    let paginationToken = null;

    for (let page = 0; page < pageCap; page += 1) {
      const config = {
        transactionDetails: 'full',
        sortOrder: 'asc',
        commitment: 'finalized',
        encoding: 'json',
        maxSupportedTransactionVersion: 0,
        limit,
        filters: {
          status: 'any',
          slot: { gte: cursorSlot },
        },
      };
      if (paginationToken) config.paginationToken = paginationToken;

      const result = await this.call('getTransactionsForAddress', [PROGRAM_ID, config], 2);
      if (!Array.isArray(result?.data)) {
        throw new Error('RPC getTransactionsForAddress returned an invalid response');
      }
      const normalized = result.data.map(normalizeBatchedTransaction);
      for (const item of normalized) {
        const slot = Number(item.transaction?.slot);
        if (Number.isSafeInteger(slot)) this.cursorSlots.set(item.signature, slot);
        if (!cursorSeen) {
          if (item.signature === until) cursorSeen = true;
          continue;
        }
        transactions.push(item);
      }

      const nextToken = result.paginationToken || null;
      if (!nextToken || result.data.length < limit) {
        if (!cursorSeen) {
          throw new Error('RPC getTransactionsForAddress did not include the persisted cursor');
        }
        return transactions;
      }
      if (seenTokens.has(nextToken)) {
        throw new Error(`RPC repeated getTransactionsForAddress paginationToken: ${nextToken}`);
      }
      seenTokens.add(nextToken);
      paginationToken = nextToken;
    }

    throw new Error(`RPC transaction backlog exceeded ${pageCap * limit} transactions; cursor was not advanced`);
  }

  getTransaction(signature) {
    return this.call('getTransaction', [signature, {
      encoding: 'json',
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    }]);
  }
}
