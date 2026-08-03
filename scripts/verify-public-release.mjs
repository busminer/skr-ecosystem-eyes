const baseUrl = String(process.argv[2] || process.env.PUBLIC_BASE_URL || 'https://skr.alexkosa.dev').replace(/\/$/, '');
const expectedMarkers = ['skr-eyes-mark.svg', 'INCLUDE DUST', 'INDEXED SINCE AUG 2026', 'property="og:title"'];

async function checkedFetch(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, { headers: { 'cache-control': 'no-cache' } });
  if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}`);
  return response;
}

const htmlResponse = await checkedFetch('/');
const html = await htmlResponse.text();
for (const marker of expectedMarkers) {
  if (!html.includes(marker)) throw new Error(`Freshness marker missing from clean URL: ${marker}`);
}
if (!/^no-(?:cache|store)/i.test(htmlResponse.headers.get('cache-control') || '')) {
  throw new Error(`HTML cache policy is unsafe: ${htmlResponse.headers.get('cache-control') || 'missing'}`);
}

const imageResponse = await checkedFetch('/assets/brand/skr-eyes-og.png');
const image = Buffer.from(await imageResponse.arrayBuffer());
if (imageResponse.headers.get('content-type') !== 'image/png') throw new Error('OG image has an invalid content type');
if (image.length > 300_000) throw new Error(`OG image exceeds 300 KB: ${image.length} bytes`);
if (image.length < 24 || image.toString('ascii', 1, 4) !== 'PNG') throw new Error('OG image is not a valid PNG');
const width = image.readUInt32BE(16);
const height = image.readUInt32BE(20);
if (width !== 1200 || height !== 630) throw new Error(`OG image is ${width}x${height}, expected 1200x630`);

console.log(JSON.stringify({ ok: true, baseUrl, htmlCacheControl: htmlResponse.headers.get('cache-control'), cfCacheStatus: htmlResponse.headers.get('cf-cache-status'), og: { width, height, bytes: image.length } }, null, 2));
