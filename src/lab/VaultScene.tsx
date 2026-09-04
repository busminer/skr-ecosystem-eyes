import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { WebViewRenderProcessGoneEvent } from 'react-native-webview/lib/WebViewTypes';
import { VAULT_SCENE_HTML } from './vaultSceneHtml';

// The React side of the living vault. It owns nothing about drawing; it only
// hands the scene what the app already knows and relays taps back.
//
// Messages are queued until the page says it is ready, so a state that arrives
// before the WebView has parsed its script is not lost — on a cold start that
// is exactly the order things happen in.

export type SceneMessage =
  | { type: 'state'; percent: number; pending: number; held?: number; positions?: number; todayIn: number; todayOut: number; eventsLastHour: number; now: number; queue: Array<{ k: string; amount: number; who: string | null; unlockAt: number; startAt: number }> }
  | { type: 'events'; replay?: boolean; items: Array<{ kind: string; amount: number; who: string | null; sig: string }> }
  | { type: 'me'; me: { name: string; amount: number; days: number | null } | null; sixteen?: boolean }
  | { type: 'freeze'; on: boolean }
  | { type: 'motion'; mode: 'live' | 'calm' | 'off' }
  | { type: 'pause'; on: boolean }
  | { type: 'story' }
  | { type: 'landmarks'; items: Array<{ amount: number; who: string | null; sig: string }> }
  | { type: 'night'; on: boolean; lit?: number }
  | { type: 'demo'; what: 'whalein' | 'whaleout' }
  | { type: 'inset'; top: number };

export type SceneTap = { kind: 'stake' | 'exit'; amount: number; who: string; sig: string; unlockAt?: number; ready?: boolean };

export type SceneHandle = { push: (message: SceneMessage) => void };

// The last of each of these is enough to rebuild the picture after a restart;
// events and pauses are moments, not state, and are not replayed.
const REMEMBERED: ReadonlySet<SceneMessage['type']> = new Set<SceneMessage['type']>(['inset', 'motion', 'state', 'me', 'landmarks', 'night', 'freeze']);

export const VaultScene = forwardRef<SceneHandle, { height: number; onTap?: (hit: SceneTap) => void }>(function VaultScene({ height, onTap }, ref) {
  const web = useRef<WebView>(null);
  const ready = useRef(false);
  const queue = useRef<SceneMessage[]>([]);
  const [failed, setFailed] = useState(false);
  // Android kills the WebView's renderer whenever it likes, most often while
  // the app sits in the background. After that the old WebView is a dead
  // black box and must be replaced, not reloaded. The generation is its key;
  // bumping it mounts a fresh one, and the memory below refills it.
  const [generation, setGeneration] = useState(0);
  const memory = useRef<Map<string, SceneMessage>>(new Map());
  // Two watchdogs. A page that has not said 'ready' six seconds after it was
  // mounted is replaced; a page that has said it but has not beaten for
  // twelve seconds while the app is in front is replaced too. Three tries,
  // then the wrapper stops insisting: a phone that cannot run the page at all
  // gets a dark panel, not an endless reload.
  const lastBeat = useRef(0);
  const mountedAt = useRef(Date.now());
  const paused = useRef(false);
  const restarts = useRef(0);

  const send = useCallback((message: SceneMessage) => {
    if (REMEMBERED.has(message.type)) memory.current.set(message.type, message);
    if (!ready.current) { queue.current.push(message); return; }
    web.current?.injectJavaScript(`window.__push(${JSON.stringify(message)});true;`);
  }, []);

  useImperativeHandle(ref, () => ({ push: send }), [send]);

  // A scene in a pocket must not draw a single frame.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => { paused.current = next !== 'active'; send({ type: 'pause', on: next !== 'active' }); });
    return () => subscription.remove();
  }, [send]);

  const restart = useCallback(() => {
    if (restarts.current >= 3) return;
    restarts.current += 1;
    ready.current = false;
    queue.current = [];
    lastBeat.current = 0;
    mountedAt.current = Date.now();
    setGeneration((current) => current + 1);
  }, []);

  useEffect(() => {
    mountedAt.current = Date.now();
    const timer = setInterval(() => {
      if (paused.current || AppState.currentState !== 'active') return;
      const now = Date.now();
      if (!ready.current && now - mountedAt.current > 6_000) restart();
      else if (ready.current && lastBeat.current > 0 && now - lastBeat.current > 12_000) restart();
    }, 3_000);
    return () => clearInterval(timer);
  }, [generation, restart]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as { type: string; hit?: SceneTap };
      if (data.type === 'beat') {
        lastBeat.current = Date.now();
      } else if (data.type === 'ready') {
        ready.current = true;
        lastBeat.current = Date.now();
        // Everything the scene needs to look right again goes first, then
        // whatever arrived while it was still parsing.
        REMEMBERED.forEach((type) => { const kept = memory.current.get(type); if (kept) send(kept); });
        const pending = queue.current; queue.current = [];
        pending.forEach((message) => send(message));
      } else if (data.type === 'tap' && data.hit && onTap) {
        onTap(data.hit);
      }
    } catch {
      // A message the scene did not mean to send is not worth a crash.
    }
  }, [onTap, send]);

  const onRenderProcessGone = useCallback((_event: WebViewRenderProcessGoneEvent) => {
    restarts.current = 0;
    restart();
  }, [restart]);

  if (failed) return <View style={[styles.wrap, { height }]} />;

  return (
    <View style={[styles.wrap, { height }]}>
      <WebView
        key={generation}
        ref={web}
        source={{ html: VAULT_SCENE_HTML }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled={false}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        androidLayerType="hardware"
        setBuiltInZoomControls={false}
        mixedContentMode="never"
        allowFileAccess={false}
        onMessage={onMessage}
        onError={() => setFailed(true)}
        onRenderProcessGone={onRenderProcessGone}
        style={styles.web}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#04070B', overflow: 'hidden' },
  web: { flex: 1, backgroundColor: '#04070B' },
});
