"""Renders the dApp Store media from one set of sources.

Chrome does the rasterising, the same way `brand/render.sh` does it: the
browser already draws our type and colour exactly as the app does, and every
asset comes out of the same stylesheet, so the store page and the phone cannot
drift apart.

Sizes come from the store's rules: icon 512, banner 1200x600, feature
1200x1200, screenshots at least four, same aspect, 1080x1920 here.
"""

import base64
import pathlib
import subprocess

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
HERE = pathlib.Path(__file__).resolve().parent
MEDIA = HERE / "media"
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)

BG = "#04070B"
PANEL = "#0A1017"
LINE = "#15212C"
TEXT = "#F2F7FB"
MUTED = "#8296A8"
FAINT = "#54677A"
ACCENT = "#56E0FF"
METAL = "#C9A96A"

FONTS = ("<link rel='preconnect' href='https://fonts.googleapis.com'>"
         "<link rel='preconnect' href='https://fonts.gstatic.com' crossorigin>"
         "<link href='https://fonts.googleapis.com/css2?"
         "family=Geist:wght@400;500;600;700;900&"
         "family=Geist+Mono:wght@400;700;900&display=swap' rel='stylesheet'>")

# The mark, the same geometry the app draws in `src/lab/kit.tsx`.
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


def data_uri(path):
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()


def render(name, width, height, body, extra_css=""):
    page = (
        "<!doctype html><meta charset='utf-8'>" + FONTS + "<style>"
        "*{margin:0;padding:0;box-sizing:border-box;}"
        "html,body{width:" + str(width) + "px;height:" + str(height) + "px;overflow:hidden;"
        "background:" + BG + ";color:" + TEXT + ";"
        "font-family:'Geist',system-ui,sans-serif;-webkit-font-smoothing:antialiased;}"
        ".mark{display:block;}"
        ".wordmark{font-weight:900;letter-spacing:.14em;}"
        + extra_css + "</style>" + body
    )
    wrapper = OUT / ("." + name + ".html")
    wrapper.write_text(page, encoding="utf-8")
    subprocess.run([CHROME, "--headless", "--disable-gpu", "--hide-scrollbars",
                    "--force-device-scale-factor=1",
                    "--screenshot=" + str(OUT / name),
                    "--window-size=" + str(width) + "," + str(height),
                    "--virtual-time-budget=5000",
                    str(wrapper)],
                   check=True, capture_output=True)
    wrapper.unlink()
    print("  " + name + "  " + str(width) + "x" + str(height))


BAR_SHAPE = ((26, "#7CF0BC"), (40, "#7CF0BC"), (18, "#FF7E79"), (52, "#7CF0BC"),
             (30, "#FF7E79"), (64, "#7CF0BC"), (22, "#FF7E79"), (46, "#7CF0BC"),
             (34, "#FF7E79"), (78, "#7CF0BC"), (28, "#FF7E79"), (44, "#7CF0BC"),
             (20, "#FF7E79"), (58, "#7CF0BC"), (36, "#FF7E79"), (30, "#7CF0BC"))


def banner():
    # Depth: the vault sky at the back, the SKR mark far left where the store's
    # own back button and icon sit anyway, the staker card standing a little
    # way off, and the phone with the living scene in front, turned towards
    # the reader. Every word stays inside x 440-1170, y 110-460.
    body = """
<div class="sheet">
  <div class="scene"></div>
  <div class="shade"></div>
  <div class="stage">
    <div class="card"><img src="CARD"></div>
    <div class="phone"><div class="glow"></div><div class="body"><img src="PHONE"></div></div>
  </div>
  <div class="copy">
    <div class="wordmark">SKR EYES</div>
    <div class="tag">Stake SKR. See everything.</div>
    <div class="line"></div>
    <div class="sub">The vault, alive: every stake falls in with its .skr name, every exit hangs and cools. Your card beside it.</div>
  </div>
</div>"""
    css = """
  .sheet{position:relative;width:1200px;height:600px;overflow:hidden;background:BG;}
  .scene{position:absolute;inset:0;background:url('SCENE') center/1200px 600px no-repeat;}
  .shade{position:absolute;inset:0;
         background:linear-gradient(90deg,rgba(4,7,11,.9) 0,rgba(4,7,11,.55) 260px,rgba(4,7,11,.25) 470px,rgba(4,7,11,.62) 700px,rgba(4,7,11,.35) 1200px),
                    linear-gradient(0deg,rgba(4,7,11,.9) 0,rgba(4,7,11,0) 230px);}
  .stage{position:absolute;inset:0;perspective:1400px;perspective-origin:70% 45%;}
  .card{position:absolute;left:790px;top:342px;width:330px;transform:rotateY(-32deg) rotateX(10deg) translateZ(-230px);
        transform-origin:left center;opacity:.85;filter:brightness(.9);border-radius:14px;overflow:hidden;
        box-shadow:0 30px 60px rgba(0,0,0,.65);}
  .card img{width:100%;display:block;}
  .phone{position:absolute;left:872px;top:26px;width:300px;transform:rotateY(-18deg) rotateX(4deg);transform-origin:center;}
  .phone .glow{position:absolute;left:-120px;top:-60px;width:540px;height:640px;border-radius:50%;
        background:radial-gradient(circle,rgba(86,224,255,.22),rgba(124,240,188,.10) 40%,rgba(0,0,0,0) 68%);}
  .phone .body{position:relative;width:300px;border-radius:30px;border:1px solid #2A3B48;background:#04070B;
        box-shadow:0 40px 90px rgba(0,0,0,.75),0 0 0 6px #0B1219,0 0 40px rgba(86,224,255,.18);overflow:hidden;}
  .phone .body img{width:100%;display:block;}
  .copy{position:absolute;left:470px;top:150px;width:420px;}
  .wordmark{font-size:64px;line-height:1;color:TEXT;}
  .tag{margin-top:16px;font-size:24px;color:ACCENT;}
  .line{margin:20px 0 16px;width:110px;height:2px;background:METAL;opacity:.85;}
  .sub{font-size:18px;color:MUTED;max-width:330px;line-height:1.45;}
""".replace("TEXT", TEXT).replace("ACCENT", ACCENT).replace("METAL", METAL).replace("MUTED", MUTED).replace("BG", BG)
    body = body.replace("CARD", data_uri(MEDIA / "card-only.png")).replace("PHONE", data_uri(MEDIA / "phone-scene.png"))
    css = css.replace("SCENE", data_uri(MEDIA / "bg-banner.png"))
    render("banner-1200x600.png", 1200, 600, body, css)


def feature():
    # The scene as the phone shows it, large, with the sky behind it and a
    # cold glow around it. Nothing invented: the frame holds a real capture.
    body = """
<div class="sheet">
  <div class="scene"></div>
  <div class="shade"></div>
  <div class="stars"></div>
  <div class="top">
    <div class="brand">MARK<span class="wordmark">SKR EYES</span></div>
    <h1>The vault, alive</h1>
  </div>
  <div class="phone"><div class="glow"></div><div class="body"><img src="PHONE"></div></div>
  <div class="foot">Every stake with its .skr name · every exit cooling in the open · 4.95B SKR held</div>
</div>"""
    css = """
  .sheet{position:relative;width:1200px;height:1200px;overflow:hidden;background:BG;}
  .scene{position:absolute;inset:0;background:url('SCENE') center/1200px 1200px no-repeat;filter:brightness(.55);}
  .shade{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 58%,rgba(4,7,11,0) 0,rgba(4,7,11,.35) 45%,rgba(4,7,11,.92) 80%);}
  .top{position:absolute;left:0;right:0;top:78px;text-align:center;}
  .brand{display:flex;align-items:center;justify-content:center;gap:16px;}
  .brand .mark{width:44px;height:44px;}
  .brand .wordmark{font-size:26px;color:TEXT;}
  h1{margin-top:22px;font-size:66px;line-height:1.05;font-weight:700;letter-spacing:-.02em;color:TEXT;}
  .phone{position:absolute;left:50%;top:262px;width:700px;margin-left:-350px;}
  .phone .glow{position:absolute;left:-220px;top:-160px;width:1140px;height:1100px;border-radius:50%;
        background:radial-gradient(circle,rgba(86,224,255,.26),rgba(124,240,188,.12) 38%,rgba(0,0,0,0) 66%);}
  .phone .body{position:relative;width:700px;height:760px;border-radius:52px 52px 0 0;border:1px solid #2A3B48;border-bottom:none;
        background:#04070B;box-shadow:0 0 0 10px #0B1219,0 40px 120px rgba(0,0,0,.8),0 0 80px rgba(86,224,255,.22);overflow:hidden;}
  .phone .body img{width:100%;display:block;}
  .foot{position:absolute;left:0;right:0;bottom:64px;text-align:center;font-size:24px;color:MUTED;letter-spacing:.02em;}
""".replace("TEXT", TEXT).replace("MUTED", MUTED).replace("BG", BG)
    body = body.replace("MARK", MARK).replace("PHONE", data_uri(MEDIA / "phone-scene.png"))
    css = css.replace("SCENE", data_uri(MEDIA / "bg-feature.png"))
    render("feature-1200x1200.png", 1200, 1200, body, css)


SHOTS = [
    ("cap-card.png", "Your staker card",
     "Days in stake, weight in the vault, what you earned. Hide your name or your amount before you share it."),
    ("cap-vault.png", "The vault, alive",
     "Every stake falls in with its .skr name; every exit hangs and cools above the pile of what stays. Tap any move for its receipt."),
    ("cap-flow.png", "Every finalized move, live",
     "Stakes, exits and withdrawals as they land, by kind and by size, the day's biggest pinned on top."),
    ("cap-me.png", "Stake from the same screen",
     "Sixteen: 16 parts of 1 SKR with one approval. Earned on staking, read from the chain. Two privacy switches for the card."),
    ("cap-alerts.png", "Ten languages, sounds you can feel",
     "A glass chime for a stake, the vault bell for a large one, a low boom for a large exit. Unlock alerts set on the phone itself."),
]


def screenshots():
    for index, (source, title, note) in enumerate(SHOTS, start=1):
        body = """
<div class="sheet">
  <div class="glow"></div>
  <div class="head">
    <div class="brand">MARK<span class="wordmark">SKR EYES</span></div>
    <h1>TITLE</h1>
    <p>NOTE</p>
  </div>
  <div class="frame"><img src="URI"></div>
</div>""".replace("MARK", MARK).replace("TITLE", title).replace("NOTE", note).replace("URI", data_uri(MEDIA / source))
        css = """
  .sheet{position:relative;width:1080px;height:1920px;padding:96px 84px 0;
         display:flex;flex-direction:column;overflow:hidden;}
  .glow{position:absolute;left:50%;top:-320px;transform:translateX(-50%);
        width:1100px;height:900px;border-radius:50%;
        background:radial-gradient(circle,rgba(86,224,255,.12),rgba(86,224,255,0) 62%);}
  .head{position:relative;}
  .brand{display:flex;align-items:center;gap:16px;}
  .brand .mark{width:38px;height:38px;}
  .brand .wordmark{font-size:22px;color:TEXT;}
  h1{margin-top:38px;font-size:64px;line-height:1.1;font-weight:700;letter-spacing:-.02em;}
  p{margin-top:22px;font-size:27px;line-height:1.5;color:MUTED;max-width:830px;}
  .frame{position:relative;margin:60px auto 0;width:760px;flex:1;
         border-radius:44px 44px 0 0;border:1px solid LINE;border-bottom:none;
         background:BG;overflow:hidden;}
  .frame img{width:100%;display:block;margin-top:-56px;}
""".replace("TEXT", TEXT).replace("MUTED", MUTED).replace("LINE", LINE).replace("BG", BG)
        render("screenshot-%d-1080x1920.png" % index, 1080, 1920, body, css)


if __name__ == "__main__":
    print("banner")
    banner()
    print("feature")
    feature()
    print("screenshots")
    screenshots()
    print("done -> " + str(OUT))
