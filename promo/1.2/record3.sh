#!/bin/bash
# One clip per run, and the run waits for the recorder to exit before it ends.
# The batch version raced: the next scrcpy started while the previous one still
# held the device, and wrote empty files.
set -u
NAME=${1:?clip name}
SECS=${2:?seconds}
SC="/c/Users/Alex Kosa/AppData/Local/Microsoft/WinGet/Packages/Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe/scrcpy-win64-v4.1/scrcpy.exe"
OUT="/c/skrx/promo/1.2/clips"
TABY=2536; VAULT=118; FLOW=357; TOP=596; ME=835; ALERTS=1073

up() { adb shell input swipe 600 1700 600 1100 1000; }
down() { adb shell input swipe 600 1100 600 1700 1000; }

# get the screen ready before the recorder rolls
case "$NAME" in
  toplist) adb shell input tap $TOP $TABY; sleep 4; adb shell input swipe 600 1100 600 1900 700; sleep 3 ;;
  youcard) adb shell input tap $TOP $TABY; sleep 3; adb shell input swipe 600 1100 600 1900 700; sleep 3 ;;
  radar)   adb shell input tap $TOP $TABY; sleep 3; adb shell input swipe 600 1100 600 1900 700; sleep 3 ;;
  me)      adb shell input tap $ME $TABY; sleep 8 ;;
  alerts)  adb shell input tap $ALERTS $TABY; sleep 5 ;;
  flow)    adb shell input tap $FLOW $TABY; sleep 5 ;;
esac

"$SC" --no-window --no-audio --record="$OUT/$NAME.mp4" --time-limit="$SECS" >"$OUT/$NAME.log" 2>&1 &
PID=$!
sleep 2

case "$NAME" in
  toplist) sleep 6; up; sleep 3; up; sleep 3; up; sleep 3 ;;
  youcard) sleep 7 ;;
  radar)   adb shell input tap 975 931; sleep 9; adb shell input swipe 700 1400 430 1150 800; sleep 3; adb shell input tap 690 1050; sleep 5 ;;
  me)      sleep 6; up; sleep 3; up; sleep 3 ;;
  alerts)  sleep 4; up; sleep 3; up; sleep 3 ;;
  flow)    sleep 3; up; sleep 3; up; sleep 3 ;;
esac

wait $PID
sleep 1
ls -la "$OUT/$NAME.mp4" | awk '{print $9, $5, "bytes"}'
