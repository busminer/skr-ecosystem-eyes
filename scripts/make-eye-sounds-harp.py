# The walk-through sounds of the Eye, from two Mixkit recordings (see
# assets/sound/SOURCES.md). Run: python scripts/make-eye-sounds-harp.py <dir with 2628.wav and 657.wav> assets/sound
#
# Second pass, 28.09.2026 late: Alex found the first harp «немножко звонкий» (a little
# ringing, unpleasant). So: everything sits lower (the harp a fourth down), the top is
# rolled off hard (4th-order low-pass at 2.4 kHz), the pluck's click is softened with a
# slower fade-in, and a soft dark room is added so the notes bloom instead of ping.
import sys
import numpy as np
from fractions import Fraction
from scipy.io import wavfile
from scipy.signal import resample_poly, butter, sosfilt, fftconvolve

SR = 44100
SRC = sys.argv[1]
OUT = sys.argv[2]
rng = np.random.default_rng(7)


def load(name):
    sr, x = wavfile.read(f'{SRC}/{name}')
    x = x.astype(np.float64)
    if x.ndim > 1:
        x = x.mean(1)
    assert sr == SR
    return x / np.abs(x).max()


def cut(x, start, length, fade_in=0.03, fade_out=0.5):
    a = int(start * SR)
    y = x[a:a + int(length * SR)].copy()
    n_in = int(fade_in * SR)
    y[:n_in] *= np.sin(np.linspace(0, np.pi / 2, n_in)) ** 2
    n_out = int(fade_out * SR)
    y[-n_out:] *= np.linspace(1, 0, n_out) ** 2
    return y


def shift(x, semis):
    # a lower harp is the same harp played lower: resample, the length follows
    if semis == 0:
        return x
    r = Fraction(2 ** (-semis / 12)).limit_denominator(400)
    return resample_poly(x, r.numerator, r.denominator)


def dark(x, hz=2400):
    sos = butter(4, hz, 'low', fs=SR, output='sos')
    return sosfilt(sos, x)


# A soft dark room: decaying noise, itself low-passed, mixed in quietly.
IR_LEN = 1.6
t = np.arange(int(IR_LEN * SR)) / SR
IR = dark(rng.standard_normal(len(t)) * np.exp(-t / 0.45), 1800)
IR /= np.sqrt((IR ** 2).sum())


def room(x, wet=0.3):
    tail = fftconvolve(x, IR)[: len(x) + int(0.9 * SR)]
    y = np.zeros(len(tail))
    y[: len(x)] += x
    y += wet * tail / np.abs(tail).max() * np.abs(x).max()
    n = int(0.5 * SR)
    y[-n:] *= np.linspace(1, 0, n) ** 2
    return y


def save(name, x, peak):
    x = x / np.abs(x).max() * peak
    wavfile.write(f'{OUT}/{name}', SR, (x * 32767).astype(np.int16))
    print(name, f'{len(x) / SR:.2f}s', f'rms {np.sqrt((x ** 2).mean()):.3f}')


harp = load('2628.wav')     # Mixkit 2628 Relaxing harp sweep
bless = load('657.wav')     # Mixkit 657 Choir harp bless

# tone1..tone7: one ripple of the harp, a fourth lower, rising gently page by page
ripple = cut(harp, 1.72, 1.25, fade_out=0.75)
for i, semis in enumerate([-5, -3, -2, 0, 2, 3, 5], start=1):
    save(f'tone{i}.wav', room(dark(shift(ripple, semis))), 0.5)

# hum: the harp sweep rising, a fourth lower, as the walk-through appears
save('hum.wav', room(dark(shift(cut(harp, 0.9, 3.2, fade_in=0.4, fade_out=1.2), -5)), 0.25), 0.45)

# heart: the glissando building to its peak, before the lids part
save('heart.wav', room(dark(shift(cut(harp, 0.55, 1.95, fade_in=0.25, fade_out=0.6), 0)), 0.25), 0.5)

# chime: the choir and harp blessing, where a step lands, a tone lower and darker
save('chime.wav', room(dark(shift(cut(bless, 0.12, 2.3, fade_out=0.9), -2), 2800), 0.25), 0.5)
