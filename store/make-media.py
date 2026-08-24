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
    bars = "".join("<i style='height:%dpx;background:%s'></i>" % pair for pair in BAR_SHAPE)
    body = """
<div class="sheet">
  <div class="glow"></div>
  <div class="bars">BARS</div>
  <div class="row">
    <div class="badge">MARK</div>
    <div class="copy">
      <div class="wordmark">SKR EYES</div>
      <div class="tag">every number has a receipt</div>
      <div class="line"></div>
      <div class="sub">Independent SKR staking analytics for Seeker — and staking itself</div>
    </div>
  </div>
</div>""".replace("BARS", bars).replace("MARK", MARK)
    css = """
  .sheet{position:relative;width:1200px;height:600px;padding:0 88px 44px;
         display:flex;align-items:center;overflow:hidden;}
  .glow{position:absolute;right:-160px;top:-220px;width:760px;height:760px;border-radius:50%;
        background:radial-gradient(circle,rgba(86,224,255,.16),rgba(86,224,255,0) 62%);}
  .bars{position:absolute;left:0;right:0;bottom:0;height:150px;display:flex;
        align-items:flex-end;gap:34px;padding:0 70px;opacity:.20;
        -webkit-mask-image:linear-gradient(to bottom,rgba(0,0,0,1),rgba(0,0,0,0) 96%);}
  .bars i{flex:1;border-radius:4px 4px 0 0;}
  .row{position:relative;display:flex;align-items:center;gap:56px;}
  .badge{width:196px;height:196px;flex:none;border-radius:44px;background:PANEL;
         border:1px solid LINE;display:flex;align-items:center;justify-content:center;}
  .badge .mark{width:132px;height:132px;}
  .wordmark{font-size:78px;line-height:1;}
  .tag{margin-top:18px;font-size:26px;color:MUTED;letter-spacing:.02em;}
  .line{margin:28px 0 22px;width:120px;height:2px;background:METAL;opacity:.85;}
  .sub{font-size:21px;color:FAINT;max-width:720px;line-height:1.45;}
""".replace("PANEL", PANEL).replace("LINE", LINE).replace("MUTED", MUTED).replace("METAL", METAL).replace("FAINT", FAINT)
    render("banner-1200x600.png", 1200, 600, body, css)


def feature():
    cells = "".join('<div class="cell">%s</div>' % ch if ch.isdigit() else '<div class="dot"></div>'
                    for ch in "5.09")
    body = """
<div class="sheet">
  <div class="glow"></div>
  <div class="badge">MARK</div>
  <div class="wordmark">SKR EYES</div>
  <div class="tag">every number has a receipt</div>
  <div class="board">CELLS<span class="unit">B SKR staked</span></div>
  <div class="rule"></div>
  <div class="foot">Pulse · Flow · Your position · Exit queue · Unlock alerts</div>
</div>""".replace("CELLS", cells).replace("MARK", MARK)
    css = """
  .sheet{position:relative;width:1200px;height:1200px;padding:88px 90px 76px;
         display:flex;flex-direction:column;align-items:center;overflow:hidden;}
  .glow{position:absolute;left:50%;top:-260px;transform:translateX(-50%);
        width:1000px;height:1000px;border-radius:50%;
        background:radial-gradient(circle,rgba(86,224,255,.15),rgba(86,224,255,0) 60%);}
  .badge{position:relative;width:280px;height:280px;border-radius:64px;background:PANEL;
         border:1px solid LINE;display:flex;align-items:center;justify-content:center;}
  .badge .mark{width:190px;height:190px;}
  .wordmark{position:relative;margin-top:64px;font-size:96px;line-height:1;}
  .tag{position:relative;margin-top:22px;font-size:30px;color:MUTED;}
  .board{position:relative;margin-top:auto;margin-bottom:auto;display:flex;align-items:center;gap:10px;}
  .cell{width:104px;height:168px;border-radius:18px;background:#0B131B;border:1px solid #22323F;
        font-family:'Geist Mono',monospace;font-weight:900;font-size:104px;color:TEXT;
        display:flex;align-items:center;justify-content:center;position:relative;}
  .cell::after{content:'';position:absolute;left:0;right:0;top:50%;height:2px;
               background:rgba(0,0,0,.55);}
  .dot{width:16px;height:16px;border-radius:50%;background:METAL;align-self:flex-end;
       margin:0 8px 26px;}
  .unit{margin-left:26px;font-size:30px;color:MUTED;font-weight:600;letter-spacing:.04em;}
  .rule{position:relative;width:150px;height:2px;background:METAL;opacity:.7;margin-bottom:34px;}
  .foot{position:relative;font-size:26px;color:FAINT;letter-spacing:.02em;}
""".replace("PANEL", PANEL).replace("LINE", LINE).replace("MUTED", MUTED).replace("METAL", METAL).replace("FAINT", FAINT).replace("TEXT", TEXT)
    render("feature-1200x1200.png", 1200, 1200, body, css)


SHOTS = [
    ("cap-pulse.png", "The whole vault, at a glance",
     "How much SKR is staked, what moved in the last 24 hours, and when the exit queue matures."),
    ("cap-flow.png", "Every finalized move, live",
     "The chain's own floor: each stake, exit and withdrawal as it lands, the big ones pinned."),
    ("cap-me.png", "Your position, with its age",
     "What you hold, how long you have held it, your weight in the vault — and Stake SKR."),
    ("cap-queue.png", "What is leaving, and when",
     "The 48 hour exit queue, soonest first, so a wave never arrives as a surprise."),
    ("cap-alerts.png", "Woken by your own unlock",
     "Alerts are scheduled on this phone. No push server, no account, no address leaves it."),
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
