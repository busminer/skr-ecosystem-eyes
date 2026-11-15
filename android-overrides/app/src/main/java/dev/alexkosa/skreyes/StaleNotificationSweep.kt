package dev.alexkosa.skreyes

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import expo.modules.notifications.service.NotificationsService
import expo.modules.notifications.service.delegates.SharedPreferencesNotificationsStore

// Old notifications must die with the update, not with the next launch.
//
// 1.x scheduled weekly "daily look" lines about the vault and stakers
// (channel skr-nudges) and unlock alerts (skr-unlocks); the 2.0 candidates
// carried Blink reminders (eye-blink). Since 1.5.0 the app sweeps all of them
// away on every launch (src/notifications.ts) — but only on a launch. The
// notifications library keeps every scheduled request in its own preferences
// and arms them all again by itself after an update and after a reboot. So a
// phone that took the update from the store and was never opened kept getting
// the old lines, and people said so (Alex, 15.11.2026).
//
// This runs on the same two broadcasts, without the app being opened, and
// removes every stored request that is not a position check-in (data
// { checkin: true }, the only notification the app sends now). The library
// looks a request up when its alarm fires and quietly drops the alarm when
// the record is gone, so the order in which the two receivers run does not
// matter. The old channels go too, and anything of theirs still in the shade.
class StaleNotificationSweep : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    if (action != Intent.ACTION_MY_PACKAGE_REPLACED && action != Intent.ACTION_BOOT_COMPLETED) return
    val pending = goAsync()
    Thread {
      try {
        sweep(context.applicationContext)
      } catch (error: Throwable) {
        Log.w(TAG, "sweep failed: ${error.message}")
      } finally {
        pending.finish()
      }
    }.start()
  }

  companion object {
    private const val TAG = "SkrEyesSweep"
    private val OLD_CHANNELS = listOf("skr-unlocks", "skr-nudges", "eye-blink")

    fun sweep(context: Context) {
      val stored = SharedPreferencesNotificationsStore(context).allNotificationRequests
      val stale = stored
        .filter { request -> request.content?.body?.optBoolean("checkin", false) != true }
        .map { it.identifier }
      if (stale.isNotEmpty()) NotificationsService.removeScheduledNotifications(context, stale)
      // One line each time, so a phone on the bench can show the sweep ran.
      Log.i(TAG, "sweep: ${stored.size} scheduled, ${stale.size} stale removed")
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.activeNotifications
          .filter { it.notification.channelId in OLD_CHANNELS }
          .forEach { manager.cancel(it.tag, it.id) }
        OLD_CHANNELS.forEach { manager.deleteNotificationChannel(it) }
      }
    }
  }
}
