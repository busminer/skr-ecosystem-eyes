"""Multi-touch through sendevent (protocol B), in one adb shell run, for testing the Iris explorer.

  python scripts/android-gesture.py pinch  x1 y1 x2 y2  x1e y1e x2e y2e  [steps] [ms]
  python scripts/android-gesture.py drag   x  y   xe ye                  [steps] [ms]
  python scripts/android-gesture.py hold   x  y   [ms]

Coordinates are pixels of the device screen (emulator 1080x2400, phone 1200x2670). A twist is a pinch
whose end points are the start points turned about their middle.

The emulator (emulator-5554, profile 'emu') takes all of it. The Seeker (MT_PROFILE=phone) refuses
sendevent from the shell (permission denied), so on the phone only single-finger input works
(`adb shell input tap/swipe`): zoom there with the + and - buttons.

On Windows Git Bash call it with a Windows path and MSYS_NO_PATHCONV=1 (the python here is the Windows one).
"""
import subprocess, sys, os, tempfile

PROFILE = os.environ.get('MT_PROFILE', 'emu')
if PROFILE == 'phone':
    SERIAL, DEV, W, H, MAXX, MAXY, BTN = 'SM02E4072810627', '/dev/input/event2', 1200, 2670, 1199, 2669, True
else:
    SERIAL, DEV, W, H, MAXX, MAXY, BTN = 'emulator-5554', '/dev/input/event2', 1080, 2400, 32767, 32767, False
ADB = ['adb', '-s', SERIAL]


def ax(x): return int(round(x * MAXX / W))
def ay(y): return int(round(y * MAXY / H))


def ev(t, c, v): return f'sendevent {DEV} {t} {c} {v}'
SLOT, TID, PX, PY, PRESS, MAJOR = 47, 57, 53, 54, 58, 48


def finger(slot, tid, x, y):
    return [ev(3, SLOT, slot), ev(3, TID, tid), ev(3, PX, ax(x)), ev(3, PY, ay(y)), ev(3, MAJOR, 30)] + ([] if PROFILE == 'phone' else [ev(3, PRESS, 60)])


def move(slot, x, y):
    return [ev(3, SLOT, slot), ev(3, PX, ax(x)), ev(3, PY, ay(y))]


def lift(slot):
    return [ev(3, SLOT, slot), ev(3, TID, -1)]


SYN = ev(0, 0, 0)
TOUCH = lambda down: [ev(1, 330, 1 if down else 0)] if BTN else []


def run(lines):
    body = '\n'.join(lines) + '\n'
    path = os.path.join(tempfile.gettempdir(), 'mt.sh')
    with open(path, 'w', newline='\n') as f:
        f.write(body)
    env = dict(os.environ, MSYS_NO_PATHCONV='1')
    subprocess.run(ADB + ['push', path, '/data/local/tmp/mt.sh'], check=True, capture_output=True, env=env)
    subprocess.run(ADB + ['shell', 'sh', '/data/local/tmp/mt.sh'], check=True, env=env)


def lerp(a, b, t): return a + (b - a) * t


def pinch(x1, y1, x2, y2, x1e, y1e, x2e, y2e, steps=14, ms=30):
    L = TOUCH(True) + finger(0, 100, x1, y1) + finger(1, 101, x2, y2) + [SYN]
    for i in range(1, steps + 1):
        t = i / steps
        L += move(0, lerp(x1, x1e, t), lerp(y1, y1e, t)) + move(1, lerp(x2, x2e, t), lerp(y2, y2e, t)) + [SYN, f'sleep {ms / 1000:.3f}']
    L += lift(0) + lift(1) + TOUCH(False) + [SYN]
    run(L)


def drag(x, y, xe, ye, steps=14, ms=30):
    L = TOUCH(True) + finger(0, 100, x, y) + [SYN, 'sleep 0.05']
    for i in range(1, steps + 1):
        t = i / steps
        L += move(0, lerp(x, xe, t), lerp(y, ye, t)) + [SYN, f'sleep {ms / 1000:.3f}']
    L += lift(0) + TOUCH(False) + [SYN]
    run(L)


def hold(x, y, ms=600):
    run(TOUCH(True) + finger(0, 100, x, y) + [SYN, f'sleep {ms / 1000:.3f}'] + lift(0) + TOUCH(False) + [SYN])


if __name__ == '__main__':
    cmd, a = sys.argv[1], [float(v) for v in sys.argv[2:]]
    if cmd == 'pinch':
        pinch(*a[:8], steps=int(a[8]) if len(a) > 8 else 14, ms=int(a[9]) if len(a) > 9 else 30)
    elif cmd == 'drag':
        drag(*a[:4], steps=int(a[4]) if len(a) > 4 else 14, ms=int(a[5]) if len(a) > 5 else 30)
    elif cmd == 'hold':
        hold(a[0], a[1], int(a[2]) if len(a) > 2 else 600)
