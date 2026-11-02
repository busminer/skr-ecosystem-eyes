# android/ changes made on 28.09.2026 (android/ itself is not in git)

The Android project is hand-edited and never prebuilt, and `android/` is ignored
by git. These are the files changed on 28.09 in the worktree build, to be copied
over a fresh copy of `C:\skrx\android` (same relative paths):

- `app/src/main/java/dev/alexkosa/skreyes/LabFontScale.kt` (new): the lab app's own
  font scale for checking screens at a large font on the Seeker, lab package only:
  `adb shell am start -S -n dev.alexkosa.skreyes.lab/dev.alexkosa.skreyes.MainActivity --ef skr_font_scale 1.3`
  (the app saves it and exits), then start it again. `--ef skr_font_scale 0` resets.
- `MainActivity.kt`, `MainApplication.kt`: wire the above (application context only;
  wrapping the activity context loses the AppCompat theme and crashes).
- `app/src/main/AndroidManifest.xml`: `USE_EXACT_ALARM` (exact Blink reminders on
  Android 13+), `SCHEDULE_EXACT_ALARM` limited to API 32.
- `app/build.gradle`: versionName 2.0.0 (versionCode 9; the store has 1.3.0/8).

## 28.09.2026, evening: no plain HTTP in the release (audit R-14)

- `app/src/main/AndroidManifest.xml`: the `android:networkSecurityConfig` attribute
  is gone. It pointed at `res/xml/network_security_config.xml`, which let the app
  talk plain HTTP to `127.0.0.1` and `localhost` for the lab's old `adb reverse`
  route; nothing uses that any more. The xml file itself is now unused: delete
  `app/src/main/res/xml/network_security_config.xml` from the copy of `android/`
  as well (done in this worktree). Debug builds keep plain HTTP for Metro through
  `src/debug/AndroidManifest.xml`, as before. The config plugin that wrote both,
  `plugins/withLoopbackCleartext.js`, is removed from `app.json` and the repo.

## 02.11.2026: 1.5.0

- `app/build.gradle`: versionName 1.5.0, versionCode 12 (the store has 1.3.0/8; rc9 of 2.0 was 11).
  The Eye's 2.0 continues from here with a higher code.
