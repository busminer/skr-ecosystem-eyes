"""The ring: an old desk telephone, one short double burst, far away and soft.

A large stake landing is good news, and the app answers it the way a phone
used to: two quick rings of a small bell. The bell is two partials with a
20 Hz tremolo, the hammer is a soft knock, the whole thing is under a second
and quieter than the boom, so it reads as cheerful rather than urgent.
Written here like the rest of the set, byte-identical on every build.
"""

import math
import struct
import wave

RATE = 44_100


def envelope(position: float, attack: float, decay: float) -> float:
    if position < attack:
        return position / attack
    return math.exp(-4.2 * (position - attack) / decay)


def burst(local: float) -> float:
    if local < 0 or local > 0.34:
        return 0.0
    # a tremolo at 21 Hz is the clapper going back and forth
    tremolo = 0.62 + 0.38 * math.sin(2 * math.pi * 21.0 * local)
    tone = 0.0
    for freq, gain, decay in ((1318.5, 0.34, 0.30), (1760.0, 0.22, 0.22), (2637.0, 0.08, 0.12)):
        tone += gain * math.sin(2 * math.pi * freq * local) * envelope(local, 0.012, decay)
    body = 0.10 * math.sin(2 * math.pi * 329.6 * local) * envelope(local, 0.02, 0.25)
    return (tone * tremolo + body)


def ring(time: float, index: int) -> float:
    return burst(time) + burst(time - 0.42)


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
    render("ring.wav", 0.95, ring, 0.55)
    print("ring.wav written to out/")
