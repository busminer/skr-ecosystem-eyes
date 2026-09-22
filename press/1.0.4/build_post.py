from PIL import Image, ImageDraw, ImageFilter, ImageFont
import os

SORA = r"C:\skrx\node_modules\@expo-google-fonts\sora"
NAMES = {400: "400Regular/Sora_400Regular.ttf", 500: "500Medium/Sora_500Medium.ttf",
         600: "600SemiBold/Sora_600SemiBold.ttf", 700: "700Bold/Sora_700Bold.ttf"}
def sora(weight, size):
    return ImageFont.truetype(os.path.join(SORA, NAMES[weight]), size)

BG     = (5, 7, 10)
TEXT   = (242, 247, 251)
MUTED  = (130, 150, 168)
ACCENT = (86, 224, 255)
GREEN  = (63, 211, 168)
METAL  = (201, 162, 39)

W, H = 2000, 1125
canvas = Image.new("RGB", (W, H), BG)

# A pool of light behind the hero phone: one blurred ellipse in the app's own
# accent, nothing generated.
glow = Image.new("RGB", (W, H), BG)
ImageDraw.Draw(glow).ellipse((900, 60, 1700, 1080), fill=(9, 38, 50))
canvas = Image.blend(canvas, glow.filter(ImageFilter.GaussianBlur(150)), 0.95)
draw = ImageDraw.Draw(canvas)

def place(path, box, target_h, x, y):
    """One real screenshot, cropped and scaled. No filtering, no retouching."""
    shot = Image.open(path).convert("RGB").crop(box)
    w = int(shot.width * target_h / shot.height)
    shot = shot.resize((w, target_h), Image.LANCZOS)
    mask = Image.new("L", shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, target_h - 1), 24, fill=255)
    frame = Image.new("RGB", (w + 6, target_h + 6), (40, 51, 62))
    fmask = Image.new("L", frame.size, 0)
    ImageDraw.Draw(fmask).rounded_rectangle((0, 0, w + 5, target_h + 5), 28, fill=255)
    canvas.paste(frame, (x - 3, y - 3), fmask)
    canvas.paste(shot, (x, y), mask)
    return w

# Equal crops, so the three read as one set of phones rather than three shapes.
# Standing apart, not overlapping: the middle phone was eating the other two.
# Each crop ends on a whole element. A frame that cuts a sentence or a bar in
# half reads as a mistake, and the eye lands on it before it lands on the app.
# Widths are matched instead of heights, so the three sit on one baseline.
lw = place("shot_pulse_low.png", (0, 828, 1200, 2450), 541, 590, 236)
mw = place("shot_me.png",        (0,  96, 1200, 1560), 600, 1014, 178)
rw = place("shot_lang2.png",     (0, 100, 1200, 1790), 563, 1540, 236)

def caption(text, cx, y, colour, size=19, weight=600):
    f = sora(weight, size)
    tw = draw.textbbox((0, 0), text, font=f)[2]
    draw.text((cx - tw // 2, y), text, font=f, fill=colour)

caption("THE DAY, AT A GLANCE", 590 + lw // 2, 822, MUTED)
caption("TEN LANGUAGES",        1540 + rw // 2, 838, MUTED)
caption("YOUR STAKER CARD",     1014 + mw // 2, 812, GREEN, 21)

x0 = 96
draw.text((x0, 196), "SKR",  font=sora(700, 108), fill=TEXT)
draw.text((x0, 308), "EYES", font=sora(700, 108), fill=TEXT)
draw.text((x0, 452), "1.0.4", font=sora(600, 46), fill=ACCENT)
draw.line((x0, 544, x0 + 340, 544), fill=(34, 44, 54), width=2)

for index, (title, note) in enumerate([
    ("Pulse, rebuilt", "the last 24 hours as one strip"),
    ("Seeker IDs, not addresses", "the flow reads as people"),
    ("Ten languages", "it follows your phone"),
]):
    y = 588 + index * 96
    draw.text((x0, y), title, font=sora(600, 27), fill=TEXT)
    draw.text((x0, y + 38), note, font=sora(400, 19), fill=MUTED)

draw.text((x0, 900), "Live on the dApp Store",       font=sora(500, 22), fill=METAL)
draw.text((x0, 936), "Reads the chain. Signs nothing.", font=sora(400, 18), fill=MUTED)

canvas.save("skr-eyes-104.png", quality=96)
print("built", canvas.size)
