"""Makes the opening sound: a short turn, then a soft blink.

Written rather than downloaded, so the app carries nothing licensed from
elsewhere and the file stays a few kilobytes. Two gestures only — a low sweep
while the device turns, and a small dry tick when the eye closes and opens —
because a launch sound that says more than that becomes a nuisance by the
tenth launch.
"""

import math
import struct
import wave

RATE = 44_100
LENGTH = 1.70


def envelope(position: float, attack: float, decay: float) -> float:
    if position < attack:
        return position / attack
    fall = (position - attack) / decay
    return math.exp(-4.2 * fall)


def sample(time: float) -> float:
    value = 0.0

    # The turn: a low sweep from 240 Hz down to 120, breathing in over half a
    # second. This is the body of the device moving, not a musical note.
    if 0.02 <= time < 0.62:
        position = time - 0.02
        frequency = 240 - 120 * (position / 0.60)
        value += 0.34 * math.sin(2 * math.pi * frequency * position) * envelope(position, 0.09, 0.52)
        value += 0.10 * math.sin(2 * math.pi * frequency * 2 * position) * envelope(position, 0.12, 0.30)

    # The blink: two dry ticks, the second slightly lower, the way a shutter
    # sounds when it closes and opens again.
    for start, pitch, gain in ((1.05, 1_450, 0.30), (1.14, 1_180, 0.22)):
        if start <= time < start + 0.09:
            position = time - start
            value += gain * math.sin(2 * math.pi * pitch * position) * envelope(position, 0.004, 0.055)

    # A quiet tail so the sound resolves instead of being cut off.
    if 1.10 <= time < 1.70:
        position = time - 1.10
        value += 0.12 * math.sin(2 * math.pi * 320 * position) * envelope(position, 0.10, 0.40)

    return max(-1.0, min(1.0, value))


def main() -> None:
    frames = bytearray()
    total = int(RATE * LENGTH)
    for index in range(total):
        time = index / RATE
        # A short fade at both ends keeps the speaker from clicking.
        edge = min(1.0, index / 240, (total - index) / 900)
        frames += struct.pack("<h", int(sample(time) * edge * 26_000))

    with wave.open("out/wake.wav", "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(RATE)
        file.writeframes(bytes(frames))

    print(f"wake.wav  {len(frames) // 1024} KB, {LENGTH:.2f}s")


if __name__ == "__main__":
    main()
