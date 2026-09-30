# Where the Eye's walk-through sounds come from

28.09.2026. Alex rejected three synthesised sets (a glass mallet: "a squeak";
singing bowls: "a funeral bell"; eight synthesised directions). These come from
Mixkit (mixkit.co), recorded by sound designers, under the Mixkit Sound Effects
Free License, which allows using them inside a product such as this app (not
redistributing them on their own). Downloaded as WAV, mixed to mono, trimmed,
faded and peak-normalised; no other change.

Second pick, the same evening: the fairy sparkles sounded like a toy. Alex
chose "Seeker technology" from five directions:

| file | Mixkit sound | id |
| --- | --- | --- |
| tone1.wav … tone7.wav | Sci Fi confirmation, pitched up 0, 1, 2, 3, 5, 6, 7 semitones, one per page | 914 |
| chime.wav | Cybernetic technology affirmation | 3116 |
| heart.wav | Futuristic space intro, the 1.35 s building up to its peak | 2523 |
| hum.wav | Futuristic space intro, 3.2 s from its first sound | 2523 |

wake.wav and wink.wav are the app's own launch sounds and are unchanged.
scripts/make-eye-sounds.py made the earlier synthesised sets and is kept only
as a record; running it would overwrite these files.

Third pick, 28.09.2026 late evening: Alex found the sci-fi confirmations on page two
"disgusting" and asked for sounds that are pleasant and mystical. The Seeker-technology
set is replaced by a harp:

| file | Mixkit sound | id |
| --- | --- | --- |
| tone1.wav … tone7.wav | Relaxing harp sweep, one 1.25 s ripple from 1.72 s, up 0, 2, 4, 5, 7, 9, 11 semitones, one per page | 2628 |
| hum.wav | Relaxing harp sweep, 3.2 s from 0.9 s, faded in | 2628 |
| heart.wav | Relaxing harp sweep, the glissando from 0.55 s rising to its peak | 2628 |
| chime.wav | Choir harp bless, 2.3 s | 657 |

Made by scripts/make-eye-sounds-harp.py (mono, 6 kHz soft low-pass, fades, peak-normalised);
it reads the two Mixkit WAVs from a folder given on the command line.

Same night, second pass: the harp was «немножко звонкий» (a little ringing). Now a fourth
lower (tones -5, -3, -2, 0, 2, 3, 5 semitones; hum -5; chime -2; heart unshifted so its peak
still lands on the lids), a 4th-order low-pass at 2.4 kHz (2.8 kHz for the chime), a slower
fade-in to soften the pluck, and a soft dark room tail. Same script, same two recordings.

Fourth pick, 30.09.2026: Alex called the harp plucks boring. The same «Choir harp bless»
(657) stays the raw material — the one recording he had not rejected — but it is no longer
played as plucks: `scripts/make-eye-sounds-breath.py` time-stretches its spectrum into a
breathing pad (paulstretch: windowed FFT, magnitudes kept, phases scattered) and lays one
synthesised warm-glass strike on top of each moment, so a note begins where the finger can
feel it. tone1-7 climb a pentatonic line (0 2 4 7 9 12 14 semitones), loudness-matched;
hum is 3.4 s of the stretched choir fading in and out; heart is the same cloth pulled into
a rise that peaks at 1.35 s with a warm 165→220 Hz sine growing under it; chime is one
glass strike inside a short choir bloom. Nothing meaningful under 160 Hz — the Seeker's
speaker rattles there. The bless as the third pick shipped it is kept as `src-bless.wav`
(not bundled: nothing require()s it), so the script can run again.
