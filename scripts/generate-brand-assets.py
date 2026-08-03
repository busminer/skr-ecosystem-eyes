from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
BRAND = PUBLIC / "assets" / "brand"
BRAND.mkdir(parents=True, exist_ok=True)

FONT_REGULAR = Path(r"C:\Windows\Fonts\segoeui.ttf")
FONT_BOLD = Path(r"C:\Windows\Fonts\segoeuib.ttf")

def font(size, bold=False):
    path = FONT_BOLD if bold else FONT_REGULAR
    return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default()

def mark(size):
    image = Image.new("RGBA", (size, size), "#07090b")
    draw = ImageDraw.Draw(image)
    scale = size / 64
    draw.rounded_rectangle((1, 1, size - 2, size - 2), radius=8 * scale, outline="#22303b", width=max(1, round(1 * scale)))
    draw.ellipse((8 * scale, 17 * scale, 56 * scale, 47 * scale), outline="#67dfff", width=max(1, round(2 * scale)))
    draw.ellipse((22 * scale, 22 * scale, 42 * scale, 42 * scale), outline="#62e8b6", width=max(1, round(2 * scale)))
    draw.ellipse((29 * scale, 29 * scale, 35 * scale, 35 * scale), fill="#f2f5f7")
    draw.line((12 * scale, 50 * scale, 52 * scale, 14 * scale), fill="#2ba8ff", width=max(1, round(scale)))
    return image

og = Image.new("RGB", (1200, 630), "#04070b")
d = ImageDraw.Draw(og)
for x in range(0, 1200, 60): d.line((x, 0, x, 630), fill="#081019", width=1)
for y in range(0, 630, 60): d.line((0, y, 1200, y), fill="#081019", width=1)
d.rounded_rectangle((34, 34, 1166, 596), radius=12, outline="#1d3445", width=2)
d.line((82, 118, 1118, 118), fill="#123348", width=2)
og.paste(mark(116), (82, 165), mark(116))
d.text((238, 172), "SKR ECOSYSTEM EYES", font=font(54, True), fill="#f2f5f7")
d.text((241, 242), "INDEPENDENT OPERATIONS CONSOLE", font=font(23), fill="#67dfff")
d.text((82, 374), "LIVE SKR STAKING INTELLIGENCE", font=font(38, True), fill="#f2f5f7")
d.text((84, 435), "Finalized Solana data · read only · no wallet · evidence first", font=font(23), fill="#929ba5")
d.text((84, 530), "skr.alexkosa.dev", font=font(22), fill="#62e8b6")
og.save(BRAND / "skr-eyes-og.png", optimize=True)

for size, name in [(180, "apple-touch-icon.png"), (192, "icon-192.png"), (512, "icon-512.png")]:
    mark(size).save(PUBLIC / name, optimize=True)
mark(64).save(PUBLIC / "favicon.ico", sizes=[(16,16),(32,32),(48,48),(64,64)])
