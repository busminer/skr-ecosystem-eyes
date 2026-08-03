const zoneId = process.env.CLOUDFLARE_ZONE_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const publicUrl = String(process.env.PUBLIC_BASE_URL || 'https://skr.alexkosa.dev').replace(/\/$/, '');

if (!zoneId || !apiToken) {
  console.error('CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN are required');
  process.exit(2);
}

const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
  method: 'POST',
  headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({ files: [`${publicUrl}/`] }),
});
const result = await response.json();
if (!response.ok || !result.success) throw new Error(`Cloudflare purge failed with HTTP ${response.status}`);
console.log(`Purged Cloudflare cache for ${publicUrl}/`);
