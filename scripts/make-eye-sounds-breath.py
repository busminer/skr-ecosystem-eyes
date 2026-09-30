# The breath of the portal: the walk-through's fourth sound scheme.
#
# 30.09.2026. Alex called the harp plucks boring. The two recordings he did
# not reject (Mixkit 2628 "Relaxing harp sweep" and 657 "Choir harp bless",
# already in assets/sound after the third pick) stay the raw material, but
# they are no longer played as plucks: their spectrum is time-stretched into
# a slow, breathing pad (the paulstretch trick: windowed FFT, magnitudes
# kept, phases scattered), and every moment gets one warm glass touch on top
# so the finger feels where the note begins. Nothing under 160 Hz: the
# Seeker's speaker rattles instead of playing there.
#
#   hum      the room the ritual happens in: 3.4 s of stretched choir,
#            fading in and out, nothing to notice and everything to feel.
#   tone1-7  one breath-bell per page: a short stretched-choir swell with a
#            soft glass strike, rising through a pentatonic line
#            (0 2 4 7 9 12 14 semitones), so the walk is one melody.
#   heart    the swell before the lids part: the same cloth pulled into a
#            rise that peaks at 1.35 s, a warm low sine growing under it.
#   chime    a step lands: one glass strike inside a short choir bloom.
#
# wake.wav and wink.wav are the app's own launch sounds and stay untouched.
# Reads and writes assets/sound; run from the repository root:
#   python scripts/make-eye-sounds-breath.py

import numpy as np
from pathlib import Path
from scipy.io import wavfile
from scipy.signal import butter, resample, sosfilt

SR = 44100
ROOT = Path(__file__).resolve().parents[1] / 'assets' / 'sound'
rng = np.random.default_rng(20260930)


def read(name: str) -> np.ndarray:
    sr, data = wavfile.read(ROOT / name)
    if data.ndim > 1:
        data = data.mean(axis=1)
    data = data.astype(np.float64)
    peak = np.max(np.abs(data)) or 1.0
    data /= peak
    if sr != SR:
        data = resample(data, int(len(data) * SR / sr))
    return data


def write(name: str, data: np.ndarray, peak_db: float = -1.0, rms_db: float | None = None) -> None:
    if rms_db is not None:
        # The seven notes climb a scale; matched loudness keeps the climb
        # from fading as it rises. The peak stays guarded.
        rms = np.sqrt(np.mean(data ** 2)) or 1.0
        data = data / rms * (10 ** (rms_db / 20))
        # A soft knee instead of turning the note down: only the strike's
        # peak folds, the loudness of the line stays even.
        ceiling = 10 ** (peak_db / 20)
        data = np.tanh(data / ceiling) * ceiling
    else:
        peak = np.max(np.abs(data)) or 1.0
        data = data / peak * (10 ** (peak_db / 20))
    wavfile.write(ROOT / name, SR, (data * 32767).astype(np.int16))
    seconds = len(data) / SR
    rms = 20 * np.log10(np.sqrt(np.mean(data ** 2)) + 1e-12)
    print(f'{name:12s} {seconds:5.2f}s  rms {rms:6.1f} dB')


def lowpass(data: np.ndarray, hz: float, order: int = 4) -> np.ndarray:
    sos = butter(order, hz / (SR / 2), btype='low', output='sos')
    return sosfilt(sos, data)


def highpass(data: np.ndarray, hz: float, order: int = 2) -> np.ndarray:
    sos = butter(order, hz / (SR / 2), btype='high', output='sos')
    return sosfilt(sos, data)


def paulstretch(data: np.ndarray, stretch: float, window_s: float = 0.28) -> np.ndarray:
    # Windowed FFT with the magnitudes kept and the phases thrown away:
    # the timbre stays, time dissolves. The classic public-domain recipe.
    ws = int(window_s * SR)
    ws -= ws % 2
    win = (1 - np.cos(np.linspace(0, 2 * np.pi, ws))) / 2
    hop = ws // 2
    step = ws / (2 * stretch)
    out = np.zeros(int(len(data) * stretch) + ws)
    pos, at = 0.0, 0
    while pos + ws < len(data) and at + ws < len(out):
        chunk = data[int(pos):int(pos) + ws] * win
        spec = np.abs(np.fft.rfft(chunk))
        phases = rng.uniform(0, 2 * np.pi, len(spec))
        rebuilt = np.fft.irfft(spec * np.exp(1j * phases)) * win
        out[at:at + ws] += rebuilt
        pos += step
        at += hop
    peak = np.max(np.abs(out)) or 1.0
    return out / peak


def pitch(data: np.ndarray, semitones: float) -> np.ndarray:
    # Resampling both shifts and re-times; on a stationary pad the re-timing
    # is invisible, which is the whole point of stretching first.
    k = 2 ** (semitones / 12)
    return resample(data, int(len(data) / k))


def fade(data: np.ndarray, fin: float, fout: float) -> np.ndarray:
    data = data.copy()
    a, b = int(fin * SR), int(fout * SR)
    if a > 0:
        data[:a] *= np.linspace(0, 1, a) ** 1.6
    if b > 0:
        data[-b:] *= np.linspace(1, 0, b) ** 1.6
    return data


def glass(f0: float, seconds: float = 0.30, tau: float = 0.055) -> np.ndarray:
    # One warm strike of glass: a few inharmonic partials, each dying a
    # little faster than the one below, and a five-millisecond felt tip.
    t = np.linspace(0, seconds, int(seconds * SR), endpoint=False)
    tone = np.zeros_like(t)
    for ratio, amp, life in ((1.0, 1.0, 1.0), (2.76, 0.32, 0.6), (5.40, 0.10, 0.35)):
        for detune in (0.9993, 1.0007):
            tone += amp * np.sin(2 * np.pi * f0 * ratio * detune * t) * np.exp(-t / (tau * life))
    tip = rng.normal(0, 1, len(t)) * np.exp(-t / 0.004)
    tone += lowpass(tip, 2600) * 0.25
    peak = np.max(np.abs(tone)) or 1.0
    return tone / peak


def envelope(n: int, attack: float, release: float, curve: float = 1.6) -> np.ndarray:
    env = np.ones(n)
    a, r = int(attack * SR), int(release * SR)
    if a > 0:
        env[:a] = np.linspace(0, 1, a) ** curve
    if r > 0:
        env[-r:] *= np.linspace(1, 0, r) ** curve
    return env


def place(base: np.ndarray, layer: np.ndarray, at_s: float, gain: float) -> None:
    at = int(at_s * SR)
    end = min(len(base), at + len(layer))
    base[at:end] += layer[:end - at] * gain


# The bless as the third pick shipped it, kept under its own name so this
# script can run twice: the first run saves it before replacing chime.wav.
if not (ROOT / 'src-bless.wav').exists():
    import shutil
    shutil.copyfile(ROOT / 'chime.wav', ROOT / 'src-bless.wav')
choir = read('src-bless.wav')

# One long stretch of the bless, cut up for everything below.
cloth = paulstretch(choir, 7.0)
cloth = lowpass(cloth, 3000)

# --- hum: the room ---------------------------------------------------------
hum = fade(cloth[:int(3.4 * SR)], 0.9, 1.4)
write('hum.wav', hum)

# --- tone1..tone7: the little ring -----------------------------------------
# Fifth pick, 30.09 (Alex: the breathing grains smeared into «тю-тю» on a
# quick swipe; he asked for «телефончик коротко позвонил»). A page now turns
# on one short two-note ring, «ди-линь»: a warm bell strike and its answer a
# major third up, sixty milliseconds later, gone in half a second — quick
# swipes stay clean. The line still climbs the same pentatonic.
GRAIN = cloth[int(0.4 * SR):int(0.4 * SR) + int(1.3 * SR)]  # kept for heart/chime below
BASE = 233.08  # B flat 3: the bless sits comfortably here after the shift
BELL = 392.0   # G4: where a ring sits sweetly in the Seeker's speaker
STEPS = (0, 2, 4, 7, 9, 12, 14)


def bell(f0: float, seconds: float = 0.55) -> np.ndarray:
    t = np.linspace(0, seconds, int(seconds * SR), endpoint=False)
    tone = np.zeros_like(t)
    for ratio, amp, life in ((1.0, 1.0, 1.0), (2.0, 0.42, 0.55), (2.96, 0.16, 0.34)):
        for detune in (0.9992, 1.0008):
            tone += amp * np.sin(2 * np.pi * f0 * ratio * detune * t) * np.exp(-t / (0.115 * life))
    tone[:int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))
    peak = np.max(np.abs(tone)) or 1.0
    return tone / peak


for i, semis in enumerate(STEPS, start=1):
    f0 = BELL * 2 ** (semis / 12)
    note = np.zeros(int(0.6 * SR))
    place(note, bell(f0), 0.0, 1.0)
    place(note, bell(f0 * 1.26, seconds=0.45), 0.058, 0.74)
    note = lowpass(note, 4600)
    write(f'tone{i}.wav', note, rms_db=-14.0)

# --- heart: the swell before the lids --------------------------------------
rise_len = int(1.35 * SR)
tail_len = int(0.22 * SR)
body = pitch(cloth[int(0.2 * SR):], -4)[:rise_len + tail_len]
t = np.linspace(0, 1, rise_len)
env = np.concatenate([t ** 1.8, np.linspace(1, 0, tail_len) ** 1.4])
heart = body * env
tt = np.arange(rise_len + tail_len) / SR
under = np.sin(2 * np.pi * (165 + 55 * np.minimum(tt / 1.35, 1)) * tt) * env
heart += under * 0.34
shimmer = highpass(pitch(cloth[:int(2.8 * SR)], 8)[:rise_len + tail_len], 1200) * env
heart += shimmer * 0.12
heart = lowpass(heart, 3400)
write('heart.wav', heart)

# --- chime: a step lands ----------------------------------------------------
bloom = pitch(GRAIN, 3)[:int(0.95 * SR)]
bloom *= envelope(len(bloom), 0.008, 0.55)
chime = np.zeros(int(1.0 * SR))
place(chime, bloom, 0.0, 0.9)
place(chime, glass(BASE * 4, seconds=0.4, tau=0.07), 0.0, 0.6)
chime = lowpass(chime, 4200)
write('chime.wav', chime)

# --- pip: one station of the road lights -----------------------------------
# Page three walks nine stations; each gets one clean pip (Alex, 30.09:
# «пик-пик», every step heard, nothing left silent), and the last keeps the
# heartbeat and the wake it always had.
pt = np.linspace(0, 0.1, int(0.1 * SR), endpoint=False)
pip = (np.sin(2 * np.pi * 1244.5 * pt) + 0.3 * np.sin(2 * np.pi * 2489 * pt)) * np.exp(-pt / 0.028)
pip[:int(0.005 * SR)] *= np.linspace(0, 1, int(0.005 * SR))
pip = lowpass(pip, 5200)
write('pip.wav', pip, rms_db=-16.0)
