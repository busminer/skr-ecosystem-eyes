import sys, numpy as np
from fractions import Fraction
from scipy.io import wavfile
from scipy.signal import resample_poly, butter, sosfilt

SR = 44100
SRC = sys.argv[1]
OUT = sys.argv[2]

def load(name):
    sr, x = wavfile.read(f'{SRC}/{name}')
    x = x.astype(np.float64)
    if x.ndim > 1:
        x = x.mean(1)
    assert sr == SR
    return x / np.abs(x).max()

def cut(x, start, length, fade_in=0.006, fade_out=0.5):
    a = int(start * SR)
    y = x[a:a + int(length * SR)].copy()
    n_in = int(fade_in * SR)
    y[:n_in] *= np.linspace(0, 1, n_in)
    n_out = int(fade_out * SR)
    y[-n_out:] *= np.linspace(1, 0, n_out) ** 2
    return y

def shift(x, semis):
    # a higher harp is the same harp played higher: resample, the length follows
    if semis == 0:
        return x
    r = Fraction(2 ** (-semis / 12)).limit_denominator(400)
    return resample_poly(x, r.numerator, r.denominator)

def soften(x, hz=6000):
    sos = butter(2, hz, 'low', fs=SR, output='sos')
    return sosfilt(sos, x)

def save(name, x, peak):
    x = x / np.abs(x).max() * peak
    wavfile.write(f'{OUT}/{name}', SR, (x * 32767).astype(np.int16))
    print(name, f'{len(x) / SR:.2f}s', f'rms {np.sqrt((x ** 2).mean()):.3f}')

harp = load('2628.wav')     # Mixkit 2628 Relaxing harp sweep
bless = load('657.wav')     # Mixkit 657 Choir harp bless

# tone1..tone7: one ripple of the harp, a step higher per page (major scale)
ripple = soften(cut(harp, 1.72, 1.25, fade_out=0.75))
for i, semis in enumerate([0, 2, 4, 5, 7, 9, 11], start=1):
    save(f'tone{i}.wav', shift(ripple, semis), 0.42)

# hum: the harp sweep rising, as the walk-through appears
save('hum.wav', soften(cut(harp, 0.9, 3.2, fade_in=0.4, fade_out=1.2)), 0.42)

# heart: the glissando building to its peak, before the lids part
save('heart.wav', soften(cut(harp, 0.55, 1.95, fade_in=0.25, fade_out=0.6)), 0.5)

# chime: the choir and harp blessing, where a step lands
save('chime.wav', soften(cut(bless, 0.12, 2.3, fade_out=0.9)), 0.5)
