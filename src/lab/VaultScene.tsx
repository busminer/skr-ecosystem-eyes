import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
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
  | { type: 'demo'; what: 'whalein' | 'whaleout' };

export type SceneTap = { kind: 'stake' | 'exit'; amount: number; who: string; sig: string; unlockAt?: number; ready?: boolean };

export type SceneHandle = { push: (message: SceneMessage) => void };

export const VaultScene = forwardRef<SceneHandle, { height: number; onTap?: (hit: SceneTap) => void }>(function VaultScene({ height, onTap }, ref) {
  const web = useRef<WebView>(null);
  const ready = useRef(false);
  const queue = useRef<SceneMessage[]>([]);
  const [failed, setFailed] = useState(false);

  const send = useCallback((message: SceneMessage) => {
    if (!ready.current) { queue.current.push(message); return; }
    web.current?.injectJavaScript(`window.__push(${JSON.stringify(message)});true;`);
  }, []);

  useImperativeHandle(ref, () => ({ push: send }), [send]);

  // A scene in a pocket must not draw a single frame.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => send({ type: 'pause', on: next !== 'active' }));
    return () => subscription.remove();
  }, [send]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as { type: string; hit?: SceneTap };
      if (data.type === 'ready') {
        ready.current = true;
        const pending = queue.current; queue.current = [];
        pending.forEach((message) => send(message));
      } else if (data.type === 'tap' && data.hit && onTap) {
        onTap(data.hit);
      }
    } catch {
      // A message the scene did not mean to send is not worth a crash.
    }
  }, [onTap, send]);

  if (failed) return <View style={[styles.wrap, { height }]} />;

  return (
    <View style={[styles.wrap, { height }]}>
      <WebView
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
        style={styles.web}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#04070B', overflow: 'hidden' },
  web: { flex: 1, backgroundColor: '#04070B' },
});
