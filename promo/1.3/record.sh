#!/bin/bash
# Record the 1.3 promo footage off the Seeker, one clip per beat.
#
# 1.3 redrew every screen, so none of the 1.2 clips can be reused: this is a
# fresh pass over the same phone. The launch clip carries the app's own opening
# sound (the turn, wake.wav and its echo); everything after it is silent
# picture, because the voice sits over it.
set -u
SC="/c/Users/Alex Kosa/AppData/Local/Microsoft/WinGet/Packages/Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe/scrcpy-win64-v4.1/scrcpy.exe"
OUT="/c/skrx/promo/1.3/clips"
PKG=dev.alexkosa.skreyes
ACT=$PKG/dev.alexkosa.skreyes.MainActivity

# 1.3 bottom bar: five icons with labels, measured off a screencap
VAULT=120; FLOW=360; TOP=597; ME=837; ALERTS=1077; TABY=2510

up()   { adb shell input swipe 600 1900 600 1150 800; }
down() { adb shell input swipe 600 1150 600 1900 800; }

rec() { # rec <name> <seconds> [audio]
  local name=$1 secs=$2 audio=${3:-none}
  if [ "$audio" = "audio" ]; then
    "$SC" --no-window --record="$OUT/$name.mp4" --time-limit="$secs" --audio-source=output >/dev/null 2>&1 &
  else
    "$SC" --no-window --no-audio --record="$OUT/$name.mp4" --time-limit="$secs" >/dev/null 2>&1 &
  fi
  sleep 2
}

# the screen must never sleep mid-take
adb shell settings put system screen_off_timeout 2147483647 >/dev/null 2>&1
adb shell svc power stayon true >/dev/null 2>&1

echo "0/7 park the app on Vault so the cold start opens there"
adb shell am start -n $ACT >/dev/null 2>&1; sleep 8
adb shell input tap $VAULT $TABY; sleep 3
adb shell am force-stop $PKG; sleep 2

echo "1/7 launch — the opening, with its own sound"
rec launch 11 audio
adb shell am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n $ACT >/dev/null 2>&1
sleep 10

echo "2/7 vault"
sleep 14                       # let the scene replay the last sixty moves
rec vault 20
sleep 7; up; sleep 3; up; sleep 4
sleep 2

echo "3/7 flow"
adb shell input tap $FLOW $TABY; sleep 6
rec flow 16
sleep 4
adb shell input tap 459 969    # Stakes
sleep 3
adb shell input tap 741 969    # Exits
sleep 3
adb shell input tap 171 969    # back to All
sleep 3

echo "4/7 top"
adb shell input tap $TOP $TABY; sleep 7
rec top 18
sleep 4; up; sleep 3; up; sleep 3
down; sleep 1; down; sleep 3
adb shell input tap 597 492    # BY EARNED
sleep 4

echo "5/7 radar"
adb shell input tap 222 492    # back to BY STAKE
sleep 3
rec radar 16
sleep 2
adb shell input tap 960 1380   # Open radar
sleep 7
adb shell input swipe 700 1500 460 1180 800
sleep 3
adb shell input tap 690 1100   # tap a phone, its name comes up
sleep 4

echo "6/7 me"
adb shell input tap 200 330 >/dev/null 2>&1   # leave the radar
sleep 3
adb shell input tap $ME $TABY; sleep 9
rec me 16
sleep 6; up; sleep 3; up; sleep 5

echo "7/7 tip"
adb shell input tap $ALERTS $TABY; sleep 6
for i in 1 2 3 4; do adb shell input swipe 600 1900 600 900 600; sleep 1; done
sleep 3
rec tip 14
sleep 3
adb shell input tap 960 1512   # Send a tip
sleep 8

sleep 3
adb shell input tap 1095 351 >/dev/null 2>&1  # close the sheet
ls -la "$OUT"
