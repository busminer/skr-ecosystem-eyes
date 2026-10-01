"""Slow frames from `dumpsys gfxinfo <pkg> framestats` (stdin), with the UI thread's share of each.

  adb -s SM02E4072810627 shell dumpsys gfxinfo dev.alexkosa.skreyes.lab reset
  ... touch something, wait ...
  adb -s SM02E4072810627 shell dumpsys gfxinfo dev.alexkosa.skreyes.lab framestats | python scripts/android-framestats.py 20

Only the last 120 frames are kept by Android, so measure one action at a time. Column positions are
those of Android 15 (the Seeker): IntendedVsync 2, HandleInputStart 5, SyncQueued 13, FrameCompleted 17.
The Seeker's screen runs at 120 Hz: a frame is late past 8.3 ms, a frame of ~15 ms is ordinary.
A UI-thread share above ~100 ms in one frame is react-native-svg drawing a picture or a big mount.
"""
import sys
rows = []
on = False
for line in sys.stdin:
    line = line.strip()
    if line.startswith('---PROFILEDATA---'):
        on = not on
        continue
    if on and line and line[0].isdigit():
        p = line.split(',')
        if len(p) > 21 and p[0] == '0':
            rows.append(dict(iv=int(p[2]), ui=int(p[13]) - int(p[5]), sync=int(p[14]) - int(p[13]),
                             draw=int(p[16]) - int(p[15]), total=int(p[17]) - int(p[2])))
rows.sort(key=lambda r: r['iv'])
if not rows:
    print('no frames'); sys.exit()
t0 = rows[0]['iv']
thr = float(sys.argv[1]) if len(sys.argv) > 1 else 20
print(f"frames: {len(rows)}   window: {(rows[-1]['iv'] - t0) / 1e9:.2f}s   slow (>{thr:.0f} ms):")
for r in rows:
    if r['total'] / 1e6 >= thr:
        print(f"  t=+{(r['iv'] - t0) / 1e9:5.2f}s  total {r['total'] / 1e6:6.1f} ms   ui-thread {r['ui'] / 1e6:6.1f}   sync {r['sync'] / 1e6:5.1f}   draw-cmds {r['draw'] / 1e6:5.1f}")
