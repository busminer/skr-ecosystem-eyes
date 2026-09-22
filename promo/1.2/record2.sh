#!/bin/bash
# Longer takes: each beat is as long as the line spoken over it, and the voice
# runs to eleven seconds in places, so the picture has to outlast it.
set -u
SC="/c/Users/Alex Kosa/AppData/Local/Microsoft/WinGet/Packages/Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe/scrcpy-win64-v4.1/scrcpy.exe"
OUT="/c/skrx/promo/1.2/clips"
PKG=dev.alexkosa.skreyes
VAULT=118; FLOW=357; TOP=596; ME=835; ALERTS=1073; TABY=2536

rec() { "$SC" --no-window --no-audio --record="$OUT/$1.mp4" --time-limit="$2" >/dev/null 2>&1 & sleep 2; }
up() { adb shell input swipe 600 1700 600 1100 1000; }
down() { adb shell input swipe 600 1100 600 1700 1000; }

echo "vault 26s"
adb shell input tap $VAULT $TABY; sleep 4
adb shell input swipe 600 1100 600 1900 800; sleep 3   # back to the top
rec vault 26
sleep 13; up; sleep 3; up; sleep 4; up; sleep 3

echo "toplist 22s"
adb shell input tap $TOP $TABY; sleep 5
rec toplist 22
sleep 6; up; sleep 3; up; sleep 3; up; sleep 3; up; sleep 3

echo "youcard 9s"
down; sleep 1; down; sleep 1; down; sleep 1; down; sleep 3
rec youcard 9
sleep 8

echo "radar 22s"
rec radar 22
sleep 1
adb shell input tap 975 931
sleep 9
adb shell input swipe 700 1400 430 1150 800
sleep 3
adb shell input tap 690 1050
sleep 6

echo "me 15s"
adb shell input tap 200 330 >/dev/null 2>&1
sleep 3
adb shell input tap $ME $TABY; sleep 9
rec me 15
sleep 6; up; sleep 3; up; sleep 4

echo "alerts 14s"
adb shell input tap $ALERTS $TABY; sleep 5
rec alerts 14
sleep 4; up; sleep 3; up; sleep 3; up; sleep 2

sleep 2
ls -la "$OUT"
