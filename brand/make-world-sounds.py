"""Makes the world's event sounds: a bird for a stake, a tudum for a large exit,
a drop for a small labelled stake, a coin for the streak, a door for a withdraw.
Written rather than downloaded, like the others: nothing licensed inside the
app, files of a few kilobytes, quiet by design."""
import math, struct, wave
RATE = 44_100
def env(t, a, d):
    return t / a if t < a else math.exp(-4.2 * (t - a) / d)
def noise(i):
    v = (i * 1_103_515_245 + 12_345) & 0x7FFFFFFF
    return (v / 0x3FFFFFFF) - 1.0
def chirp(t, start, f0, f1, dur, gain):
    if start <= t < start + dur * 2:
        p = t - start
        f = f0 * (f1 / f0) ** min(1.0, p / dur) if p < dur else f1 * (1.1 ** ((p - dur) / dur))
        return gain * math.sin(2 * math.pi * f * p) * env(p, 0.012, dur * 1.2)
    return 0.0
def bird(t, i):
    return chirp(t, 0.0, 1900, 2700, 0.07, 0.42) + chirp(t, 0.13, 2200, 3100, 0.08, 0.45) + chirp(t, 0.27, 1700, 2500, 0.06, 0.36)
def tudum(t, i):
    v = 0.0
    for start, f0, f1, dec, gain, nz in ((0.0, 110, 48, 0.28, 0.55, 0.5), (0.30, 95, 36, 0.9, 0.85, 0.7)):
        if start <= t < start + dec * 1.6:
            p = t - start
            f = f0 + (f1 - f0) * min(1.0, p / dec)
            v += gain * math.sin(2 * math.pi * f * p) * env(p, 0.012, dec)
    if 0.30 <= t: 
        p = t - 0.30
        v += 0.35 * math.sin(2 * math.pi * 44 * p) * env(p, 0.02, 1.1)
    return v
def drop(t, i):
    if t < 0.3:
        f = 1320 * (0.5 ** min(1.0, t / 0.16))
        return 0.5 * math.sin(2 * math.pi * f * t) * env(t, 0.004, 0.16)
    return 0.0
def coin(t, i):
    v = 0.0
    if t < 0.015: v += 0.5 * noise(i) * env(t, 0.0005, 0.006)
    if t < 0.09: v += 0.35 * math.sin(2 * math.pi * 2050 * t) * env(t, 0.001, 0.05)
    if 0.09 <= t < 0.2:
        p = t - 0.09
        v += 0.3 * math.sin(2 * math.pi * 1240 * p) * env(p, 0.001, 0.07)
    if 0.1 <= t:
        p = t - 0.1
        v += 0.32 * math.sin(2 * math.pi * 330 * p) * env(p, 0.02, 0.45) + 0.14 * math.sin(2 * math.pi * 495 * p) * env(p, 0.02, 0.4)
    return v
def door(t, i):
    v = 0.0
    if t < 0.05: v += 0.6 * noise(i) * env(t, 0.001, 0.02)
    if t < 0.5:
        f = 70 - 30 * min(1.0, t / 0.35)
        v += 0.55 * math.sin(2 * math.pi * f * t) * env(t, 0.005, 0.35)
    if 0.06 <= t < 0.5:
        p = t - 0.06
        v += 0.12 * noise(i * 7) * env(p, 0.01, 0.4) * 0.5
    return v
def render(name, length, voice, gain):
    frames = bytearray(); total = int(RATE * length)
    for i in range(total):
        t = i / RATE
        edge = min(1.0, i / 60, (total - i) / 700)
        s = max(-1.0, min(1.0, voice(t, i)))
        frames += struct.pack("<h", int(s * edge * gain))
    with wave.open(f"out/{name}", "wb") as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(RATE); f.writeframes(bytes(frames))
    print(name, len(frames) // 1024, "KB")
render("bird.wav", 0.55, bird, 20_000)
render("tudum.wav", 1.6, tudum, 26_000)
render("drop.wav", 0.32, drop, 18_000)
render("coin.wav", 0.7, coin, 22_000)
render("door.wav", 0.6, door, 24_000)
