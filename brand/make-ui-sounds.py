"""Makes the two interface sounds: a flap click and a large-move chime.

Both are written here rather than downloaded, for the same reason the opening
sound is: nothing licensed travels inside the app, and the files stay a few
kilobytes. They are deliberately quiet — a sound a person hears fifty times a
day has to be smaller than one they hear once.
"""

import math
import struct
import wave

RATE = 44_100


def envelope(position: float, attack: float, decay: float) -> float:
    if position < attack:
        return position / attack
    return math.exp(-4.2 * (position - attack) / decay)


def noise(seed: int) -> float:
    # A deterministic hash used as noise, so every build renders byte-identical
    # files and the sound never drifts between machines.
    value = (seed * 1_103_515_245 + 12_345) & 0x7FFFFFFF
    return (value / 0x3FFFFFFF) - 1.0


def flap(time: float, index: int) -> float:
    """One split-flap card falling: a dry knock, no ring."""
    value = 0.0
    if time < 0.012:
        value += 0.55 * noise(index) * envelope(time, 0.0006, 0.006)
    if time < 0.09:
        value += 0.40 * math.sin(2 * math.pi * 2_050 * time) * envelope(time, 0.0015, 0.016)
        value += 0.30 * math.sin(2 * math.pi * 1_240 * time) * envelope(time, 0.002, 0.028)
        value += 0.34 * math.sin(2 * math.pi * 190 * time) * envelope(time, 0.003, 0.038)
    return value


def surge(time: float, index: int) -> float:
    """A large move landing: a struck vault bell, low and unhurried."""
    value = 0.0
    if time < 0.02:
        value += 0.18 * noise(index) * envelope(time, 0.0008, 0.008)
    # The partials of a struck metal body, the top ones dying first.
    for ratio, gain, decay in ((1.0, 0.42, 0.95), (2.0, 0.20, 0.55), (3.02, 0.12, 0.30), (5.41, 0.07, 0.16)):
        value += gain * math.sin(2 * math.pi * 196.0 * ratio * time) * envelope(time, 0.004, decay)
    # The body under it, so the phone speaker still gives it weight.
    value += 0.22 * math.sin(2 * math.pi * 98.0 * time) * envelope(time, 0.02, 0.70)
    return value


def render(name: str, length: float, voice, gain: float) -> None:
    frames = bytearray()
    total = int(RATE * length)
    for index in range(total):
        time = index / RATE
        edge = min(1.0, index / 60, (total - index) / 700)
        sample = max(-1.0, min(1.0, voice(time, index)))
        frames += struct.pack("<h", int(sample * edge * gain))

    with wave.open(f"out/{name}", "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(RATE)
        file.writeframes(bytes(frames))
    print(f"{name}  {len(frames) // 1024} KB, {length:.2f}s")


def main() -> None:
    render("flip.wav", 0.13, flap, 20_000)
    render("surge.wav", 1.15, surge, 24_000)


if __name__ == "__main__":
    main()
