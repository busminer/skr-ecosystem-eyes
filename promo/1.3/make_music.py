"""Write the two music beds under the 1.3 promo.

    python promo/1.3/make_music.py

Synthesis, like the app's own sounds (`brand/make-move-sounds.py`): nothing is
borrowed, so nothing can be claimed. Two beds off one chord loop, so the calm
cut and the punchy cut are recognisably the same film:

  calm.wav   a slow pad and a sub, eight seconds to a chord
  pulse.wav  the same chords at half the length, with a soft four-on-the-floor,
             an off-beat tick and a gated pad, for the cut that has to move

Both are mixed far under the voice; the film ducks them again where a line
lands. The key is A minor, which is where the app's own move sounds already sit
(the fifth up on a stake is A to E).
"""
import numpy as np
import pathlib
import wave

SR = 48_000
HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "music"
OUT.mkdir(exist_ok=True)

# A minor, the key the move sounds already live in
A2, C3, D3, E3, F3, G3 = 110.0, 130.81, 146.83, 164.81, 174.61, 196.0
# i - VI - III - VII, the plainest progression there is, on purpose: it has to
# hold a voice up for a minute without ever asking to be listened to.
CHORDS = [
    (A2, [220.00, 261.63, 329.63]),   # Am
    (F3, [174.61, 261.63, 349.23]),   # F
    (C3, [261.63, 329.63, 392.00]),   # C
    (G3, [196.00, 293.66, 392.00]),   # G
]


def env(n, attack, release):
    e = np.ones(n)
    a, r = int(attack * SR), int(release * SR)
    if a: e[:a] = np.linspace(0, 1, a) ** 1.6
    if r: e[-r:] = np.linspace(1, 0, r) ** 1.6
    return e


def voice(freq, n, detune=0.004, harmonics=(1.0, 0.42, 0.18, 0.08)):
    """One pad note: a few partials, each doubled a hair off pitch."""
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k, level in enumerate(harmonics, start=1):
        for d in (1 - detune, 1 + detune):
            phase = 2 * np.pi * freq * k * d * t + np.random.rand() * 6.28
            out += level * np.sin(phase) / k
    # a slow breath across the note, so a held chord is never quite still
    return out * (1 + 0.06 * np.sin(2 * np.pi * 0.11 * t))


def smear(x, taps=((0.035, 0.34), (0.081, 0.22), (0.152, 0.13), (0.243, 0.07))):
    """A cheap room: a handful of quiet delayed copies."""
    out = x.copy()
    for delay, level in taps:
        d = int(delay * SR)
        out[d:] += x[:-d] * level
    return out


def lowpass(x, cutoff):
    """One-pole, enough to take the edge off noise."""
    a = np.exp(-2 * np.pi * cutoff / SR)
    out = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = a * acc + (1 - a) * v
        out[i] = acc
    return out


def write(path, x):
    x = x / max(1e-9, np.abs(x).max()) * 0.9
    data = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    print(path.name, f"{len(x)/SR:.1f}s")


def bed(bar_seconds, total_seconds, pulse):
    n = int(total_seconds * SR)
    mix = np.zeros(n + SR)
    bar = int(bar_seconds * SR)
    np.random.seed(7)

    for i in range(int(np.ceil(total_seconds / bar_seconds))):
        root, notes = CHORDS[i % len(CHORDS)]
        at = i * bar
        length = bar + int(0.9 * SR)          # chords overlap, never a gap
        if pulse:
            # gated: the pad breathes in eighths instead of lying flat
            t = np.arange(length) / SR
            gate = 0.55 + 0.45 * (0.5 + 0.5 * np.sin(2 * np.pi * (1 / (bar_seconds / 4)) * t - np.pi / 2)) ** 2
        else:
            gate = 1.0
        pad = sum(voice(f, length) for f in notes) / len(notes)
        pad *= env(length, 0.9 if not pulse else 0.35, 0.8) * gate * 0.30
        sub = np.sin(2 * np.pi * root / 2 * np.arange(length) / SR) * env(length, 0.5, 0.6) * 0.22
        mix[at:at + length] += smear(pad) * 0.55 + pad * 0.45 + sub

    if pulse:
        beat = bar_seconds / 4                 # four to the bar
        for i in range(int(total_seconds / beat)):
            at = int(i * beat * SR)
            k = int(0.22 * SR)
            t = np.arange(k) / SR
            # kick: a sine dropping from 120 to 44 Hz
            f = 44 + 76 * np.exp(-t * 34)
            kick = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 15) * 0.5
            mix[at:at + k] += kick
            # an off-beat tick, filtered noise, very quiet
            half = at + int(beat / 2 * SR)
            h = int(0.06 * SR)
            tick = np.random.randn(h) * np.exp(-np.arange(h) / SR * 90) * 0.05
            mix[half:half + h] += tick - lowpass(tick, 3500)

    out = mix[:n]
    out *= env(n, 1.2, 2.5)
    return out


if __name__ == "__main__":
    write(OUT / "calm.wav", bed(8.0, 72.0, pulse=False))
    write(OUT / "pulse.wav", bed(4.8, 72.0, pulse=True))
