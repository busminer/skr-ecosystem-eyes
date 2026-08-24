# -*- coding: utf-8 -*-
"""Press image for the SKR Eyes launch. Real screenshots only, no generation."""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SP  = r"C:\Users\ALEXKO~1\AppData\Local\Temp\claude\C--Users-Alex-Kosa\3d8cd69a-727d-4209-a814-cc17d19768cc\scratchpad"
GF  = r"C:\skrx\node_modules\@expo-google-fonts\geist"
GMF = r"C:\skrx\node_modules\@expo-google-fonts\geist-mono"

W, H = 2400, 1350
BG      = (4, 7, 11)
TEXT    = (242, 247, 251)
MUTED   = (130, 150, 168)
FAINT   = (84, 103, 122)
ACCENT  = (86, 224, 255)
METAL   = (201, 169, 106)

def geist(weight, size):
    p = os.path.join(GF, weight, "Geist_%s.ttf" % weight)
    return ImageFont.truetype(p, size)

def mono(weight, size):
    p = os.path.join(GMF, weight, "GeistMono_%s.ttf" % weight)
    return ImageFont.truetype(p, size)

def glow(canvas, cx, cy, radius, colour, strength, falloff=2.2):
    """Soft radial light that reaches zero at its own edge, so it leaves no seam."""
    g = Image.radial_gradient("L").resize((radius * 2, radius * 2), Image.LANCZOS)
    g = g.point(lambda v: int(((255 - v) / 255.0) ** falloff * strength))
    full = Image.new("L", canvas.size, 0)
    full.paste(g, (cx - radius, cy - radius))
    canvas.paste(Image.new("RGB", canvas.size, colour), (0, 0), full)


def vignette(canvas, strength=90):
    g = Image.radial_gradient("L").resize(canvas.size, Image.LANCZOS)
    g = g.point(lambda v: int((v / 255.0) ** 2.4 * strength))
    canvas.paste(Image.new("RGB", canvas.size, (0, 0, 0)), (0, 0), g)

def phone(path, height, angle, crop_top=92, crop_bottom=34, dim=0.0):
    """One device: screenshot in a thin bezel, rounded, rotated, with its own shadow."""
    src = Image.open(path).convert("RGB")
    src = src.crop((0, crop_top, src.width, src.height - crop_bottom))

    bezel = max(6, height // 105)
    inner_h = height - bezel * 2
    inner_w = int(src.width * inner_h / src.height)
    screen = src.resize((inner_w, inner_h), Image.LANCZOS)
    if dim:
        screen = Image.blend(screen, Image.new("RGB", screen.size, BG), dim)

    body_w, body_h = inner_w + bezel * 2, height
    radius_out = int(body_w * 0.075)
    radius_in = max(2, radius_out - bezel)

    body = Image.new("RGBA", (body_w, body_h), (0, 0, 0, 0))
    mask = Image.new("L", (body_w, body_h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, body_w - 1, body_h - 1), radius_out, fill=255)
    body.paste(Image.new("RGBA", (body_w, body_h), (14, 20, 27, 255)), (0, 0), mask)

    smask = Image.new("L", (inner_w, inner_h), 0)
    ImageDraw.Draw(smask).rounded_rectangle((0, 0, inner_w - 1, inner_h - 1), radius_in, fill=255)
    body.paste(screen, (bezel, bezel), smask)

    edge = ImageDraw.Draw(body, "RGBA")
    edge.rounded_rectangle((0, 0, body_w - 1, body_h - 1), radius_out,
                           outline=(ACCENT[0], ACCENT[1], ACCENT[2], 46), width=max(2, bezel // 3))
    edge.rounded_rectangle((1, 1, body_w - 2, int(body_h * 0.5)), radius_out,
                           outline=(255, 255, 255, 16), width=2)

    rot = body.rotate(angle, resample=Image.BICUBIC, expand=True)
    sh = Image.new("RGBA", (rot.width + 200, rot.height + 200), (0, 0, 0, 0))
    sh.paste(Image.new("RGBA", rot.size, (0, 0, 0, 190)), (100, 100), rot.split()[3])
    sh = sh.filter(ImageFilter.GaussianBlur(46))
    return rot, sh

def spaced(draw, xy, text, font, fill, tracking):
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + tracking
    return x - tracking

canvas = Image.new("RGB", (W, H), BG)
glow(canvas, 1560, 430, 1080, (18, 92, 120), 150)
glow(canvas, 1320, 1240, 880, (96, 74, 30), 46)
glow(canvas, 250, 430, 780, (14, 44, 62), 70)

# devices, back to front
layers = [
    (os.path.join(SP, "shot1.png"),        880, -21, (955, 430), 0.26),
    (os.path.join(SP, "tab-me.png"),       905,  17, (1852, 330), 0.10),
    (os.path.join(SP, "store4-clean.png"), 1130,  -5, (1300, 245), 0.0),
]
for path, h, ang, pos, dim in layers:
    body, shadow = phone(path, h, ang, dim=dim)
    canvas.paste(Image.new("RGB", shadow.size, (0, 0, 0)),
                 (pos[0] - 100, pos[1] - 60), shadow.split()[3])
    canvas.paste(body, pos, body)

vignette(canvas, 68)

d = ImageDraw.Draw(canvas, "RGBA")

icon = Image.open(r"C:\skrx\store\icon-512.png").convert("RGBA").resize((128, 128), Image.LANCZOS)
im = Image.new("L", (128, 128), 0)
ImageDraw.Draw(im).rounded_rectangle((0, 0, 127, 127), 33, fill=255)
canvas.paste(icon, (140, 206), im)

spaced(d, (142, 382), "NOW ON THE SOLANA dAPP STORE", mono("600SemiBold", 27), ACCENT, 5.0)
d.text((136, 434), "SKR", font=geist("900Black", 142), fill=TEXT)
d.text((136, 570), "EYES", font=geist("900Black", 142), fill=TEXT)
d.line((146, 736, 146 + 96, 736), fill=METAL, width=5)
d.text((140, 770), "Stake SKR. See everything.", font=geist("500Medium", 50), fill=TEXT)

rows = [
    ("PULSE",  "the whole vault at a glance", ACCENT),
    ("FLOW",   "every finalized move, as it lands", ACCENT),
    ("ME",     "your position, and how long you held it", ACCENT),
    ("QUEUE",  "what is leaving, and when it frees", ACCENT),
    ("ALERTS", "this phone wakes you at your unlock", ACCENT),
    ("STAKE",  "approve once, up to sixteen at a time", METAL),
]
label_f = mono("600SemiBold", 27)
body_f  = geist("400Regular", 32)
y = 860
for label, body, colour in rows:
    d.rectangle((142, y + 12, 146, y + 30), fill=colour)
    spaced(d, (172, y + 4), label, label_f, colour, 2.2)
    d.text((350, y), body, font=body_f, fill=MUTED)
    y += 54

spaced(d, (140, 1232), "dev.alexkosa.skreyes   v1.0.0   built on Seeker", mono("400Regular", 25), FAINT, 1.2)
d.text((140, 1278), "Not affiliated with Solana Foundation or Solana Mobile.",
       font=geist("400Regular", 22), fill=(58, 72, 86))

# a soft fall-off in the bottom-right so the brand line stays legible
scrim = Image.new("L", canvas.size, 0)
sg = Image.radial_gradient("L").resize((1180, 620), Image.LANCZOS)
sg = sg.point(lambda v: int(((255 - v) / 255.0) ** 1.7 * 232))
scrim.paste(sg, (W - 1050, H - 400))
canvas.paste(Image.new("RGB", canvas.size, (2, 4, 7)), (0, 0), scrim)

out = os.path.join(SP, "press-skr-eyes.png")
canvas.save(out)

import sys
sys.path.insert(0, os.path.join(os.path.expanduser("~"), "solana-mobile-collage", "dappstore_world"))
from brand_stamp import stamp
stamp(out)
print(out, canvas.size)
