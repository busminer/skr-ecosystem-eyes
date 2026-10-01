import { cloneElement, createContext, forwardRef, isValidElement, useState, type ReactElement } from 'react';
import { ScrollView, type RefreshControlProps, type ScrollViewProps } from 'react-native';

// The page's own scroll, which the Iris can hold still. A person who explores the world with two
// fingers (or drags a magnified one) must not also scroll the page under their hand, and a vertical
// scroller takes such a drag from its children natively unless it is told not to. The Iris calls the
// context's setter on the first touch that is meant for it and again when the touch ends.
//
// The state lives here, beside the ScrollView and nowhere else, so locking and unlocking re-renders
// the scroller and not the whole tab: `children` is the same element before and after.
export const ScrollLockContext = createContext<(locked: boolean) => void>(() => undefined);

export const LockableScroll = forwardRef<ScrollView, ScrollViewProps>(function LockableScroll({ children, scrollEnabled = true, refreshControl, ...rest }, ref) {
  const [locked, setLocked] = useState(false);
  // Pull to refresh takes a downward drag at the top of the page just as the scroller does, so it
  // is held still too while the Iris has the touch.
  const refresh = isValidElement(refreshControl) ? cloneElement(refreshControl as ReactElement<RefreshControlProps>, { enabled: !locked }) : refreshControl;
  return (
    <ScrollLockContext.Provider value={setLocked}>
      <ScrollView ref={ref} scrollEnabled={scrollEnabled && !locked} refreshControl={refresh} {...rest}>{children}</ScrollView>
    </ScrollLockContext.Provider>
  );
});
