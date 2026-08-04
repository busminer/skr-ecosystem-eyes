const baseUrl = String(process.argv[2] || process.env.PUBLIC_BASE_URL || 'https://skr.alexkosa.dev').replace(/\/$/, '');
const expectedMarkers = ['skr-eyes-mark.svg', 'INCLUDE DUST', 'INDEXED SINCE AUG 2026', 'property="og:title"'];

async function checkedFetch(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, { headers: { 'cache-control': 'no-cache' } });
  if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}`);
  return response;
}

async function verifyModuleGraph(entryPath) {
  const pending = [new URL(entryPath, `${baseUrl}/`)];
  const verified = [];
  while (pending.length) {
    const url = pending.shift();
    if (verified.includes(url.href)) continue;
    if (url.origin !== new URL(baseUrl).origin) throw new Error(`External module import is not allowed: ${url.href}`);
    const response = await checkedFetch(`${url.pathname}${url.search}`);
    const source = await response.text();
    verified.push(url.href);
    for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      pending.push(new URL(match[1], url));
    }
  }
  return verified.map((url) => new URL(url).pathname);
}

const htmlResponse = await checkedFetch('/');
const html = await htmlResponse.text();
for (const marker of expectedMarkers) {
  if (!html.includes(marker)) throw new Error(`Freshness marker missing from clean URL: ${marker}`);
}
if (!/^no-(?:cache|store)/i.test(htmlResponse.headers.get('cache-control') || '')) {
  throw new Error(`HTML cache policy is unsafe: ${htmlResponse.headers.get('cache-control') || 'missing'}`);
}
const moduleEntry = html.match(/<script\s+type="module"\s+src="([^"]+)"/i)?.[1];
if (!moduleEntry) throw new Error('Fingerprinted module entry is missing from clean HTML');
const modules = await verifyModuleGraph(moduleEntry);

const imageResponse = await checkedFetch('/assets/brand/skr-eyes-og.png');
const image = Buffer.from(await imageResponse.arrayBuffer());
if (imageResponse.headers.get('content-type') !== 'image/png') throw new Error('OG image has an invalid content type');
if (image.length > 300_000) throw new Error(`OG image exceeds 300 KB: ${image.length} bytes`);
if (image.length < 24 || image.toString('ascii', 1, 4) !== 'PNG') throw new Error('OG image is not a valid PNG');
const width = image.readUInt32BE(16);
const height = image.readUInt32BE(20);
if (width !== 1200 || height !== 630) throw new Error(`OG image is ${width}x${height}, expected 1200x630`);

console.log(JSON.stringify({ ok: true, baseUrl, htmlCacheControl: htmlResponse.headers.get('cache-control'), cfCacheStatus: htmlResponse.headers.get('cf-cache-status'), modules, og: { width, height, bytes: image.length } }, null, 2));
