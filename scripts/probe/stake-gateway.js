import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { decodeBase58, encodeBase58 } from './base58.js';
import { decodeStakeConfig } from './decoder.js';
import { MINT, PROGRAM_ID, STAKE_CONFIG, STAKE_VAULT } from './constants.js';

const ROUTE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/;
const STAKE_DISCRIMINATOR = Buffer.from([206, 176, 202, 18, 200, 209, 179, 108]);
const GUARDIAN_DISCRIMINATOR = Buffer.from([133, 238, 255, 214, 215, 11, 189, 23]);
const USER_STAKE_DISCRIMINATOR = Buffer.from([102, 53, 163, 107, 9, 138, 87, 153]);
const EVENT_AUTHORITY = '8rUTGg1XoyuvK9G64S7d37m3HtLZH24oPeMmXkpJH8ir';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const MAX_WIRE_BYTES = 1_232;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

class StakeGatewayError extends Error {
  constructor(code, message, { rpcCode = -32000, status = 400 } = {}) {
    super(message);
    this.name = 'StakeGatewayError';
    this.code = code;
    this.rpcCode = rpcCode;
    this.status = status;
  }
}

export function createStakeGateway({
  rpc,
  indexer,
  enabled = process.env.STAKE_GATEWAY_ENABLED === '1',
  routeId = process.env.STAKE_GATEWAY_ROUTE_ID || 'skr-mainnet-stake-v1',
  submitLimit = positiveInteger(process.env.STAKE_GATEWAY_SUBMIT_LIMIT_PER_MINUTE, 6),
  readLimit = positiveInteger(process.env.STAKE_GATEWAY_READ_LIMIT_PER_MINUTE, 60),
  globalSubmitLimit = positiveInteger(process.env.STAKE_GATEWAY_GLOBAL_SUBMIT_LIMIT_PER_MINUTE, 12),
  globalReadLimit = positiveInteger(process.env.STAKE_GATEWAY_GLOBAL_READ_LIMIT_PER_MINUTE, 120),
  now = () => Date.now(),
} = {}) {
  const routeValid = ROUTE_ID_PATTERN.test(routeId);
  const limiter = new InMemoryRateLimiter({
    globalReadLimit,
    globalSubmitLimit,
    now,
    readLimit,
    submitLimit,
  });

  return {
    capability() {
      const sourceReady = minimumStakeRaw(indexer) !== null;
      return {
        schemaVersion: 1,
        routeId: routeValid ? routeId : null,
        cluster: 'solana:mainnet',
        submission: enabled && routeValid && sourceReady ? 'enabled' : 'locked',
        instruction: 'stake',
        programId: PROGRAM_ID,
        transactionVersion: 0,
        maxWireBytes: MAX_WIRE_BYTES,
        proof: 'same-wire-finalized-readback-required',
      };
    },

    async handle(payload, request = {}) {
      const id = validRpcId(payload?.id) ? payload.id : null;
      try {
        if (!enabled || !routeValid) {
          throw gatewayError('STAKE_GATEWAY_LOCKED', 'Stake submission gateway is locked.', 503);
        }
        validateRpcEnvelope(payload);
        const kind = payload.method === 'sendTransaction' ? 'submit' : 'read';
        limiter.consume(request, kind);
        const result = await dispatch({ indexer, method: payload.method, params: payload.params, rpc });
        return { status: 200, payload: { jsonrpc: '2.0', id, result } };
      } catch (error) {
        const safe = error instanceof StakeGatewayError
          ? error
          : gatewayError('STAKE_GATEWAY_INTERNAL', 'Stake gateway request failed.', 500);
        return {
          status: safe.status,
          payload: {
            jsonrpc: '2.0',
            id,
            error: { code: safe.rpcCode, message: safe.message, data: { code: safe.code } },
          },
        };
      }
    },
  };
}

async function dispatch({ indexer, method, params, rpc }) {
  if (method === 'sendTransaction') return submitStakeTransaction({ indexer, params, rpc });
  if (method === 'getSignatureStatuses') return getStakeSignatureStatus({ params, rpc });
  if (method === 'getTransaction') return getFinalizedStakeTransaction({ params, rpc });
  if (method === 'getAccountInfo') return getFinalizedUserStakeAccount({ params, rpc });
  throw new StakeGatewayError('STAKE_GATEWAY_METHOD_NOT_ALLOWED', 'RPC method is not allowed.', {
    rpcCode: -32601,
    status: 405,
  });
}

async function submitStakeTransaction({ indexer, params, rpc }) {
  if (!Array.isArray(params) || params.length !== 2 || typeof params[0] !== 'string' || !isPlainObject(params[1])) {
    throw invalidParams('sendTransaction requires one base64 wire and one options object.');
  }
  const options = params[1];
  if (
    options.encoding !== 'base64' ||
    options.skipPreflight !== false ||
    options.preflightCommitment !== 'confirmed' ||
    !isSafeSlot(options.minContextSlot)
  ) {
    throw invalidParams('sendTransaction options do not match the approved gateway policy.');
  }

  const currentMinimum = minimumStakeRaw(indexer);
  if (currentMinimum === null) {
    throw gatewayError('STAKE_GATEWAY_SOURCE_UNAVAILABLE', 'Finalized stake configuration is unavailable.', 503);
  }
  const inspected = validateSignedStakeTransaction(params[0], { minimumStakeRaw: currentMinimum });
  await validateGuardianPool(rpc, inspected.guardianPool, options.minContextSlot);

  let returned;
  try {
    returned = await rpc.call('sendTransaction', [params[0], {
      encoding: 'base64',
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
      minContextSlot: options.minContextSlot,
    }], 2);
  } catch {
    throw gatewayError('STAKE_GATEWAY_UPSTREAM_UNAVAILABLE', 'Stake transaction submission is temporarily unavailable.', 502);
  }
  if (returned !== inspected.signature) {
    throw gatewayError('STAKE_GATEWAY_SIGNATURE_MISMATCH', 'Upstream returned a different transaction signature.', 502);
  }
  return returned;
}

async function getStakeSignatureStatus({ params, rpc }) {
  if (
    !Array.isArray(params) ||
    params.length !== 2 ||
    !Array.isArray(params[0]) ||
    params[0].length !== 1 ||
    !isSignature(params[0][0]) ||
    !isPlainObject(params[1]) ||
    params[1].searchTransactionHistory !== true
  ) {
    throw invalidParams('getSignatureStatuses accepts exactly one signature with history search enabled.');
  }
  try {
    return await rpc.call('getSignatureStatuses', [[params[0][0]], { searchTransactionHistory: true }], 2);
  } catch {
    throw gatewayError('STAKE_GATEWAY_UPSTREAM_UNAVAILABLE', 'Stake status is temporarily unavailable.', 502);
  }
}

async function getFinalizedStakeTransaction({ params, rpc }) {
  if (
    !Array.isArray(params) ||
    params.length !== 2 ||
    !isSignature(params[0]) ||
    !isPlainObject(params[1]) ||
    params[1].commitment !== 'finalized' ||
    params[1].encoding !== 'base64' ||
    params[1].maxSupportedTransactionVersion !== 0
  ) {
    throw invalidParams('getTransaction requires one finalized base64 version-0 stake transaction.');
  }
  let result;
  try {
    result = await rpc.call('getTransaction', [params[0], {
      commitment: 'finalized',
      encoding: 'base64',
      maxSupportedTransactionVersion: 0,
    }], 2);
  } catch {
    throw gatewayError('STAKE_GATEWAY_UPSTREAM_UNAVAILABLE', 'Finalized stake transaction is temporarily unavailable.', 502);
  }
  if (result === null) return null;
  const wire = result?.transaction?.[0];
  if (typeof wire !== 'string' || result?.transaction?.[1] !== 'base64') {
    throw gatewayError('STAKE_GATEWAY_UPSTREAM_INVALID', 'Finalized stake transaction proof is invalid.', 502);
  }
  const inspected = validateSignedStakeTransaction(wire, { minimumStakeRaw: 1n });
  if (inspected.signature !== params[0]) {
    throw gatewayError('STAKE_GATEWAY_SIGNATURE_MISMATCH', 'Finalized transaction signature does not match.', 502);
  }
  return result;
}

async function getFinalizedUserStakeAccount({ params, rpc }) {
  if (
    !Array.isArray(params) ||
    params.length !== 2 ||
    !isPublicKey(params[0]) ||
    !isPlainObject(params[1]) ||
    params[1].commitment !== 'finalized' ||
    params[1].encoding !== 'base64' ||
    !isSafeSlot(params[1].minContextSlot)
  ) {
    throw invalidParams('getAccountInfo requires one finalized base64 account read with a context slot.');
  }
  let result;
  try {
    result = await rpc.call('getAccountInfo', [params[0], {
      commitment: 'finalized',
      encoding: 'base64',
      minContextSlot: params[1].minContextSlot,
    }], 2);
  } catch {
    throw gatewayError('STAKE_GATEWAY_UPSTREAM_UNAVAILABLE', 'Finalized UserStake proof is temporarily unavailable.', 502);
  }
  if (result?.value == null) return result;
  const data = decodeAccountData(result.value);
  if (
    result.value.owner !== PROGRAM_ID ||
    data.length !== 169 ||
    !data.subarray(0, 8).equals(USER_STAKE_DISCRIMINATOR)
  ) {
    throw invalidParams('Only official SKR UserStake accounts may be read through this route.');
  }
  return result;
}

export function validateSignedStakeTransaction(encodedWire, { minimumStakeRaw = 1n } = {}) {
  const wire = decodeCanonicalBase64(encodedWire);
  if (wire.length > MAX_WIRE_BYTES) throw invalidWire('Signed transaction exceeds the Solana packet limit.');

  const cursor = new ByteCursor(wire);
  const signatureCount = cursor.shortU16();
  if (signatureCount !== 1) throw invalidWire('Stake transaction must contain exactly one signature.');
  const signatureBytes = cursor.take(64);
  if (signatureBytes.every((byte) => byte === 0)) throw invalidWire('Stake transaction is not signed.');
  const messageOffset = cursor.offset;

  const version = cursor.u8();
  if (version !== 0x80) throw invalidWire('Only a version-0 stake transaction is accepted.');
  const requiredSignatures = cursor.u8();
  const readonlySigned = cursor.u8();
  const readonlyUnsigned = cursor.u8();
  if (requiredSignatures !== 1 || readonlySigned !== 0 || readonlyUnsigned !== 5) {
    throw invalidWire('Stake transaction header does not match the approved signer and account roles.');
  }

  const accountCount = cursor.shortU16();
  if (accountCount !== 11) throw invalidWire('Stake transaction must contain the exact approved static account set.');
  const accountBytes = [];
  const accounts = [];
  for (let index = 0; index < accountCount; index += 1) {
    const bytes = cursor.take(32);
    accountBytes.push(bytes);
    accounts.push(encodeBase58(bytes));
  }
  if (new Set(accounts).size !== accounts.length) throw invalidWire('Stake transaction static accounts must be unique.');
  const recentBlockhash = cursor.take(32);
  if (recentBlockhash.every((byte) => byte === 0)) throw invalidWire('Stake transaction blockhash is invalid.');

  const instructionCount = cursor.shortU16();
  if (instructionCount !== 1) throw invalidWire('Stake transaction must contain exactly one instruction.');
  const programAddressIndex = cursor.u8();
  const accountIndexCount = cursor.shortU16();
  if (accountIndexCount !== 12) throw invalidWire('Stake instruction must contain exactly twelve ordered accounts.');
  const accountIndices = [...cursor.take(accountIndexCount)];
  if (accountIndices.some((index) => index >= accountCount)) throw invalidWire('Stake instruction contains an invalid account index.');
  const instructionData = cursor.take(cursor.shortU16());
  const addressTableLookupCount = cursor.shortU16();
  if (addressTableLookupCount !== 0 || cursor.offset !== wire.length) {
    throw invalidWire('Address lookup tables and trailing transaction data are not accepted.');
  }

  const instructionAccounts = accountIndices.map((index) => accounts[index]);
  const payer = accounts[0];
  const fixedAccounts = [
    [1, STAKE_CONFIG],
    [6, STAKE_VAULT],
    [7, MINT],
    [8, TOKEN_PROGRAM],
    [9, SYSTEM_PROGRAM],
    [10, EVENT_AUTHORITY],
    [11, PROGRAM_ID],
  ];
  if (
    accounts[programAddressIndex] !== PROGRAM_ID ||
    instructionAccounts[3] !== payer ||
    instructionAccounts[4] !== payer ||
    fixedAccounts.some(([position, expected]) => instructionAccounts[position] !== expected)
  ) {
    throw invalidWire('Stake instruction program or ordered accounts do not match the official protocol.');
  }

  const roles = instructionAccounts.map((_, position) => accountRole(accountIndices[position], {
    accountCount,
    readonlySigned,
    readonlyUnsigned,
    requiredSignatures,
  }));
  const expectedRoles = [
    'writable-nonsigner', 'writable-nonsigner', 'writable-nonsigner', 'writable-signer',
    'writable-signer', 'writable-nonsigner', 'writable-nonsigner', 'readonly-nonsigner',
    'readonly-nonsigner', 'readonly-nonsigner', 'readonly-nonsigner', 'readonly-nonsigner',
  ];
  if (roles.some((role, index) => role !== expectedRoles[index])) {
    throw invalidWire('Stake instruction account roles do not match the official protocol.');
  }

  if (instructionData.length !== 16 || !instructionData.subarray(0, 8).equals(STAKE_DISCRIMINATOR)) {
    throw invalidWire('Only the official SKR stake instruction is accepted.');
  }
  const amountRaw = instructionData.readBigUInt64LE(8);
  if (amountRaw < BigInt(minimumStakeRaw) || amountRaw === 0n) {
    throw invalidWire('Stake amount is below the current finalized minimum.');
  }

  const messageBytes = wire.subarray(messageOffset);
  let key;
  try {
    key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, accountBytes[0]]), format: 'der', type: 'spki' });
  } catch {
    throw invalidWire('Stake transaction signer key is invalid.');
  }
  if (!verify(null, messageBytes, key, signatureBytes)) {
    throw invalidWire('Stake transaction signature is invalid.');
  }

  return {
    amountRaw,
    guardianPool: instructionAccounts[2],
    messageSha256: createHash('sha256').update(messageBytes).digest('hex'),
    payer,
    signature: encodeBase58(signatureBytes),
    userStake: instructionAccounts[0],
  };
}

async function validateGuardianPool(rpc, guardianPool, minContextSlot) {
  let result;
  try {
    result = await rpc.call('getAccountInfo', [guardianPool, {
      commitment: 'confirmed', encoding: 'base64', minContextSlot,
    }], 2);
  } catch {
    throw gatewayError('STAKE_GATEWAY_GUARDIAN_UNAVAILABLE', 'Guardian verification is temporarily unavailable.', 502);
  }
  const value = result?.value;
  const data = value ? decodeAccountData(value) : null;
  if (
    !data ||
    value.owner !== PROGRAM_ID ||
    data.length !== 188 ||
    !data.subarray(0, 8).equals(GUARDIAN_DISCRIMINATOR) ||
    !data.subarray(8, 40).equals(decodeBase58(STAKE_CONFIG)) ||
    data[171] !== 1
  ) {
    throw invalidParams('The selected Guardian is not an active official SKR Guardian pool.');
  }
}

function decodeAccountData(value) {
  const encoded = value?.data?.[0];
  if (typeof encoded !== 'string' || value.data?.[1] !== 'base64') throw invalidParams('RPC account data is invalid.');
  return decodeCanonicalBase64(encoded);
}

function minimumStakeRaw(indexer) {
  try {
    return indexer?.configData ? decodeStakeConfig(indexer.configData).minimumStakeRaw : null;
  } catch {
    return null;
  }
}

function validateRpcEnvelope(payload) {
  if (
    !isPlainObject(payload) ||
    payload.jsonrpc !== '2.0' ||
    !validRpcId(payload.id) ||
    typeof payload.method !== 'string' ||
    !Array.isArray(payload.params)
  ) {
    throw new StakeGatewayError('STAKE_GATEWAY_INVALID_REQUEST', 'Invalid JSON-RPC request.', {
      rpcCode: -32600,
      status: 400,
    });
  }
}

class InMemoryRateLimiter {
  constructor({ globalReadLimit, globalSubmitLimit, now, readLimit, submitLimit }) {
    this.globalReadLimit = globalReadLimit;
    this.globalSubmitLimit = globalSubmitLimit;
    this.now = now;
    this.readLimit = readLimit;
    this.submitLimit = submitLimit;
    this.salt = randomBytes(32);
    this.entries = new Map();
  }

  consume(request, kind) {
    const raw = String(request?.headers?.['cf-connecting-ip'] || request?.socket?.remoteAddress || 'unknown');
    const key = createHash('sha256').update(this.salt).update(raw).update(kind).digest('hex');
    const current = this.now();
    const limit = kind === 'submit' ? this.submitLimit : this.readLimit;
    if (!this.increment(key, current, limit)) {
      throw new StakeGatewayError('STAKE_GATEWAY_RATE_LIMITED', 'Stake gateway rate limit reached.', {
        rpcCode: -32005,
        status: 429,
      });
    }
    const globalLimit = kind === 'submit' ? this.globalSubmitLimit : this.globalReadLimit;
    if (!this.increment(`global:${kind}`, current, globalLimit)) {
      throw new StakeGatewayError('STAKE_GATEWAY_RATE_LIMITED', 'Stake gateway global rate limit reached.', {
        rpcCode: -32005,
        status: 429,
      });
    }
    if (this.entries.size > 10_000) {
      for (const [candidate, value] of this.entries) {
        if (current - value.startedAt >= 60_000) this.entries.delete(candidate);
      }
    }
  }

  increment(key, current, limit) {
    const prior = this.entries.get(key);
    const entry = !prior || current - prior.startedAt >= 60_000 ? { count: 0, startedAt: current } : prior;
    entry.count += 1;
    this.entries.set(key, entry);
    return entry.count <= limit;
  }
}

class ByteCursor {
  constructor(buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  take(length) {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.buffer.length) {
      throw invalidWire('Signed transaction is truncated.');
    }
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  u8() {
    return this.take(1)[0];
  }

  shortU16() {
    let value = 0;
    let shift = 0;
    for (let index = 0; index < 3; index += 1) {
      const byte = this.u8();
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        if (index > 0 && value < (1 << (7 * index))) throw invalidWire('Signed transaction uses non-canonical compact length.');
        if (value > 0xffff) throw invalidWire('Signed transaction compact length is too large.');
        return value;
      }
      shift += 7;
    }
    throw invalidWire('Signed transaction compact length is invalid.');
  }
}

function accountRole(index, { accountCount, readonlySigned, readonlyUnsigned, requiredSignatures }) {
  if (index < requiredSignatures) {
    return index < requiredSignatures - readonlySigned ? 'writable-signer' : 'readonly-signer';
  }
  return index < accountCount - readonlyUnsigned ? 'writable-nonsigner' : 'readonly-nonsigner';
}

function decodeCanonicalBase64(value) {
  if (typeof value !== 'string' || value.length === 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw invalidWire('Expected canonical base64 data.');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) throw invalidWire('Expected canonical base64 data.');
  return decoded;
}

function isSignature(value) {
  try {
    return typeof value === 'string' && decodeBase58(value).length === 64;
  } catch {
    return false;
  }
}

function isPublicKey(value) {
  try {
    return typeof value === 'string' && decodeBase58(value).length === 32;
  } catch {
    return false;
  }
}

function isSafeSlot(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validRpcId(value) {
  return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value));
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function invalidParams(message) {
  return new StakeGatewayError('STAKE_GATEWAY_INVALID_PARAMS', message, { rpcCode: -32602, status: 400 });
}

function invalidWire(message) {
  return new StakeGatewayError('STAKE_GATEWAY_INVALID_WIRE', message, { rpcCode: -32602, status: 400 });
}

function gatewayError(code, message, status) {
  return new StakeGatewayError(code, message, { status });
}
