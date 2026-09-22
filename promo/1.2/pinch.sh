#!/system/bin/sh
# A real two-finger pinch on the Seeker's touchscreen.
#
# `input` can only put one finger down, and the radar answers to two, so the
# events are written straight to the touch device in the multitouch protocol.
# Runs on the phone: adb push, then adb shell sh /data/local/tmp/pinch.sh <args>
#
#   pinch.sh <cx> <cy> <from-half-gap> <to-half-gap> <steps> <sleep-ms>
#
# from < to spreads the fingers (zoom in); from > to brings them together.
D=/dev/input/event2
CX=${1:-600}
CY=${2:-1300}
FROM=${3:-120}
TO=${4:-520}
STEPS=${5:-24}
NAP=${6:-16}

syn() { sendevent $D 0 0 0; }
put() { # slot x y
  sendevent $D 3 47 $1
  sendevent $D 3 53 $2
  sendevent $D 3 54 $3
}

# both fingers down, on the same horizontal line either side of the centre
sendevent $D 3 47 0
sendevent $D 3 57 620
sendevent $D 3 53 $((CX - FROM))
sendevent $D 3 54 $CY
sendevent $D 3 48 8
sendevent $D 1 330 1
sendevent $D 3 47 1
sendevent $D 3 57 621
sendevent $D 3 53 $((CX + FROM))
sendevent $D 3 54 $CY
sendevent $D 3 48 8
syn

I=1
while [ $I -le $STEPS ]; do
  G=$((FROM + (TO - FROM) * I / STEPS))
  put 0 $((CX - G)) $CY
  put 1 $((CX + G)) $CY
  syn
  # a nap between steps, so the gesture reads as a hand and not a jump
  sleep 0.0$NAP
  I=$((I + 1))
done

# both fingers up
sendevent $D 3 47 0
sendevent $D 3 57 -1
sendevent $D 3 47 1
sendevent $D 3 57 -1
sendevent $D 1 330 0
syn
