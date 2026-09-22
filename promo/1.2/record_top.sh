#!/bin/bash
# One continuous pass over Top, so the film can cut list → radar → list → radar
# and show the Open radar button doing its job. Everything here is a real touch;
# the phone will not give a shell two fingers, so the zoom is a camera move
# added in the cut, not a faked gesture.
set -u
SC="/c/Users/Alex Kosa/AppData/Local/Microsoft/WinGet/Packages/Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe/scrcpy-win64-v4.1/scrcpy.exe"
OUT="/c/skrx/promo/1.2/clips"
TOP=596; ME=835; TABY=2536

up() { adb shell input swipe 600 1700 600 1100 900; }
down() { adb shell input swipe 600 1100 600 1750 900; }

adb shell svc power stayon usb >/dev/null 2>&1
adb shell am start -n dev.alexkosa.skreyes/dev.alexkosa.skreyes.MainActivity >/dev/null 2>&1
sleep 9
adb shell input tap $TOP $TABY; sleep 5
down; down; sleep 3          # make sure the You card is in view

"$SC" --no-window --no-audio --record="$OUT/topwalk.mp4" --time-limit=46 >/dev/null 2>&1 &
PID=$!
sleep 2

sleep 3;  up                 # the list moves under the card
sleep 2;  up
sleep 2;  up
sleep 3;  down; sleep 1; down; sleep 1; down   # back to the card
sleep 3;  adb shell input tap 975 931          # Open radar
sleep 7;  adb shell input swipe 660 1500 480 1180 900   # look around the board
sleep 3;  adb shell input tap 690 1050         # tap a phone, its name comes up
sleep 4;  adb shell input tap 200 330          # Back to top
sleep 3;  up
sleep 2;  down
sleep 2;  adb shell input tap 975 931          # and back to the radar again
sleep 6

wait $PID
adb shell dumpsys window 2>&1 | grep -m1 mCurrentFocus
echo "--- me"
adb shell input tap 200 330 >/dev/null 2>&1
sleep 2
adb shell input tap $ME $TABY; sleep 8
"$SC" --no-window --no-audio --record="$OUT/me.mp4" --time-limit=20 >/dev/null 2>&1 &
PID=$!
sleep 2
sleep 4; up                  # weight, place, earned
sleep 4; up
sleep 5
wait $PID
adb shell dumpsys window 2>&1 | grep -m1 mCurrentFocus
