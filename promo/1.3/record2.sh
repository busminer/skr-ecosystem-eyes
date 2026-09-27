#!/bin/bash
# Second pass: the support card and the thank-you sheet.
#
# The first take lost the card. scrcpy stamps the file from the first frame it
# actually receives, and a still screen makes no frames, so five seconds of a
# motionless Alerts screen never reached the file and the clip opened with the
# sheet already up. This take keeps the picture moving from the first second.
set -u
SC="/c/Users/Alex Kosa/AppData/Local/Microsoft/WinGet/Packages/Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe/scrcpy-win64-v4.1/scrcpy.exe"
OUT="/c/skrx/promo/1.3/clips"
ALERTS=1077; TABY=2510

adb shell am start -n dev.alexkosa.skreyes/dev.alexkosa.skreyes.MainActivity >/dev/null 2>&1
sleep 8
adb shell input tap $ALERTS $TABY; sleep 5
# park just above the support card, so the take opens on a scroll that reveals it
for i in 1 2 3; do adb shell input swipe 600 1900 600 1000 600; sleep 1; done
sleep 2

"$SC" --no-window --no-audio --record="$OUT/tip.mp4" --time-limit=16 >/dev/null 2>&1 &
sleep 1
adb shell input swipe 600 1900 600 1250 900      # the support card slides up into frame
sleep 4
adb exec-out screencap -p > /c/skrx/promo/1.3/shots/09-support.png
adb shell input tap 960 1512                      # Send a tip
sleep 5
adb shell input tap 462 624                       # SKR
sleep 2
adb shell input tap 700 1150                      # 1
sleep 3
wait
adb exec-out screencap -p > /c/skrx/promo/1.3/shots/10-tipsheet.png
adb shell input tap 1095 351 >/dev/null 2>&1
ls -la "$OUT/tip.mp4"
