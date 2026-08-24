const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const INDEX = new Map([...ALPHABET].map((character, index) => [character, index]));

export function decodeBase58(value) {
  if (typeof value !== 'string') throw new TypeError('Base58 value must be a string');
  if (value.length === 0) return Buffer.alloc(0);

  let number = 0n;
  for (const character of value) {
    const digit = INDEX.get(character);
    if (digit === undefined) throw new Error(`Invalid base58 character: ${character}`);
    number = number * 58n + BigInt(digit);
  }

  const bytes = [];
  while (number > 0n) {
    bytes.push(Number(number & 255n));
    number >>= 8n;
  }
  bytes.reverse();

  let leadingZeros = 0;
  while (leadingZeros < value.length && value[leadingZeros] === '1') leadingZeros += 1;
  return Buffer.concat([Buffer.alloc(leadingZeros), Buffer.from(bytes)]);
}

export function encodeBase58(value) {
  const data = Buffer.from(value);
  if (data.length === 0) return '';

  let number = 0n;
  for (const byte of data) number = (number << 8n) + BigInt(byte);

  let encoded = '';
  while (number > 0n) {
    const digit = Number(number % 58n);
    encoded = ALPHABET[digit] + encoded;
    number /= 58n;
  }

  let leadingZeros = 0;
  while (leadingZeros < data.length && data[leadingZeros] === 0) leadingZeros += 1;
  return '1'.repeat(leadingZeros) + encoded;
}
