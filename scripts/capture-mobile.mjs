import { writeFile } from 'node:fs/promises';

const port = Number(process.env.CDP_PORT || 9223);
const width = Number(process.env.CDP_WIDTH || 390);
const height = Number(process.env.CDP_HEIGHT || 844);
const mobile = process.env.CDP_MOBILE === undefined ? true : process.env.CDP_MOBILE === '1';
const fullPage = process.env.CDP_FULL_PAGE === '1';
const output = process.argv[2] || 'artifacts/mobile-cdp.png';
const targetUrl = process.argv[3] || 'http://127.0.0.1:4173/?mobile-test=1';
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
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
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
await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
await command('Emulation.setTouchEmulationEnabled', { enabled: mobile });
await command('Page.navigate', { url: targetUrl });
await new Promise((resolve) => setTimeout(resolve, 5_000));
const screenshot = await command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: fullPage });
await writeFile(output, Buffer.from(screenshot.data, 'base64'));
socket.close();
console.log(output);
