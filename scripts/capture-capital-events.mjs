import { writeFile } from 'node:fs/promises';

const port = Number(process.env.CDP_PORT || 9227);
const width = Number(process.env.CDP_WIDTH || 1568);
const height = Number(process.env.CDP_HEIGHT || 1000);
const mobile = process.env.CDP_MOBILE === '1';
const output = process.argv[2] || 'artifacts/capital-events-preview.png';
const targetUrl = process.argv[3] || 'http://127.0.0.1:4173/?capital-preview=1';
const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
const page = targets.find((target) => target.type === 'page');
if (!page) throw new Error('No Chrome CDP page target found');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let id = 0;
const pending = new Map();
const runtimeErrors = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params?.exceptionDetails?.text || 'Runtime exception');
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const commandId = ++id;
  pending.set(commandId, { resolve, reject });
  socket.send(JSON.stringify({ id: commandId, method, params }));
});

await command('Page.enable');
await command('Runtime.enable');
await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
await command('Emulation.setTouchEmulationEnabled', { enabled: mobile });
await command('Page.navigate', { url: targetUrl });
await new Promise((resolve) => setTimeout(resolve, 3_500));

const injected = await command('Runtime.evaluate', {
  awaitPromise: true,
  returnByValue: true,
  expression: `(async () => {
    const oldCanvas = document.getElementById('capitalCanvas');
    const canvas = oldCanvas.cloneNode(true);
    oldCanvas.replaceWith(canvas);
    const { CapitalField } = await import('/capital-field.js?v=9&preview=' + Date.now());
    const state = await fetch('/api/state').then((response) => response.json());
    const field = new CapitalField(canvas);
    field.setMetrics(state.metrics);
    field.setLatest(state.recentEvents?.[0] || null);
    const now = Math.floor(Date.now() / 1000);
    const base = { signature: 'visual-verification', blockTime: now, wallet: '7Jk111111111111111111111111111111111pQ2' };
    field.enqueue({ ...base, id: 'preview-stake', instructionIndex: 0, type: 'stake', amount: 284000 });
    field.enqueue({ ...base, id: 'preview-unstake', instructionIndex: 1, type: 'unstake', amount: 91500 });
    field.enqueue({ ...base, id: 'preview-withdraw', instructionIndex: 2, type: 'withdraw', amount: 40000 });
    document.getElementById('fieldStatus').textContent = 'CONTROLLED VISUAL VERIFICATION';
    document.getElementById('fieldLatest').textContent = 'STAKE +284K · UNSTAKE ≈−91.5K · WITHDRAW −40K';
    return { canvas: canvas.getBoundingClientRect().toJSON(), metrics: Boolean(state.metrics) };
  })()`,
});
if (injected.exceptionDetails) throw new Error(injected.exceptionDetails.text || 'Preview injection failed');
await new Promise((resolve) => setTimeout(resolve, 2_250));
const screenshot = await command('Page.captureScreenshot', { format: 'png', fromSurface: true });
await writeFile(output, Buffer.from(screenshot.data, 'base64'));
socket.close();
if (runtimeErrors.length) throw new Error(`Browser runtime errors: ${runtimeErrors.join('; ')}`);
console.log(JSON.stringify({ output, preview: injected.result?.value, runtimeErrors }, null, 2));
