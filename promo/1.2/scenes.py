"""Draw the promo's captions and its end card.

    python promo/1.2/scenes.py

Chrome does the drawing, the same way the store media is made, so the film's
type and colour come out of the app's own stylesheet rather than a second one
invented for video. Captions are transparent bands laid over real footage; the
end card is the only full frame the film draws itself.
"""
import base64
import pathlib
import subprocess

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
HERE = pathlib.Path(__file__).resolve().parent
SCENES = HERE / "scenes"
SCENES.mkdir(exist_ok=True)
BADGE = pathlib.Path(r"C:\floop\design\store\brand\solana-dapp-store-badge-white.png")

BG = "#04070B"
TEXT = "#F2F7FB"
MUTED = "#8296A8"
ACCENT = "#56E0FF"
METAL = "#C9A96A"

FONTS = ("<link rel='preconnect' href='https://fonts.googleapis.com'>"
         "<link rel='preconnect' href='https://fonts.gstatic.com' crossorigin>"
         "<link href='https://fonts.googleapis.com/css2?"
         "family=Geist:wght@400;500;600;700;900&"
         "family=Geist+Mono:wght@400;700;900&display=swap' rel='stylesheet'>")

MARK = """
<svg viewBox="0 0 100 100" class="mark">
  <path d="M12 50 C22 29 34 24 50 24 C66 24 78 29 88 50 C78 71 66 76 50 76 C34 76 22 71 12 50 Z"
        fill="#070B0E" stroke="ACCENT" stroke-width="5"/>
  <path d="M13 50 C24 37 34 33 50 33 L50 67 C34 67 24 63 13 50 Z" fill="#101A21"/>
  <path d="M87 50 C76 37 66 33 50 33 L50 67 C66 67 76 63 87 50 Z" fill="#16242D"/>
  <circle cx="50" cy="50" r="16" fill="#050B10" stroke="#3A5B68" stroke-width="3"/>
  <circle cx="50" cy="50" r="8.5" fill="METAL"/>
  <circle cx="50" cy="50" r="3.6" fill="#020304"/>
  <circle cx="46.5" cy="46.5" r="1.9" fill="#F4FBFD"/>
</svg>
""".replace("ACCENT", ACCENT).replace("METAL", METAL)


def data_uri(path: pathlib.Path) -> str:
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()


def render(name: str, width: int, height: int, body: str, css: str, transparent: bool) -> None:
    html = f"""<!doctype html><meta charset="utf-8">{FONTS}
<style>
  html,body{{margin:0;padding:0;width:{width}px;height:{height}px;
    background:{'transparent' if transparent else BG};
    font-family:Geist,system-ui,sans-serif;color:{TEXT};-webkit-font-smoothing:antialiased;}}
  .mono{{font-family:'Geist Mono',ui-monospace,monospace;}}
  {css}
</style>{body}"""
    page = SCENES / (name + ".html")
    page.write_text(html, encoding="utf-8")
    args = [CHROME, "--headless", "--disable-gpu", "--hide-scrollbars",
            f"--window-size={width},{height}", f"--screenshot={SCENES / (name + '.png')}",
            "--force-device-scale-factor=1"]
    if transparent:
        args.append("--default-background-color=00000000")
    args.append(page.as_uri())
    subprocess.run(args, check=True, capture_output=True)
    page.unlink()
    print("scene", name)


# A caption sits in the lower third: a band that fades up out of black, an
# eyebrow in mono and one line of Geist. Short on purpose — the voice carries
# the sentence, the band carries the two or three words a muted viewer needs.
CAPTIONS = [
    ("cap-version", "SKR EYES", "Version 1.2"),
    ("cap-vault", "ALREADY HERE", "The vault, alive"),
    ("cap-day", "THE DAY", "Hour by hour"),
    ("cap-flow", "FLOW", "Every move as it lands"),
    ("cap-top", "NEW IN 1.2", "Top"),
    ("cap-orders", "THREE ORDERS", "Stake · earned · movers"),
    ("cap-you", "YOUR PLACE", "You, at the top of it"),
    ("cap-radar", "ALSO NEW", "The whole vault, one board"),
    ("cap-touch", "", "Drag, pinch, tap anybody"),
    ("cap-me", "NOW ON THE CARD", "Your place among people"),
    ("cap-alerts", "ALERTS", "Eleven languages, quiet by default"),
]

CAPTION_CSS = """
  .band{position:absolute;left:0;right:0;bottom:0;height:520px;
        background:linear-gradient(to bottom,rgba(4,7,11,0) 0%,rgba(4,7,11,.72) 42%,rgba(4,7,11,.92) 100%);}
  .copy{position:absolute;left:72px;right:72px;bottom:150px;}
  .eyebrow{font-size:26px;letter-spacing:7px;color:METAL;margin:0 0 18px;}
  h1{font-size:76px;line-height:1.05;font-weight:700;letter-spacing:-.02em;margin:0;}
""".replace("METAL", METAL)


def captions() -> None:
    for name, eyebrow, title in CAPTIONS:
        top = f"<p class='eyebrow mono'>{eyebrow}</p>" if eyebrow else ""
        body = f"<div class='band'></div><div class='copy'>{top}<h1>{title}</h1></div>"
        render(name, 1080, 1920, body, CAPTION_CSS, transparent=True)


def end_card() -> None:
    body = f"""
<div class="sheet">
  <div class="glow"></div>
  {MARK}
  <h1>SKR Eyes</h1>
  <p class="tag">Stake SKR. See everything.</p>
  <p class="ver mono">VERSION 1.2</p>
  <div class="rule"></div>
  <p class="by mono">BY ALEX KOSA · SKR-EYES.ALEXKOSA.DEV</p>
  <img class="badge" src="{data_uri(BADGE)}">
</div>"""
    css = """
  .sheet{position:relative;width:1080px;height:1920px;display:flex;flex-direction:column;
         align-items:center;justify-content:center;text-align:center;overflow:hidden;}
  .glow{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);
        width:1300px;height:1300px;border-radius:50%;
        background:radial-gradient(circle,rgba(86,224,255,.13),rgba(86,224,255,0) 62%);}
  .mark{position:relative;width:190px;height:190px;}
  h1{position:relative;font-size:104px;font-weight:700;letter-spacing:-.03em;margin:44px 0 0;}
  .tag{position:relative;font-size:38px;color:MUTED;margin:22px 0 0;}
  .ver{position:relative;font-size:24px;letter-spacing:6px;color:METAL;margin:26px 0 0;}
  .rule{position:relative;width:180px;height:1px;background:rgba(120,180,205,.35);margin:60px 0;}
  .by{position:relative;font-size:22px;letter-spacing:4px;color:#5A6B7A;margin:0 0 72px;}
  .badge{position:relative;width:520px;}
""".replace("MUTED", MUTED).replace("METAL", METAL)
    render("end", 1080, 1920, body, css, transparent=False)



# The device window: the capture is laid inside a rounded rectangle, and one
# element paints both the mask and the frame — a huge spread shadow fills every
# pixel outside the rectangle with the app's own ink, so the corners are cut and
# the edge is drawn in a single pass.
def frame() -> None:
    body = "<div class='win'></div>"
    css = """
  .win{position:absolute;left:198px;top:90px;width:684px;height:1520px;border-radius:46px;
       border:1px solid rgba(120,180,205,.22);
       box-shadow:0 0 0 9999px BG, 0 30px 90px rgba(0,0,0,.55);}
""".replace("BG", BG)
    render("frame", 1080, 1920, body, css, transparent=True)


if __name__ == "__main__":
    captions()
    frame()
    end_card()
