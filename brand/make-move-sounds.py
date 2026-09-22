"""Three neutral voices for the three large moves.

The old set was literal: an old phone ringing, a cinematic tudum, a door.
Loud characters for what is really just a number crossing a line. These are
instruments instead: one soft mallet on metal, three intervals.

  in    a fifth going up, warm        - a large stake landed
  out   one low tone bending down     - a large exit was asked for
  gone  a short fall, dry             - a large withdrawal actually left

Same hand as the rest of the set: written, not downloaded.
"""
import math, struct, wave, pathlib

RATE = 44_100
HERE = pathlib.Path(__file__).resolve().parent


def env(t, a, d):
    """Attack then exponential decay."""
    return t / a if t < a else math.exp(-4.2 * (t - a) / d)


def write(name, fn, seconds, peak=20_000):
    frames = bytearray()
    total = int(RATE * seconds)
    for i in range(total):
        t = i / RATE
        # a short fade at both ends so the speaker never clicks
        edge = min(1.0, i / 80, (total - i) / 900)
        v = max(-1.0, min(1.0, fn(t)))
        frames += struct.pack("<h", int(v * edge * peak))
    path = HERE / name
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(bytes(frames))
    print(name, round(seconds, 2), "s", len(frames) // 1024, "KB")


# ---------------------------------------------------------------- in
# A large stake arriving. Two mallet tones a fifth apart, the upper one a
# breath later, so it reads as arrival rather than alarm. E4 and B4.
def cue_in(t):
    v = 0.0
    for f, g, d in ((329.6, 0.34, 0.55), (659.3, 0.20, 0.40), (1318.5, 0.05, 0.16)):
        v += g * math.sin(2 * math.pi * f * t) * env(t, 0.012, d)
    if t >= 0.085:
        p = t - 0.085
        for f, g, d in ((493.9, 0.26, 0.60), (987.8, 0.07, 0.22)):
            v += g * math.sin(2 * math.pi * f * p) * env(p, 0.014, d)
    # a little body so a phone speaker still gives it weight
    v += 0.14 * math.sin(2 * math.pi * 164.8 * t) * env(t, 0.010, 0.30)
    return v


# ---------------------------------------------------------------- out
# A large exit asked for. Nothing has moved yet, so nothing dramatic: one low
# tone that bends down a whole step and sits there. E3 falling to D3.
def cue_out(t):
    bend = 164.8 - 17.0 * min(1.0, t / 0.38)
    phase = 2 * math.pi * bend * t
    v = 0.40 * math.sin(phase) * env(t, 0.018, 0.75)
    v += 0.16 * math.sin(2 * phase) * env(t, 0.018, 0.34)
    v += 0.05 * math.sin(3 * phase) * env(t, 0.020, 0.16)
    return v


# ---------------------------------------------------------------- gone
# A large withdrawal that actually left. A short fall, dry, quieter than the
# other two: it is the end of something, not the start. D5 to G4.
def cue_gone(t):
    v = 0.0
    for f, g, d in ((587.3, 0.30, 0.20), (1174.7, 0.06, 0.09)):
        v += g * math.sin(2 * math.pi * f * t) * env(t, 0.008, d)
    if t >= 0.10:
        p = t - 0.10
        for f, g, d in ((392.0, 0.30, 0.34), (784.0, 0.05, 0.12)):
            v += g * math.sin(2 * math.pi * f * p) * env(p, 0.010, d)
    return v


write("in.wav", cue_in, 0.85)
write("out.wav", cue_out, 0.95)
write("gone.wav", cue_gone, 0.62, peak=17_500)
