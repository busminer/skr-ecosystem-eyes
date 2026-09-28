# The Eye's sounds, synthesised (28.09.2026).
#
# Alex on the walk-through of 27.09: the sound is unpleasant. It was: the old
# hum and heart sat at 85-110 Hz at full level, which a phone speaker cannot
# play, so it rattled instead. This set lives where the speaker is clean
# (fundamentals from 440 Hz up, everything under 250 Hz filtered away), in the
# register of the stake sound Alex picked by ear on 22.09 (A5 over E6, a soft
# mallet): a glass mallet, consonant intervals from A major pentatonic, soft
# attacks, a short room behind every note.
#
#   tone1..tone7  one note per page of the walk-through, rising: A4 B4 C#5 E5 F#5 A5 B5
#   chime         a step lights up (A5 with a quiet fifth)
#   heart         a soft swell before the lids part (the phone knocks twice with it)
#
# wake.wav and wink.wav are NOT made here: they are the app's launch sounds
# (src/lab/Splash.tsx) and Alex wants the launch as it was (28.09). The Eye
# opening and the Blink keep using those originals.
#   hum           a faint pad, once when the walk-through first appears
#
# python scripts/make-eye-sounds.py  -> writes assets/sound/*.wav (44.1 kHz mono 16-bit)

import os
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

SR = 44_100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'sound')
rng = np.random.default_rng(7)

NOTE = {'A4': 440.0, 'B4': 493.88, 'C#5': 554.37, 'E5': 659.26, 'F#5': 739.99, 'A5': 880.0,
        'B5': 987.77, 'C#6': 1108.73, 'E6': 1318.51}


def t_axis(seconds):
    return np.arange(int(seconds * SR)) / SR


def attack(t, ms):
    a = ms / 1000
    return np.where(t < a, 0.5 - 0.5 * np.cos(np.pi * np.clip(t / a, 0, 1)), 1.0)


def mallet(freq, seconds=1.8, decay=0.55, bright=1.0, fifth=0.0, octave=0.22):
    """A soft glass mallet: FM 1:1 with an index that dies fast, so the strike
    is bright for a moment and then a pure tone rings on."""
    t = t_axis(seconds)
    index = bright * (1.1 * np.exp(-t / 0.07) + 0.12)
    body = np.sin(2 * np.pi * freq * t + index * np.sin(2 * np.pi * freq * t))
    body += octave * np.sin(2 * np.pi * 2 * freq * t) * np.exp(-t / (decay * 0.35))
    if fifth:
        body += fifth * np.sin(2 * np.pi * 1.5 * freq * t) * np.exp(-t / (decay * 0.8))
    return body * attack(t, 5) * np.exp(-t / decay)


def pad(freqs, seconds, rise, fall, level=0.12):
    """A warm pad: each note as two sines two cents apart, slow in, slow out."""
    t = t_axis(seconds)
    out = np.zeros_like(t)
    for f in freqs:
        for cents in (-2.0, 2.0):
            ff = f * 2 ** (cents / 1200)
            out += np.sin(2 * np.pi * ff * t + rng.uniform(0, 2 * np.pi))
    env = np.clip(t / rise, 0, 1) ** 1.5
    env *= np.clip((seconds - t) / fall, 0, 1) ** 1.2
    return level * out * env / len(freqs)


def place(buf, sound, at):
    i = int(at * SR)
    end = min(len(buf), i + len(sound))
    buf[i:end] += sound[:end - i]


def room(x, wet=0.2, tail=0.28):
    """A small bright room: filtered noise dying away, after 18 ms."""
    n = int(tail * 7 * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-t / tail)
    ir = sosfilt(butter(2, [350, 5200], btype='band', fs=SR, output='sos'), ir)
    ir = np.concatenate([np.zeros(int(0.018 * SR)), ir])
    ir /= np.sqrt((ir ** 2).sum())
    w = fftconvolve(x, ir)[:len(x)]
    return (1 - wet) * x + wet * w * 0.9


def finish(x, peak, name):
    x = sosfilt(butter(2, 250, btype='high', fs=SR, output='sos'), x)
    x = sosfilt(butter(2, 7000, btype='low', fs=SR, output='sos'), x)
    fade = int(0.15 * SR)
    x[-fade:] *= np.linspace(1, 0, fade) ** 2
    x[:32] *= np.linspace(0, 1, 32)
    x = x / np.abs(x).max() * peak
    path = os.path.join(OUT, f'{name}.wav')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())
    print(f'{name:6s} {len(x) / SR:4.2f}s peak {peak}')


def with_tail(sound, extra=0.6):
    return np.concatenate([sound, np.zeros(int(extra * SR))])


# Pages: one rising note each. The lower notes get a quiet fifth so a small
# speaker still hears them full; the higher ones are a touch softer, as the
# ear hears high notes louder.
for n, name in enumerate(['A4', 'B4', 'C#5', 'E5', 'F#5', 'A5', 'B5'], start=1):
    f = NOTE[name]
    fifth = 0.2 if f < 600 else 0.08
    peak = 0.46 - 0.02 * (n - 1)
    finish(room(with_tail(mallet(f, 1.4, 0.5, 0.9, fifth=fifth)), 0.22), peak, f'tone{n}')

# A step lights up: A5 with a quiet fifth, shorter than a page note.
chime = mallet(NOTE['A5'], 0.9, 0.32, 0.8, fifth=0.0, octave=0.15)
chime += 0.28 * mallet(NOTE['E6'], 0.9, 0.26, 0.6, octave=0.0)
finish(room(with_tail(chime, 0.5), 0.2), 0.40, 'chime')

# Before the lids part: a soft swell that stops just as the Eye opens.
t = t_axis(1.25)
swell = pad([NOTE['E5'], NOTE['A5']], 1.25, 1.0, 0.18, level=1.0)
swell *= np.clip(t / 1.05, 0, 1) ** 2
finish(room(with_tail(swell, 0.4), 0.25, tail=0.22), 0.30, 'heart')

# Once, when the walk-through appears: a faint A add9 pad.
finish(room(pad([NOTE['A4'], NOTE['E5'], NOTE['B5'], NOTE['C#6']], 3.0, 0.8, 1.4, level=1.0), 0.25, tail=0.3), 0.26, 'hum')
