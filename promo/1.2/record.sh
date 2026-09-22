#!/bin/bash
# Record the promo footage off the Seeker, one clip per beat.
#
# The launch clip carries the app's own opening sound; everything after it is
# silent picture, because the voice will sit over it.
set -u
SC="/c/Users/Alex Kosa/AppData/Local/Microsoft/WinGet/Packages/Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe/scrcpy-win64-v4.1/scrcpy.exe"
OUT="/c/skrx/promo/1.2/clips"
PKG=dev.alexkosa.skreyes
ACT=$PKG/dev.alexkosa.skreyes.MainActivity

# tab coordinates on the Seeker, gesture navigation, font 1.0
VAULT=118; FLOW=357; TOP=596; ME=835; ALERTS=1073; TABY=2536

rec() { # rec <name> <seconds> [audio]
  local name=$1 secs=$2 audio=${3:-none}
  if [ "$audio" = "audio" ]; then
    "$SC" --no-window --record="$OUT/$name.mp4" --time-limit="$secs" --audio-source=output >/dev/null 2>&1 &
  else
    "$SC" --no-window --no-audio --record="$OUT/$name.mp4" --time-limit="$secs" >/dev/null 2>&1 &
  fi
  sleep 2
}

drag_up() { adb shell input swipe 600 1700 600 1050 900; }
drag_down() { adb shell input swipe 600 1050 600 1700 900; }

echo "1/8 launch"
adb shell am force-stop $PKG; sleep 1
rec launch 9 audio
adb shell am start -n $ACT >/dev/null 2>&1
sleep 8

echo "2/8 vault"
sleep 12                       # let the scene fill with the replay
rec vault 13
sleep 5; drag_up; sleep 2; drag_up; sleep 3
sleep 2

echo "3/8 flow"
adb shell input tap $FLOW $TABY; sleep 5
rec flow 11
sleep 3; drag_up; sleep 2; drag_up; sleep 3

echo "4/8 top list"
adb shell input tap $TOP $TABY; sleep 6
rec toplist 13
sleep 3; drag_up; sleep 2; drag_up; sleep 2; drag_up; sleep 3

echo "5/8 you card"
drag_down; sleep 1; drag_down; sleep 1; drag_down; sleep 3
rec youcard 7
sleep 6

echo "6/8 radar"
rec radar 14
sleep 1
adb shell input tap 975 931    # Open radar
sleep 6
adb shell input swipe 700 1400 420 1150 700   # drag the board
sleep 2
adb shell input tap 690 1050   # tap a phone on the inner ring
sleep 4

echo "7/8 me"
adb shell input tap 200 330 >/dev/null 2>&1   # leave the radar (Back to top)
sleep 3
adb shell input tap $ME $TABY; sleep 8
rec me 12
sleep 4; drag_up; sleep 2; drag_up; sleep 4

echo "8/8 alerts"
adb shell input tap $ALERTS $TABY; sleep 5
rec alerts 11
sleep 3; drag_up; sleep 2; drag_up; sleep 3

sleep 2
ls -la "$OUT"
