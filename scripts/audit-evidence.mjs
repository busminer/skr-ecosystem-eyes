import { writeFile } from 'node:fs/promises';

const port = Number(process.env.CDP_PORT || 9225);
const width = Number(process.env.CDP_WIDTH || 1568);
const height = Number(process.env.CDP_HEIGHT || 1000);
const mobile = process.env.CDP_MOBILE === '1';
const targetUrl = process.argv[2] || 'http://127.0.0.1:4175/?evidence-audit=1';
const metricOutput = process.argv[3] || 'artifacts/provenance-drawer.png';
const eventOutput = process.argv[4] || 'artifacts/evidence-drilldown.png';
const queueOutput = process.argv[5] || 'artifacts/queue-evidence.png';

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
  if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') runtimeErrors.push(message.params.entry.text);
  if (!message.id || !pending.has(message.id)) return;
  const waiter = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const commandId = ++id;
  pending.set(commandId, { resolve, reject });
  socket.send(JSON.stringify({ id: commandId, method, params }));
});
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const evaluate = async (expression) => (await command('Runtime.evaluate', { expression, returnByValue: true })).result.value;
const screenshot = async (path) => {
  const image = await command('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(path, Buffer.from(image.data, 'base64'));
};
const inspect = () => evaluate(`(() => {
  const drawer = document.querySelector('#evidenceDrawer');
  const box = drawer.getBoundingClientRect();
  return {
    open: drawer.classList.contains('open'),
    ariaHidden: drawer.getAttribute('aria-hidden'),
    title: document.querySelector('#drawerTitle')?.textContent,
    eyebrow: document.querySelector('#drawerEyebrow')?.textContent,
    chips: [...document.querySelectorAll('#drawerStatus .evidence-chip')].map((item) => item.textContent),
    facts: [...document.querySelectorAll('#drawerBody .evidence-fact')].map((item) => item.textContent.trim()),
    sourceLinks: [...document.querySelectorAll('#drawerBody .evidence-source a')].map((item) => item.href),
    caveat: document.querySelector('#drawerBody .evidence-caveat')?.textContent || null,
    rect: { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom },
    viewport: { width: innerWidth, height: innerHeight },
    bodyLocked: document.body.classList.contains('drawer-open'),
    backgroundInert: document.querySelector('.app-frame')?.inert,
  };
})()`);

await command('Page.enable');
await command('Runtime.enable');
await command('Log.enable');
await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
await command('Emulation.setTouchEmulationEnabled', { enabled: mobile });
await command('Page.navigate', { url: targetUrl });
await pause(5_000);

const metricClicked = await evaluate(`Boolean(document.querySelector('[data-provenance="activeStaked"]')?.click() ?? true)`);
await pause(400);
const metric = await inspect();
await screenshot(metricOutput);

await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await pause(350);
const closedWithEscape = !(await inspect()).open;

const eventClicked = await evaluate(`(() => { const button = document.querySelector('[data-event-id]'); if (!button) return false; button.click(); return true; })()`);
await pause(400);
const event = await inspect();
await screenshot(eventOutput);

await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await pause(350);
const queueClicked = await evaluate(`(() => { const button = document.querySelector('[data-queue-index]'); if (!button) return false; button.click(); return true; })()`);
await pause(400);
const queue = await inspect();
await screenshot(queueOutput);

console.log(JSON.stringify({ metricClicked, eventClicked, queueClicked, closedWithEscape, metric, event, queue, runtimeErrors }, null, 2));
socket.close();
