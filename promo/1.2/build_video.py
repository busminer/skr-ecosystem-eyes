"""Cut the SKR Eyes 1.2 promo: the app's own launch, then the app itself moving.

    python promo/1.2/build_video.py

Vertical 1080x1920, about ninety seconds. Unlike the FLOP film, which pushed
into stills, every beat here is real footage off the Seeker — Alex asked to see
the thing scroll — laid inside a rounded window with the caption under it.

Each beat lasts exactly as long as the line spoken over it plus a breath, so
the voice is never clipped and never waits. Inside a section the picture slides,
between sections it fades.
"""
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
CLIPS = os.path.join(HERE, "clips")
SCENES = os.path.join(HERE, "scenes")
VOICE = os.path.join(HERE, "voice")
OUT = os.path.join(HERE, "skr-eyes-1.2-promo.mp4")
FFMPEG = r"C:\Users\Alex Kosa\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.1-full_build\bin\ffmpeg.exe"
FFPROBE = FFMPEG.replace("ffmpeg.exe", "ffprobe.exe")

W, H = 1080, 1920
FPS = 30
# where the phone screen sits inside the frame, matching scenes.frame()
WIN_W, WIN_H, WIN_X, WIN_Y = 684, 1520, 198, 90
LEAD_IN = 0.25          # the voice starts just after a cut, not on it

# name, clip (or still), in-point, voice line, caption, tail silence, camera push
BEATS = [
    ("launch",  "launch.mp4",  1.60, "l1",  "cap-version",  0.50, None),
    ("vault",   "vault.mp4",   0.60, "l2",  "cap-vault",    0.45, None),
    ("day",     "vault.mp4",  14.60, "l3",  "cap-day",      0.40, None),
    ("flow",    "flow.mp4",    0.60, "l4",  "cap-flow",     0.45, None),
    ("top",     "topwalk.mp4", 1.40, "l5",  "cap-top",      0.35, None),
    ("orders",  "topwalk.mp4", 4.60, "l6",  "cap-orders",   0.45, None),
    ("you",     "topwalk.mp4",16.40, "l7",  "cap-you",      0.40, None),
    ("radar",   "topwalk.mp4",21.40, "l8",  "cap-radar",    0.40, "in"),
    ("touch",   "topwalk.mp4",29.60, "l9",  "cap-touch",    0.45, "out"),
    ("me",      "me.mp4",      1.20, "l10", "cap-me",       0.45, None),
    ("alerts",  "alerts.mp4",  0.50, "l11", "cap-alerts",   0.50, None),
    ("end",     "end.png",     0.00, "l12", None,           0.90, None),
]

# how each beat hands over to the next
TRANS = {
    "launch": ("fade", 0.5),
    "vault": ("slideup", 0.35),
    "day": ("fade", 0.4),
    "flow": ("fade", 0.4),
    "top": ("slideleft", 0.3),
    "orders": ("slideleft", 0.3),
    "you": ("fade", 0.4),
    "radar": ("slideleft", 0.3),
    "touch": ("fade", 0.4),
    "me": ("fade", 0.4),
    "alerts": ("fade", 0.5),
}

# The recorder was rolling before the app was launched; the opening starts at
# 1.6s into the file and its sound with it, so the film opens on the sound.
LAUNCH_AUDIO_FROM = 1.60


def probe(path):
    out = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=nw=1:nk=1", path], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def plan():
    beats, t = [], 0.0
    for name, source, start, line, caption, tail, push in BEATS:
        spoken = probe(os.path.join(VOICE, line + ".mp3"))
        # The opening keeps the floor to itself: Alex asked for the app's own
        # launch sound to be the first thing anybody hears, so the voice waits
        # until the phone has turned and the eye has blinked.
        lead = 2.70 if name == "launch" else LEAD_IN
        length = lead + spoken + tail
        beats.append({"name": name, "source": source, "start": start, "line": line,
                      "caption": caption, "length": length, "voice_at": t + lead, "push": push})
        trans = TRANS.get(name)
        t += length - (trans[1] if trans else 0.0)
    return beats, t


def main():
    beats, total = plan()
    for b in beats:
        print(f"{b['name']:7} {b['length']:6.2f}s  voice at {b['voice_at']:6.2f}")
    print(f"total {total:.2f}s")

    cmd = [FFMPEG, "-y", "-v", "error"]

    # video sources, one input per beat
    for b in beats:
        path = os.path.join(SCENES if b["source"].endswith(".png") else CLIPS, b["source"])
        if b["source"].endswith(".png"):
            cmd += ["-loop", "1", "-framerate", str(FPS), "-t", f"{b['length']:.3f}", "-i", path]
        else:
            cmd += ["-ss", f"{b['start']:.2f}", "-i", path]

    frame_idx = len(beats)
    cmd += ["-i", os.path.join(SCENES, "frame.png")]
    caption_index = {}
    idx = frame_idx + 1
    for b in beats:
        if b["caption"]:
            caption_index[b["name"]] = idx
            cmd += ["-i", os.path.join(SCENES, b["caption"] + ".png")]
            idx += 1

    audio_start = idx
    cmd += ["-ss", f"{LAUNCH_AUDIO_FROM:.2f}", "-i", os.path.join(CLIPS, "launch.mp4")]
    for b in beats:
        cmd += ["-i", os.path.join(VOICE, b["line"] + ".mp3")]

    f = []
    for i, b in enumerate(beats):
        d = b["length"]
        if b["source"].endswith(".png"):
            f.append(f"[{i}:v]scale={W}:{H},fps={FPS},format=yuv420p,setsar=1,trim=duration={d:.3f},setpts=PTS-STARTPTS[v{i}]")
            continue
        # The capture is 1200x2670. It is scaled into the rounded window rather
        # than cropped, because cropping to 9:16 would cut either the screen's
        # own title or its tab bar, and both are the point of the shot.
        # `tpad` holds the last frame if a clip runs out: a still screen makes no
        # new frames, so some recordings are shorter than the wall clock says.
        if b["push"]:
            z = 1.18
            big_w, big_h = int(WIN_W * z), int(WIN_H * z)
            grow = "min(t/%.3f\,1)" % d if b["push"] == "out" else "(1-min(t/%.3f\,1))" % d
            f.append(f"[{i}:v]scale={big_w}:{big_h},fps={FPS},setsar=1,"
                     f"tpad=stop_mode=clone:stop_duration=6,trim=duration={d:.3f},setpts=PTS-STARTPTS,"
                     f"crop=w='{WIN_W}+{big_w - WIN_W}*{grow}':h='{WIN_H}+{big_h - WIN_H}*{grow}'"
                     f":x='(in_w-out_w)/2':y='(in_h-out_h)/2',scale={WIN_W}:{WIN_H}[s{i}]")
        else:
            f.append(f"[{i}:v]scale={WIN_W}:{WIN_H},fps={FPS},setsar=1,"
                     f"tpad=stop_mode=clone:stop_duration=6,trim=duration={d:.3f},setpts=PTS-STARTPTS[s{i}]")
        f.append(f"color=c=0x04070B:s={W}x{H}:r={FPS}:d={d:.3f},format=yuv420p,setsar=1[bg{i}]")
        f.append(f"[bg{i}][s{i}]overlay={WIN_X}:{WIN_Y}:shortest=1[o{i}]")
        f.append(f"[{frame_idx}:v]format=rgba,loop=loop=-1:size=1:start=0,trim=duration={d:.3f},setpts=PTS-STARTPTS[fr{i}]")
        f.append(f"[o{i}][fr{i}]overlay=0:0[of{i}]")
        if b["caption"]:
            c = caption_index[b["name"]]
            fade_out = max(0.1, d - 0.6)
            f.append(f"[{c}:v]format=rgba,loop=loop=-1:size=1:start=0,trim=duration={d:.3f},setpts=PTS-STARTPTS,"
                     f"fade=t=in:st=0.15:d=0.45:alpha=1,fade=t=out:st={fade_out:.2f}:d=0.45:alpha=1[cp{i}]")
            f.append(f"[of{i}][cp{i}]overlay=0:0,format=yuv420p[v{i}]")
        else:
            f.append(f"[of{i}]format=yuv420p[v{i}]")

    prev, offset = "v0", 0.0
    for i, b in enumerate(beats[:-1]):
        kind, dur = TRANS[b["name"]]
        offset += b["length"] - dur if i else beats[0]["length"] - dur
        nxt = f"vx{i}" if i < len(beats) - 2 else "vout"
        f.append(f"[{prev}][v{i+1}]xfade=transition={kind}:duration={dur}:offset={offset:.3f}[{nxt}]")
        prev = nxt

    # The launch sound is the app's own, taken from the recording itself.
    f.append(f"[{audio_start}:a]atrim=duration=4.2,asetpts=PTS-STARTPTS,volume=1.0,afade=t=out:st=3.4:d=0.8[cue]")
    mixes = ["[cue]"]
    for j, b in enumerate(beats):
        v = audio_start + 1 + j
        ms = int(b["voice_at"] * 1000)
        f.append(f"[{v}:a]adelay={ms}|{ms},volume=1.3[a{v}]")
        mixes.append(f"[a{v}]")
    f.append("".join(mixes) + f"amix=inputs={len(mixes)}:normalize=0:dropout_transition=0,"
             "alimiter=limit=0.95,aresample=48000[aout]")

    cmd += ["-filter_complex", ";".join(f),
            "-map", "[vout]", "-map", "[aout]",
            "-c:v", "libx264", "-preset", "medium", "-crf", "20",
            "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
            "-movflags", "+faststart", "-t", f"{total:.3f}", OUT]
    subprocess.run(cmd, check=True)
    print("wrote", OUT, f"{os.path.getsize(OUT)/1e6:.1f} MB")


if __name__ == "__main__":
    main()
