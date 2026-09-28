import { EYE_BASE_URL } from './config';

// The Iris's ear: Server-Sent Events from `/eye/stream`, read without an
// EventSource, because React Native does not have one and its `fetch` hands
// back a body only once it is complete.
//
// What it does have is an XMLHttpRequest that will fire `progress` as the
// text arrives — that is the incremental path RCTNetworking already supports
// for text responses. So the stream is one long GET, parsed line by line from
// wherever the last parse stopped. Two events matter: a `blink` with the
// serial and the ring, and a `gaze` with who looked at whom.
//
// The line is opened only while the Eyes tab is on screen and the app is in
// front; the tab does that, this file only knows how to keep one line alive.
// Dropped by the server or the network, it comes back on a backoff that
// doubles to half a minute; answered with a 404, which is what the route
// says until the server side exists, it waits a whole minute, so a phone on
// the tab is not knocking every second on a door that is not there yet.
//
// Two floors under that, so a proxy that answers and then cuts every line at
// once cannot turn a thousand phones into a knock a second each: the backoff
// starts over only after a line has stayed up for half a minute, not on its
// first byte; a dropped line waits at least five seconds; and no line is
// opened sooner than five seconds after the last one was, whatever the
// reason it ended.

export type StreamMessage =
  | { event: 'blink'; data: { serial: number; ring: number } }
  | { event: 'gaze'; data: { fromSerial: number; toSerial: number } };

// A connection that has read this much is closed and reopened: the response
// text only ever grows, and a phone left on the tab all day should not carry
// the whole day's events in one string.
const ROTATE_AT = 512 * 1024;
const MAX_BACKOFF_MS = 30_000;
const MISSING_ROUTE_MS = 60_000;
// A line counts as healthy, and the backoff starts over, after this long.
const HEALTHY_AFTER_MS = 30_000;
// The least time between two openings of the line.
const MIN_RECONNECT_MS = 5_000;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function decode(name: string, raw: string): StreamMessage | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as Record<string, unknown>;
  if (name === 'blink' && isFiniteNumber(body.serial) && isFiniteNumber(body.ring)) {
    return { event: 'blink', data: { serial: body.serial, ring: body.ring } };
  }
  if (name === 'gaze' && isFiniteNumber(body.fromSerial) && isFiniteNumber(body.toSerial)) {
    return { event: 'gaze', data: { fromSerial: body.fromSerial, toSerial: body.toSerial } };
  }
  return null;
}

export function openEyeStream(onMessage: (message: StreamMessage) => void): () => void {
  let closed = false;
  let live: XMLHttpRequest | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  // When the line in flight was opened, and when it first answered 200.
  let openedAt = 0;
  let liveSince: number | null = null;
  // Parser state for the connection in flight.
  let offset = 0;
  let eventName = '';
  let dataLines: string[] = [];

  const dispatch = () => {
    if (dataLines.length > 0) {
      const message = decode(eventName || 'message', dataLines.join('\n'));
      if (message) onMessage(message);
    }
    eventName = '';
    dataLines = [];
  };

  // Whole lines only; a line still arriving waits for the next progress event.
  const parse = (text: string) => {
    let end = text.indexOf('\n', offset);
    while (end !== -1) {
      let line = text.slice(offset, end);
      offset = end + 1;
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line === '') dispatch();
      else if (!line.startsWith(':')) {
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') eventName = value;
        else if (field === 'data') dataLines.push(value);
      }
      end = text.indexOf('\n', offset);
    }
  };

  // Never sooner than MIN_RECONNECT_MS after the last opening.
  const schedule = (delay: number) => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    const wait = Math.max(delay, openedAt + MIN_RECONNECT_MS - Date.now());
    timer = setTimeout(() => { timer = null; connect(); }, Math.max(0, wait));
  };

  const connect = () => {
    if (closed || live) return;
    offset = 0;
    eventName = '';
    dataLines = [];
    openedAt = Date.now();
    liveSince = null;
    const request = new XMLHttpRequest();
    live = request;
    request.open('GET', `${EYE_BASE_URL}/eye/stream`, true);
    request.setRequestHeader('accept', 'text/event-stream');
    request.setRequestHeader('cache-control', 'no-cache');
    // Registered as a listener rather than assigned, on purpose: it is the
    // listener that tells the native side to deliver the body in pieces.
    request.addEventListener('progress', () => {
      if (request !== live) return;
      if (request.status !== 200) return;
      if (liveSince == null) liveSince = Date.now();
      const text = request.responseText;
      parse(text);
      if (text.length > ROTATE_AT) {
        live = null;
        request.abort();
        schedule(50);
      }
    });
    const ended = () => {
      if (request !== live) return;
      live = null;
      if (closed) return;
      // A line that stayed up long enough was a good one: what ended it is a
      // fresh failure, not the next in a run.
      if (liveSince != null && Date.now() - liveSince >= HEALTHY_AFTER_MS) failures = 0;
      failures += 1;
      const base = request.status === 404 || request.status === 501
        ? MISSING_ROUTE_MS
        : Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** Math.min(failures - 1, 5));
      // A little jitter, so a thousand phones dropped by one restart do not
      // all come back on the same tick; and never a pause under five seconds.
      schedule(Math.max(MIN_RECONNECT_MS, base * (0.7 + Math.random() * 0.6)));
    };
    request.addEventListener('load', ended);
    request.addEventListener('error', ended);
    request.addEventListener('abort', ended);
    request.addEventListener('timeout', ended);
    request.send();
  };

  connect();

  return () => {
    closed = true;
    if (timer) { clearTimeout(timer); timer = null; }
    const request = live;
    live = null;
    request?.abort();
  };
}
