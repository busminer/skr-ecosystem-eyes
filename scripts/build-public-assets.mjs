import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'public');
const outputRoot = path.join(publicRoot, 'build');
await mkdir(outputRoot, { recursive: true });
for (const entry of await readdir(outputRoot)) {
  if (/\.[a-f0-9]{10}\.(?:css|js)$/.test(entry)) await unlink(path.join(outputRoot, entry));
}

const digest = (content) => createHash('sha256').update(content).digest('hex').slice(0, 10);
const outputs = new Map();
const sibling = (sourceName) => `./${path.posix.basename(outputs.get(sourceName))}`;

async function emit(sourceName, transform = (content) => content) {
  const source = await readFile(path.join(publicRoot, sourceName), 'utf8');
  const content = transform(source);
  const extension = path.extname(sourceName);
  const base = path.basename(sourceName, extension);
  const outputName = `${base}.${digest(content)}${extension}`;
  await writeFile(path.join(outputRoot, outputName), content);
  outputs.set(sourceName, `/build/${outputName}`);
}

await emit('capital-events.js');
await emit('range-view.js');
await emit('capital-field.js', (content) => content.replace('./capital-events.js?v=5', sibling('capital-events.js')));
await emit('app.js', (content) => content
  .replace('./capital-field.js?v=10', sibling('capital-field.js'))
  .replace('./capital-events.js?v=5', sibling('capital-events.js'))
  .replace('./range-view.js?v=2', sibling('range-view.js')));
await emit('operations-console.css');
await emit('wallet-profile.js');
await emit('wallet.css');
await emit('wallet-overrides.css');

for (const [htmlName, replacements] of Object.entries({
  'index.html': [
    [/\/(?:build\/operations-console\.[a-f0-9]{10}|operations-console)\.css(?:\?v=\d+)?/g, outputs.get('operations-console.css')],
    [/\/(?:build\/app\.[a-f0-9]{10}|app)\.js(?:\?v=\d+)?/g, outputs.get('app.js')],
  ],
  'wallet.html': [
    [/\/(?:build\/wallet\.[a-f0-9]{10}|wallet)\.css(?:\?v=\d+)?/g, outputs.get('wallet.css')],
    [/\/(?:build\/wallet-overrides\.[a-f0-9]{10}|wallet-overrides)\.css(?:\?v=\d+)?/g, outputs.get('wallet-overrides.css')],
    [/\/(?:build\/wallet-profile\.[a-f0-9]{10}|wallet-profile)\.js(?:\?v=\d+)?/g, outputs.get('wallet-profile.js')],
  ],
})) {
  let html = await readFile(path.join(publicRoot, htmlName), 'utf8');
  for (const [from, to] of replacements) html = html.replace(from, to);
  await writeFile(path.join(publicRoot, htmlName), html);
}

console.log(JSON.stringify(Object.fromEntries(outputs), null, 2));
