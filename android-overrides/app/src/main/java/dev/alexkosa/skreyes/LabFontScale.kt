package dev.alexkosa.skreyes

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.res.Configuration

// A font scale of the lab app's own (28.09.2026). Alex reads his phone at a
// large system font; every screen has to be checked that way on the real
// Seeker, and the phone's own settings stay as they are. The scale lives in
// the lab app's private preferences and is written into the application's
// and the activity's resources before anything is laid out (no wrapped
// contexts: those lose the AppCompat theme and the app does not start).
// Only the lab package (dev.alexkosa.skreyes.lab) looks at it.
//   adb shell am start -S -n dev.alexkosa.skreyes.lab/dev.alexkosa.skreyes.MainActivity --ef skr_font_scale 1.3
// and --ef skr_font_scale 0 to go back to the phone's own.
object LabFontScale {
  private const val PREFS = "skr_lab"
  private const val KEY = "font_scale"
  const val EXTRA = "skr_font_scale"

  private val isLab = BuildConfig.APPLICATION_ID.endsWith(".lab")

  fun wrap(base: Context): Context {
    if (!isLab) return base
    val scale = base.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getFloat(KEY, 0f)
    if (scale <= 0f) return base
    val config = Configuration(base.resources.configuration)
    config.fontScale = scale
    return base.createConfigurationContext(config)
  }

  // True when the intent changed the stored scale; the app then starts again
  // in a new process so everything reads the new scale from the start.
  fun takeFromIntent(activity: Activity, intent: Intent?): Boolean {
    if (!isLab || intent == null || !intent.hasExtra(EXTRA)) return false
    val scale = intent.getFloatExtra(EXTRA, 0f)
    intent.removeExtra(EXTRA)
    val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (prefs.getFloat(KEY, 0f) == scale) return false
    prefs.edit().putFloat(KEY, scale).commit()
    return true
  }

  fun restart(activity: Activity) {
    activity.finishAndRemoveTask()
    Runtime.getRuntime().exit(0)
  }
}
