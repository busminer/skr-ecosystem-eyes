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
    # The living vault is the banner. The store draws its own back button over
    # the top-left and the app icon over the bottom-left, so the left third is
    # kept dark and quiet and every word sits inside x 440-1170, y 110-460.
    body = """
<div class="sheet">
  <div class="scene"></div>
  <div class="shade"></div>
  <div class="copy">
    <div class="wordmark">SKR EYES</div>
    <div class="tag">Stake SKR. See everything.</div>
    <div class="line"></div>
    <div class="sub">The living vault: every stake falls in with its .skr name, every exit hangs and cools. Nothing invented.</div>
  </div>
</div>"""
    css = """
  .sheet{position:relative;width:1200px;height:600px;overflow:hidden;background:BG;}
  .scene{position:absolute;inset:0;background:url('URI') center/1200px 600px no-repeat;}
  .shade{position:absolute;inset:0;
         background:linear-gradient(90deg,rgba(4,7,11,.92) 0,rgba(4,7,11,.6) 260px,rgba(4,7,11,.15) 480px,rgba(4,7,11,.62) 760px,rgba(4,7,11,.7) 1200px),
                    linear-gradient(0deg,rgba(4,7,11,.92) 0,rgba(4,7,11,0) 230px);}
  .copy{position:absolute;left:470px;top:118px;width:690px;}
  .wordmark{font-size:74px;line-height:1;color:TEXT;}
  .tag{margin-top:18px;font-size:27px;color:ACCENT;letter-spacing:.01em;}
  .line{margin:24px 0 20px;width:120px;height:2px;background:METAL;opacity:.85;}
  .sub{font-size:21px;color:MUTED;max-width:660px;line-height:1.45;}
""".replace("TEXT", TEXT).replace("ACCENT", ACCENT).replace("METAL", METAL).replace("MUTED", MUTED).replace("BG", BG).replace("URI", data_uri(MEDIA / "bg-banner.png"))
    render("banner-1200x600.png", 1200, 600, body, css)


def feature():
    cells = "".join('<div class="cell">%s</div>' % ch if ch.isdigit() else '<div class="dot"></div>'
                    for ch in "4.95")
    body = """
<div class="sheet">
  <div class="scene"></div>
  <div class="shade"></div>
  <div class="top">
    <div class="brand">MARK<span class="wordmark">SKR EYES</span></div>
    <h1>The vault, alive</h1>
    <p>Every stake with its .skr name. Every exit, cooling in the open.</p>
  </div>
  <div class="bottom">
    <div class="board">CELLS<span class="unit">B SKR held</span></div>
    <div class="foot">Vault · Flow · Me · Alerts</div>
  </div>
</div>""".replace("CELLS", cells).replace("MARK", MARK)
    css = """
  .sheet{position:relative;width:1200px;height:1200px;overflow:hidden;background:BG;}
  .scene{position:absolute;inset:0;background:url('URI') center/1200px 1200px no-repeat;}
  .shade{position:absolute;inset:0;
         background:linear-gradient(180deg,rgba(4,7,11,.96) 0,rgba(4,7,11,.88) 330px,rgba(4,7,11,0) 560px,rgba(4,7,11,0) 760px,rgba(4,7,11,.94) 1060px);}
  .top{position:absolute;left:84px;right:84px;top:84px;}
  .brand{display:flex;align-items:center;gap:18px;}
  .brand .mark{width:52px;height:52px;}
  .brand .wordmark{font-size:30px;color:TEXT;}
  h1{margin-top:34px;font-size:84px;line-height:1.05;font-weight:700;letter-spacing:-.02em;color:TEXT;}
  p{margin-top:20px;font-size:31px;line-height:1.4;color:MUTED;max-width:900px;}
  .bottom{position:absolute;left:84px;right:84px;bottom:84px;}
  .board{display:flex;align-items:center;gap:10px;}
  .cell{width:96px;height:152px;border-radius:16px;background:#0B131B;border:1px solid #22323F;
        font-family:'Geist Mono',monospace;font-weight:900;font-size:96px;color:TEXT;
        display:flex;align-items:center;justify-content:center;position:relative;}
  .cell::after{content:'';position:absolute;left:0;right:0;top:50%;height:2px;background:rgba(0,0,0,.55);}
  .dot{width:14px;height:14px;border-radius:50%;background:METAL;align-self:flex-end;margin:0 8px 24px;}
  .unit{margin-left:24px;font-size:30px;color:MUTED;font-weight:600;letter-spacing:.04em;}
  .foot{margin-top:34px;font-size:26px;color:FAINT;letter-spacing:.02em;}
""".replace("TEXT", TEXT).replace("MUTED", MUTED).replace("METAL", METAL).replace("FAINT", FAINT).replace("BG", BG).replace("URI", data_uri(MEDIA / "bg-feature.png"))
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
