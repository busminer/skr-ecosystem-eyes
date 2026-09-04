"""The stake sound: a coin settling into the vault. A soft touch on a
glass bar, no strike with a warm ring that rises, and a small body under it so the phone
speaker still gives it weight. Written, not downloaded, like the rest."""
import math, struct, wave
RATE = 44_100
def env(t, a, d):
    return t / a if t < a else math.exp(-4.2 * (t - a) / d)
def noise(i):
    v = (i * 1_103_515_245 + 12_345) & 0x7FFFFFFF
    return (v / 0x3FFFFFFF) - 1.0
def stake(t, i):
    v = 0.0
    # the glass bar: fundamental and the inharmonic partial that says "glass"
    for f, g, d in ((880.0, 0.42, 0.42), (2430.0, 0.06, 0.12), (1760.0, 0.08, 0.22)):
        v += g * math.sin(2 * math.pi * f * t) * env(t, 0.010, d)
    # the ring that rises: a fifth above, arriving a hair later
    if t >= 0.07:
        p = t - 0.07
        v += 0.22 * math.sin(2 * math.pi * 1318.5 * p) * env(p, 0.02, 0.5)
    # the body
    v += 0.18 * math.sin(2 * math.pi * 220.0 * t) * env(t, 0.01, 0.35)
    return v
frames = bytearray(); total = int(RATE * 0.75)
for i in range(total):
    t = i / RATE
    edge = min(1.0, i / 60, (total - i) / 700)
    frames += struct.pack("<h", int(max(-1.0, min(1.0, stake(t, i))) * edge * 22_000))
with wave.open("out/stake.wav", "wb") as f:
    f.setnchannels(1); f.setsampwidth(2); f.setframerate(RATE); f.writeframes(bytes(frames))
print("stake.wav", len(frames) // 1024, "KB")
