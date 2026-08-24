"""Draws the SKR Eyes mark and writes the app icons.

The mark is one idea: an aperture that is also a cooldown ring. The ring is
open at the lower left, the missing quarter standing for time a position still
has to wait, and the pupil at the centre is the position itself.
"""

from PIL import Image, ImageDraw

BG = (4, 7, 11, 255)
RING_DIM = (34, 50, 63, 255)
ACCENT = (86, 224, 255, 255)
METAL = (201, 169, 106, 255)

SUPERSAMPLE = 4


def draw_mark(size: int, background: tuple | None, ring_scale: float = 0.62) -> Image.Image:
    canvas = size * SUPERSAMPLE
    image = Image.new("RGBA", (canvas, canvas), background if background else (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    centre = canvas / 2
    radius = canvas * ring_scale / 2
    width = canvas * 0.085
    box = [centre - radius, centre - radius, centre + radius, centre + radius]

    # The full ring stays faint: it is the part of the cycle already spent.
    draw.arc(box, start=0, end=360, fill=RING_DIM, width=int(width))
    # Three quarters in the accent, opening at the lower left.
    draw.arc(box, start=-90, end=180, fill=ACCENT, width=int(width))

    # The metal segment sits in the ring itself: the moment the wait ends.
    draw.arc(box, start=168, end=182, fill=METAL, width=int(width))

    pupil = radius * 0.28
    draw.ellipse([centre - pupil, centre - pupil, centre + pupil, centre + pupil], fill=ACCENT)

    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    draw_mark(1024, BG).save("assets/icon.png")
    # Android crops adaptive icons hard, so the foreground sits smaller.
    draw_mark(1024, None, ring_scale=0.42).save("assets/adaptive-icon.png")
    draw_mark(512, None).save("assets/splash-icon.png")
    draw_mark(512, BG).save("assets/mark-preview.png")
    print("icons written")


if __name__ == "__main__":
    main()
