"""Makes the two opening sounds that were missing: the fall and the wink.

The whistle is the stone falling, a breath of air sliding down, quiet and
round with nothing sharp in it. The wink is two soft notes a fifth apart,
the second a touch lower in volume, over in a fifth of a second. Both are
written here like the rest of the set, so nothing licensed travels inside
the app and every build renders byte-identical files.
"""

import math
import struct
import wave

RATE = 44_100


def envelope(position: float, attack: float, decay: float) -> float:
    if position < attack:
        return position / attack
    return math.exp(-4.2 * (position - attack) / decay)


def whistle(time: float, index: int) -> float:
    """Air sliding down: a sine that falls from 1180 to 330 Hz over 0.6 s."""
    if time > 0.7:
        return 0.0
    progress = min(1.0, time / 0.6)
    frequency = 1180.0 * (330.0 / 1180.0) ** progress
    # The phase is the integral of the sweep, so the slide has no steps in it.
    phase = 2 * math.pi * 0.6 * (1180.0 - frequency) / math.log(1180.0 / 330.0)
    body = math.sin(phase)
    breath = 0.12 * math.sin(2 * math.pi * frequency * 2.01 * time)
    gain = envelope(time, 0.08, 0.55) * (1.0 - 0.35 * progress)
    return (0.5 * body + breath) * gain


def wink(time: float, index: int) -> float:
    """Two soft notes, C6 then G6, each a short sine with a rounded start."""
    value = 0.0
    if time < 0.11:
        value += 0.45 * math.sin(2 * math.pi * 1046.5 * time) * envelope(time, 0.006, 0.05)
    if 0.07 <= time < 0.22:
        local = time - 0.07
        value += 0.34 * math.sin(2 * math.pi * 1568.0 * local) * envelope(local, 0.006, 0.06)
    return value


def render(name: str, length: float, voice, gain: float) -> None:
    frames = bytearray()
    total = int(RATE * length)
    for index in range(total):
        time = index / RATE
        edge = min(1.0, index / 60, (total - index) / 700)
        sample = max(-1.0, min(1.0, voice(time, index)))
        frames += struct.pack("<h", int(sample * gain * edge * 32767))
    with wave.open(f"out/{name}", "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(RATE)
        file.writeframes(bytes(frames))


if __name__ == "__main__":
    render("whistle.wav", 0.75, whistle, 0.55)
    render("wink.wav", 0.28, wink, 0.6)
    print("whistle.wav and wink.wav written to out/")
