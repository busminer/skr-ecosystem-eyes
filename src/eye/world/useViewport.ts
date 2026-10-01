import { useCallback, useEffect, useRef } from 'react';
import { Easing, cancelAnimation, useSharedValue, withTiming } from 'react-native-reanimated';
import { IDENTITY, wrapAngle, type Viewport } from './viewport';

// The viewport of the Iris as shared values, so the picture and the names that follow it move on
// the UI thread without React drawing anything per touch, and the same four numbers on the JS
// side (`view`) for the maths of touch, names and flights.
//
// `view.current` always holds where the viewport is going, not where it is on the way: a touch
// that lands during a flight first finishes the flight (`snap`), so a finger never fights an
// animation.

export type ViewShared = ReturnType<typeof useViewportValues>;

function useViewportValues() {
  return { s: useSharedValue(1), a: useSharedValue(0), x: useSharedValue(0), y: useSharedValue(0) };
}

export function useViewport(onChange: () => void) {
  const shared = useViewportValues();
  const view = useRef<Viewport>(IDENTITY);
  // The angle the shared value was last given, unwrapped, so a turn through half a circle goes the
  // short way round instead of spinning back the long one. (A picture baked for the viewport keeps
  // the same unwrapped angle, so the difference between the two is a small turn, never a full one.)
  const angle = useRef(0);
  const flying = useRef<ReturnType<typeof setTimeout> | null>(null);
  const change = useRef(onChange);
  change.current = onChange;

  const assign = useCallback((v: Viewport, ms: number) => {
    const turned = angle.current + wrapAngle(v.a - angle.current);
    angle.current = turned;
    if (ms > 0) {
      const o = { duration: ms, easing: Easing.out(Easing.cubic) };
      shared.s.value = withTiming(v.s, o);
      shared.a.value = withTiming(turned, o);
      shared.x.value = withTiming(v.x, o);
      shared.y.value = withTiming(v.y, o);
    } else {
      shared.s.value = v.s;
      shared.a.value = turned;
      shared.x.value = v.x;
      shared.y.value = v.y;
    }
  }, [shared]);

  const set = useCallback((v: Viewport, ms = 0) => {
    view.current = { ...v, a: wrapAngle(v.a) };
    assign(view.current, ms);
    if (flying.current) { clearTimeout(flying.current); flying.current = null; }
    if (ms > 0) flying.current = setTimeout(() => { flying.current = null; }, ms + 40);
    change.current();
  }, [assign]);

  // End a flight where it was going.
  const snap = useCallback(() => {
    if (!flying.current) return;
    clearTimeout(flying.current);
    flying.current = null;
    cancelAnimation(shared.s); cancelAnimation(shared.a); cancelAnimation(shared.x); cancelAnimation(shared.y);
    assign(view.current, 0);
  }, [assign, shared]);

  useEffect(() => () => { if (flying.current) clearTimeout(flying.current); }, []);

  // True while a flight (an animated move) has not yet arrived.
  const busy = useCallback(() => flying.current != null, []);

  return { shared, view, angle, set, snap, busy };
}
