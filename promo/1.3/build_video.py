"""Cut the SKR Eyes 1.3 promo, in two versions off one set of footage.

    python promo/1.3/build_video.py calm
    python promo/1.3/build_video.py punch
    python promo/1.3/build_video.py both

Vertical 1080x1920. Every beat is real footage off the Seeker, shot on 1.3
after the design pass — none of the 1.2 clips could be reused, every screen was
redrawn. The film opens on the app's own opening: the device turns, the eye
blinks, and the sound under it is the app's own `wake.wav`, taken out of the
recording rather than added to it.

Two cuts, same script and same pictures:

  calm   the product cut. One beat per line, a fade between sections, a slow
         pad underneath. About sixty five seconds.
  punch  the cut that has to move. The voice is read faster, the camera pushes
         on every beat, sections slide instead of fading, the app's own sounds
         land on the cuts and the bed has a pulse. About fifty five.

Nothing in either version shows the app staking, because it cannot: 1.3 reads
the chain and builds no transaction. The one line about staking says where it
went.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CLIPS = os.path.join(HERE, "clips")
SCENES = os.path.join(HERE, "scenes")
MUSIC = os.path.join(HERE, "music")
SOUND = r"C:\skrx\assets\sound"
FFMPEG = r"C:\Users\Alex Kosa\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.1-full_build\bin\ffmpeg.exe"
FFPROBE = FFMPEG.replace("ffmpeg.exe", "ffprobe.exe")

W, H = 1080, 1920
FPS = 30
WIN_W, WIN_H, WIN_X, WIN_Y = 684, 1520, 198, 90

# The opening sound starts 2.2s into the launch recording and the splash a
# breath before it; the film starts there, so the first thing anybody hears is
# the app waking up.
LAUNCH_FROM = 1.85

# name, clip, in-point, line, caption, push direction, sound on the cut into it
BEATS = [
    ("launch",  "launch.mp4",  LAUNCH_FROM, "l1",  "cap-version", None,  None),
    ("vault",   "vault.mp4",    0.80, "l2",  "cap-vault",   "in",   "flip"),
    ("numbers", "vault.mp4",    9.90, "l3",  "cap-numbers", None,   "flip"),
    ("flow",    "flow.mp4",     0.60, "l4",  "cap-flow",    None,   "in"),
    ("top",     "top.mp4",      0.60, "l5",  "cap-top",     None,   "flip"),
    ("radar",   "radar.mp4",    4.60, "l6",  "cap-radar",   "out",  "surge"),
    ("me",      "me.mp4",       0.60, "l7",  "cap-me",      "in",   "flip"),
    ("tip",     "tip.mp4",      2.40, "l8",  "cap-tip",     None,   "coin"),
    ("reading", "vault2.mp4",   1.00, "l9",  "cap-reading", "out",  "wink"),
    ("end",     "end.png",      0.00, "l10", None,          None,   None),
]

STYLES = {
    "calm": {
        "voice": "voice",
        "out": "skr-eyes-1.3-promo.mp4",
        "lead": 0.25, "splash_lead": 2.70, "tail": 0.42, "end_tail": 0.95,
        "trans": {"launch": ("fade", 0.50), "vault": ("slideup", 0.35), "numbers": ("fade", 0.40),
                  "flow": ("fade", 0.40), "top": ("slideleft", 0.32), "radar": ("fade", 0.40),
                  "me": ("fade", 0.40), "tip": ("fade", 0.40), "reading": ("fade", 0.50)},
        "push": False, "cuts": False, "music": "calm.wav", "music_gain": 0.11, "zoom": 1.14,
    },
    "punch": {
        "voice": "voice-fast",
        "out": "skr-eyes-1.3-promo-punch.mp4",
        "lead": 0.12, "splash_lead": 2.35, "tail": 0.20, "end_tail": 0.80,
        "trans": {"launch": ("fade", 0.35), "vault": ("slideup", 0.22), "numbers": ("slideup", 0.22),
                  "flow": ("slideleft", 0.22), "top": ("slideleft", 0.22), "radar": ("smoothleft", 0.25),
                  "me": ("slideleft", 0.22), "tip": ("slideup", 0.22), "reading": ("fade", 0.40)},
        "push": True, "cuts": True, "music": "pulse.wav", "music_gain": 0.15, "zoom": 1.20,
    },
}


def probe(path):
    out = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=nw=1:nk=1", path], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def plan(style):
    voice_dir = os.path.join(HERE, style["voice"])
    beats, t = [], 0.0
    for name, source, start, line, caption, push, cut in BEATS:
        spoken = probe(os.path.join(voice_dir, line + ".mp3"))
        # The opening keeps the floor to itself: the voice waits until the
        # device has turned and the eye has blinked.
        lead = style["splash_lead"] if name == "launch" else style["lead"]
        tail = style["end_tail"] if name == "end" else style["tail"]
        length = lead + spoken + tail
        beats.append({"name": name, "source": source, "start": start, "line": line,
                      "caption": caption, "length": length, "voice_at": t + lead,
                      "push": push if style["push"] else None,
                      "cut": cut if style["cuts"] else None, "at": t})
        trans = style["trans"].get(name)
        t += length - (trans[1] if trans else 0.0)
    return beats, t


def build(style_name):
    style = STYLES[style_name]
    voice_dir = os.path.join(HERE, style["voice"])
    out_path = os.path.join(HERE, style["out"])
    beats, total = plan(style)
    print("---", style_name)
    for b in beats:
        print("  %-8s %6.2fs  at %6.2f  voice %6.2f" % (b["name"], b["length"], b["at"], b["voice_at"]))
    print("  total %.2fs" % total)

    cmd = [FFMPEG, "-y", "-v", "error"]
    for b in beats:
        path = os.path.join(SCENES if b["source"].endswith(".png") else CLIPS, b["source"])
        if b["source"].endswith(".png"):
            cmd += ["-loop", "1", "-framerate", str(FPS), "-t", "%.3f" % b["length"], "-i", path]
        else:
            cmd += ["-ss", "%.2f" % b["start"], "-i", path]

    frame_idx = len(beats)
    cmd += ["-i", os.path.join(SCENES, "frame.png")]
    caption_index, idx = {}, frame_idx + 1
    for b in beats:
        if b["caption"]:
            caption_index[b["name"]] = idx
            cmd += ["-i", os.path.join(SCENES, b["caption"] + ".png")]
            idx += 1

    audio_start = idx
    cmd += ["-ss", "%.2f" % LAUNCH_FROM, "-i", os.path.join(CLIPS, "launch.mp4")]
    for b in beats:
        cmd += ["-i", os.path.join(voice_dir, b["line"] + ".mp3")]
    music_idx = audio_start + 1 + len(beats)
    cmd += ["-i", os.path.join(MUSIC, style["music"])]
    cut_sounds = [(b["at"], b["cut"]) for b in beats if b["cut"]]
    cut_base = music_idx + 1
    for _, sound in cut_sounds:
        cmd += ["-i", os.path.join(SOUND, sound + ".wav")]

    f = []
    for i, b in enumerate(beats):
        d = b["length"]
        if b["source"].endswith(".png"):
            f.append("[%d:v]scale=%d:%d,fps=%d,format=yuv420p,setsar=1,trim=duration=%.3f,"
                     "setpts=PTS-STARTPTS[v%d]" % (i, W, H, FPS, d, i))
            continue
        # The capture is 1200x2670 and goes into the rounded window whole rather
        # than cropped: cropping to 9:16 would cut either the screen's title or
        # its tab bar, and both are the point of the shot. tpad holds the last
        # frame, because a still screen makes no frames and some takes end
        # earlier than the wall clock says.
        if b["push"]:
            z = style["zoom"]
            big_w, big_h = int(WIN_W * z), int(WIN_H * z)
            grow = ("min(t/%.3f\\,1)" % d) if b["push"] == "out" else ("(1-min(t/%.3f\\,1))" % d)
            f.append("[%d:v]scale=%d:%d,fps=%d,setsar=1,tpad=stop_mode=clone:stop_duration=8,"
                     "trim=duration=%.3f,setpts=PTS-STARTPTS,"
                     "crop=w='%d+%d*%s':h='%d+%d*%s':x='(in_w-out_w)/2':y='(in_h-out_h)/2',"
                     "scale=%d:%d[s%d]"
                     % (i, big_w, big_h, FPS, d, WIN_W, big_w - WIN_W, grow,
                        WIN_H, big_h - WIN_H, grow, WIN_W, WIN_H, i))
        else:
            f.append("[%d:v]scale=%d:%d,fps=%d,setsar=1,tpad=stop_mode=clone:stop_duration=8,"
                     "trim=duration=%.3f,setpts=PTS-STARTPTS[s%d]" % (i, WIN_W, WIN_H, FPS, d, i))
        f.append("color=c=0x04070B:s=%dx%d:r=%d:d=%.3f,format=yuv420p,setsar=1[bg%d]" % (W, H, FPS, d, i))
        f.append("[bg%d][s%d]overlay=%d:%d:shortest=1[o%d]" % (i, i, WIN_X, WIN_Y, i))
        f.append("[%d:v]format=rgba,loop=loop=-1:size=1:start=0,trim=duration=%.3f,"
                 "setpts=PTS-STARTPTS[fr%d]" % (frame_idx, d, i))
        f.append("[o%d][fr%d]overlay=0:0[of%d]" % (i, i, i))
        if b["caption"]:
            c = caption_index[b["name"]]
            rise = 0.30 if style["cuts"] else 0.45
            fade_out = max(0.1, d - 0.55)
            f.append("[%d:v]format=rgba,loop=loop=-1:size=1:start=0,trim=duration=%.3f,setpts=PTS-STARTPTS,"
                     "fade=t=in:st=0.12:d=%.2f:alpha=1,fade=t=out:st=%.2f:d=0.40:alpha=1[cp%d]"
                     % (c, d, rise, fade_out, i))
            f.append("[of%d][cp%d]overlay=0:0,format=yuv420p[v%d]" % (i, i, i))
        else:
            f.append("[of%d]format=yuv420p[v%d]" % (i, i))

    prev, offset = "v0", 0.0
    for i, b in enumerate(beats[:-1]):
        kind, dur = style["trans"][b["name"]]
        offset += b["length"] - dur if i else beats[0]["length"] - dur
        nxt = "vx%d" % i if i < len(beats) - 2 else "vout"
        f.append("[%s][v%d]xfade=transition=%s:duration=%s:offset=%.3f[%s]"
                 % (prev, i + 1, kind, dur, offset, nxt))
        prev = nxt

    # The opening sound is the app's own, lifted straight off the recording.
    f.append("[%d:a]atrim=duration=4.4,asetpts=PTS-STARTPTS,volume=1.0,afade=t=out:st=3.6:d=0.8[cue]"
             % audio_start)
    mixes = ["[cue]"]
    for j, b in enumerate(beats):
        v = audio_start + 1 + j
        ms = int(b["voice_at"] * 1000)
        f.append("[%d:a]adelay=%d|%d,volume=1.3[a%d]" % (v, ms, ms, v))
        mixes.append("[a%d]" % v)
    # The bed: under everything, faded at both ends, and never in the way.
    f.append("[%d:a]atrim=duration=%.3f,asetpts=PTS-STARTPTS,volume=%.3f,afade=t=in:st=0:d=1.6,"
             "afade=t=out:st=%.2f:d=3.0[bed]"
             % (music_idx, total, style["music_gain"], max(0.0, total - 3.0)))
    mixes.append("[bed]")
    for k, (at, sound) in enumerate(cut_sounds):
        ms = int(max(0.0, at - 0.06) * 1000)
        f.append("[%d:a]adelay=%d|%d,volume=0.30[c%d]" % (cut_base + k, ms, ms, k))
        mixes.append("[c%d]" % k)
    f.append("".join(mixes) + "amix=inputs=%d:normalize=0:dropout_transition=0,"
             "volume=2.6dB,alimiter=limit=0.89,aresample=48000[aout]" % len(mixes))

    cmd += ["-filter_complex", ";".join(f),
            "-map", "[vout]", "-map", "[aout]",
            "-c:v", "libx264", "-preset", "medium", "-crf", "20",
            "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
            "-movflags", "+faststart", "-t", "%.3f" % total, out_path]
    subprocess.run(cmd, check=True)
    print("  wrote", out_path, "%.1f MB" % (os.path.getsize(out_path) / 1e6))


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "both"
    for name in (["calm", "punch"] if which == "both" else [which]):
        build(name)
