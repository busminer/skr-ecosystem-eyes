# The Eye's sounds, synthesised. Second set, 28.09.2026.
#
# Alex on the first set (a glass mallet from 440 Hz up): "a squeak", "disgusting";
# he wants something mystical, in tune with a Solana Mobile Seeker's night-sky
# look. So this set is lower, slower and wider: struck singing bowls whose
# partials beat against each other, a soft glass voice an octave above them, a
# drone of D, A and E with air in it, and a long dark room behind everything.
# The key is D Lydian (D E F# A B C#), which sounds open and a little unearthly.
# Nothing sits under 200 Hz, where a phone speaker rattles instead of playing.
#
#   tone1..tone7  one bowl per page of the walk-through, rising: D4 E4 F#4 A4 B4 C#5 D5
#   chime         a step is done: a small bowl on A4 with a glass shimmer
#   heart         a breath drawn in before the lids part: a reversed bowl and air
#   hum           once, when the walk-through appears: a drone of D, A and E
#
# wake.wav and wink.wav are NOT made here: they are the app's launch sounds
# (src/lab/Splash.tsx, SplashTurn.tsx) and stay the originals Alex chose.
#
# python scripts/make-eye-sounds.py  -> assets/sound/*.wav (44.1 kHz mono 16-bit)

import os
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

SR = 44_100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'sound')
rng = np.random.default_rng(11)

NOTE = {'D4': 293.66, 'E4': 329.63, 'F#4': 369.99, 'A4': 440.0, 'B4': 493.88, 'C#5': 554.37,
        'D5': 587.33, 'E5': 659.26, 'A5': 880.0}


def axis(seconds):
    return np.arange(int(seconds * SR)) / SR


def band(x, lo, hi):
    return sosfilt(butter(2, [lo, hi], btype='band', fs=SR, output='sos'), x)


def bowl(freq, seconds=3.2, ring=2.6, level=1.0):
    """A struck singing bowl: four inharmonic partials, each a pair of sines a
    fraction of a hertz apart so they beat slowly (the bowl's 'wah'), a felt
    mallet that takes 14 ms to land, and a little thump of the strike."""
    t = axis(seconds)
    out = np.zeros_like(t)
    for ratio, amp, decay, beat in ((1.0, 1.0, 1.0, 0.7), (2.76, 0.42, 0.55, 1.3), (5.40, 0.16, 0.3, 2.1), (8.93, 0.06, 0.18, 3.0)):
        f = freq * ratio
        if f > 7000:
            continue
        phase = rng.uniform(0, 2 * np.pi)
        pair = np.sin(2 * np.pi * (f - beat / 2) * t + phase) + np.sin(2 * np.pi * (f + beat / 2) * t + phase * 0.7)
        out += amp * 0.5 * pair * np.exp(-t / (ring * decay))
    land = np.clip(t / 0.014, 0, 1)
    out *= 0.5 - 0.5 * np.cos(np.pi * land)
    thump = band(rng.standard_normal(len(t)), 250, 1400) * np.exp(-t / 0.012) * 0.05
    return level * (out + thump)


def glass(freq, seconds=2.8, level=0.2):
    """A soft glass voice: slow to speak (90 ms), a slow vibrato, fading long."""
    t = axis(seconds)
    vib = 1 + 0.0025 * np.sin(2 * np.pi * 4.6 * t)
    phase = 2 * np.pi * np.cumsum(freq * vib) / SR
    tone = np.sin(phase) + 0.3 * np.sin(2 * phase) + 0.08 * np.sin(3 * phase)
    env = np.clip(t / 0.09, 0, 1) ** 2 * np.exp(-t / (seconds * 0.35))
    return level * tone * env


def aura(freqs, seconds, rise, fall, level=1.0):
    """A drone: every note three sines a few cents apart, breathing slowly, with
    a thin band of air above it."""
    t = axis(seconds)
    out = np.zeros_like(t)
    for i, f in enumerate(freqs):
        for cents in (-7.0, 0.0, 7.0):
            ff = f * 2 ** (cents / 1200)
            out += np.sin(2 * np.pi * ff * t + rng.uniform(0, 2 * np.pi))
    out /= 3 * len(freqs)
    breath = 0.8 + 0.2 * np.sin(2 * np.pi * 0.35 * t + 1.1)
    air = band(rng.standard_normal(len(t)), 2500, 6000) * 0.02
    env = np.clip(t / rise, 0, 1) ** 1.6 * np.clip((seconds - t) / fall, 0, 1) ** 1.3
    return level * (out * breath + air) * env


def room(x, wet=0.35, seconds=2.4):
    """A dark hall: early echoes, then a tail that loses its highs first."""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    tail = (band(rng.standard_normal(n), 200, 1200) * np.exp(-t / 0.75)
            + band(rng.standard_normal(n), 1200, 3200) * np.exp(-t / 0.45) * 0.7
            + band(rng.standard_normal(n), 3200, 7000) * np.exp(-t / 0.22) * 0.35)
    ir = np.zeros(n + int(0.03 * SR))
    for ms, g in ((11, 0.5), (19, 0.4), (29, 0.33), (43, 0.25), (61, 0.18)):
        ir[int(ms / 1000 * SR)] += g
    ir[int(0.03 * SR):] += tail * 0.9
    ir /= np.sqrt((ir ** 2).sum())
    w = fftconvolve(x, ir)[:len(x)]
    return (1 - wet) * x + wet * w


def pad(x, seconds):
    return np.concatenate([x, np.zeros(int(seconds * SR))])


def finish(x, peak, name):
    x = sosfilt(butter(2, 200, btype='high', fs=SR, output='sos'), x)
    x = sosfilt(butter(2, 6500, btype='low', fs=SR, output='sos'), x)
    fade = int(0.3 * SR)
    x[-fade:] *= np.linspace(1, 0, fade) ** 2
    x[:64] *= np.linspace(0, 1, 64)
    x = x / np.abs(x).max() * peak
    with wave.open(os.path.join(OUT, f'{name}.wav'), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())
    print(f'{name:6s} {len(x) / SR:4.2f}s peak {peak}')


# A bowl per page, rising through D Lydian, each with a glass voice an octave
# above it that arrives a moment later.
for n, name in enumerate(['D4', 'E4', 'F#4', 'A4', 'B4', 'C#5', 'D5'], start=1):
    f = NOTE[name]
    s = pad(bowl(f, 3.4, 2.4), 0.6)
    g = glass(f * 2, 2.8, 0.14)
    s[int(0.06 * SR):int(0.06 * SR) + len(g)] += g
    finish(room(s, 0.38), 0.5 - 0.015 * (n - 1), f'tone{n}')

# A step is done: a small bowl on A4, a glass shimmer on E5 above it.
chime = pad(bowl(NOTE['A4'], 2.2, 1.4), 0.6)
g = glass(NOTE['E5'], 1.8, 0.16)
chime[int(0.04 * SR):int(0.04 * SR) + len(g)] += g
finish(room(chime, 0.36), 0.44, 'chime')

# Before the lids part: a bowl on D played backwards, so it swells instead of
# fading, with air rising under it; it stops dead as the Eye opens.
back = bowl(NOTE['D4'], 1.5, 0.9)[::-1] + 0.6 * aura([NOTE['A4'], NOTE['E5']], 1.5, 1.2, 0.05)
t = axis(1.5)
back *= np.clip(t / 1.4, 0, 1) ** 1.5
finish(room(pad(back, 0.5), 0.3, 1.6), 0.36, 'heart')

# Once, when the walk-through appears: D, A and E breathing, a bowl far off.
drone = aura([NOTE['D4'], NOTE['A4'], NOTE['E5']], 4.2, 1.2, 1.8)
far = bowl(NOTE['A4'], 3.0, 2.2, 0.18)
drone[int(0.9 * SR):int(0.9 * SR) + len(far)] += far[:len(drone) - int(0.9 * SR)]
finish(room(drone, 0.42), 0.34, 'hum')
