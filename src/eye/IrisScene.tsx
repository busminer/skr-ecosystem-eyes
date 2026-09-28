import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { prefValue } from '../prefs';
import { IRIS_SCENE_HTML } from './irisSceneHtml';

// The React side of the Iris. Like the vault's wrapper it owns nothing about
// drawing: it hands the scene what the tab knows and relays taps back.
//
// Messages are queued until the page says it is ready, and the last picture
// is remembered so a WebView that Android killed in the background can be
// replaced and refilled without the tab noticing.
//
// The beam sweeps at the pace the person chose on Pulse (live, calm, off),
// read the same way the radar reads it: once when the scene is ready and
// again each time the app comes back to the front.

export type IrisMessage =
  | { type: 'network'; eyes: Array<{ s: number; r: number; b: number; pf: number }>; ringCounts: number[] | null; me: { serial: number; ring: number } | null; callout: { title: string; sub: string } | null; empty: boolean }
  | { type: 'blink'; items: Array<{ serial: number; ring: number }> }
  | { type: 'motion'; mode: 'live' | 'calm' | 'off' }
  | { type: 'pause'; on: boolean }
  | { type: 'reset' };

// How far in and where to the person has moved the field: the same numbers
// the radar keeps, so the tab can move the Eye at the centre with it.
export type IrisView = { zoom: number; panX: number; panY: number };

export type IrisHandle = { push: (message: IrisMessage) => void };

const motionMode = (): 'live' | 'calm' | 'off' => (prefValue('motion:off', false) ? 'off' : prefValue('motion:calm', false) ? 'calm' : 'live');

export const IrisScene = forwardRef<IrisHandle, { size: number; onTap?: (serial: number) => void; onView?: (view: IrisView) => void }>(function IrisScene({ size, onTap, onView }, ref) {
  const web = useRef<WebView>(null);
  const ready = useRef(false);
  const queue = useRef<IrisMessage[]>([]);
  const picture = useRef<IrisMessage | null>(null);
  const [failed, setFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  const mountedAt = useRef(Date.now());
  const restarts = useRef(0);

  const send = useCallback((message: IrisMessage) => {
    if (message.type === 'network') picture.current = message;
    if (!ready.current) { queue.current.push(message); return; }
    web.current?.injectJavaScript(`window.__push(${JSON.stringify(message)});true;`);
  }, []);

  useImperativeHandle(ref, () => ({ push: send }), [send]);

  // A flash queued while the app was in a pocket waits; nothing is drawn there.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') send({ type: 'motion', mode: motionMode() });
      send({ type: 'pause', on: next !== 'active' });
    });
    return () => subscription.remove();
  }, [send]);

  const restart = useCallback(() => {
    if (restarts.current >= 3) return;
    restarts.current += 1;
    ready.current = false;
    queue.current = [];
    mountedAt.current = Date.now();
    setGeneration((current) => current + 1);
  }, []);

  // A page that has not said 'ready' six seconds after mounting is replaced.
  useEffect(() => {
    mountedAt.current = Date.now();
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      if (!ready.current && Date.now() - mountedAt.current > 6_000) restart();
    }, 3_000);
    return () => clearInterval(timer);
  }, [generation, restart]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as { type: string; serial?: number; zoom?: number; panX?: number; panY?: number };
      if (data.type === 'ready') {
        ready.current = true;
        const kept = picture.current;
        const pending = queue.current.filter((message) => message !== kept);
        queue.current = [];
        send({ type: 'motion', mode: motionMode() });
        if (kept) send(kept);
        pending.forEach((message) => send(message));
      } else if (data.type === 'tap' && typeof data.serial === 'number' && onTap) {
        onTap(data.serial);
      } else if (data.type === 'view' && typeof data.zoom === 'number' && typeof data.panX === 'number' && typeof data.panY === 'number' && onView) {
        onView({ zoom: data.zoom, panX: data.panX, panY: data.panY });
      }
    } catch {
      // A message the scene did not mean to send is not worth a crash.
    }
  }, [onTap, onView, send]);

  if (failed) return <View style={[styles.wrap, { width: size, height: size }]} />;

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <WebView
        key={generation}
        ref={web}
        source={{ html: IRIS_SCENE_HTML }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled={false}
        scrollEnabled={false}
        // A touch that starts on the field stays with the field: the list
        // around it does not take a drag for a scroll, so one finger pans
        // and two pinch, as on the radar. Off the field the page scrolls.
        nestedScrollEnabled
        bounces={false}
        overScrollMode="never"
        androidLayerType="hardware"
        setBuiltInZoomControls={false}
        mixedContentMode="never"
        allowFileAccess={false}
        onMessage={onMessage}
        onError={() => setFailed(true)}
        onRenderProcessGone={() => { restarts.current = 0; restart(); }}
        style={styles.web}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#04070B', overflow: 'hidden' },
  web: { flex: 1, backgroundColor: '#04070B' },
});
