const port = Number(process.env.CDP_PORT || 9224);
const width = Number(process.env.CDP_WIDTH || 390);
const height = Number(process.env.CDP_HEIGHT || 844);
const mobile = process.env.CDP_MOBILE === undefined ? true : process.env.CDP_MOBILE === '1';
const targetUrl = process.argv[2] || 'http://127.0.0.1:4173/?layout-audit=1';

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
await command('Log.enable');
await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
await command('Emulation.setTouchEmulationEnabled', { enabled: mobile });
await command('Page.navigate', { url: targetUrl });
await new Promise((resolve) => setTimeout(resolve, 5_000));

const expression = `(() => {
  const rect = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { selector, x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom, fontSize: style.fontSize, overflow: style.overflow };
  };
  const overflowing = [...document.querySelectorAll('body *')].filter((element) => !element.closest('.table-wrap, .filters, .evidence-drawer, .drawer-scrim')).map((element) => {
    const box = element.getBoundingClientRect();
    return { tag: element.tagName, className: String(element.className || '').slice(0, 90), x: box.x, right: box.right, width: box.width };
  }).filter((box) => box.width > 0 && (box.x < -1 || box.right > innerWidth + 1)).slice(0, 30);
  return {
    viewport: { width: innerWidth, height: innerHeight },
    document: { scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight },
    body: { scrollWidth: document.body.scrollWidth, scrollHeight: document.body.scrollHeight },
    overflowing,
    elements: ['.topbar', '.disclosure', '#overview', '.stake-core', '.capital-field', '#capitalCanvas', '.exit-core', '.signal-strip', '#flows', '#activity', '.attribution', '.rail'].map(rect),
    disclaimer: document.querySelector('.disclosure')?.textContent.trim(),
    ui: {
      networkStatus: document.querySelector('#networkStatus')?.textContent,
      freshness: document.querySelector('#freshness')?.textContent,
      guardianPools: document.querySelector('#guardianPools')?.textContent,
      activeStaked: document.querySelector('#activeStaked')?.textContent,
      pressureRatio: document.querySelector('#pressureRatio')?.textContent,
      eventRows: document.querySelectorAll('#eventRows tr').length,
      canvas: { width: document.querySelector('#capitalCanvas')?.width, height: document.querySelector('#capitalCanvas')?.height },
      fonts: document.fonts?.status
    },
    readyState: document.readyState
  };
})()`;
const result = await command('Runtime.evaluate', { expression, returnByValue: true });
console.log(JSON.stringify({ ...result.result.value, runtimeErrors }, null, 2));
socket.close();
