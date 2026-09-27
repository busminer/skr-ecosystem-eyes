package dev.alexkosa.skreyes.share

import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

// Sharing a picture and its caption in one go.
//
// expo-sharing hands Android an ACTION_SEND carrying only the image, so the
// caption has to be pasted by hand on the other side. Android itself has no
// such limit: one ACTION_SEND can carry EXTRA_STREAM and EXTRA_TEXT together,
// and the apps people actually post to read both — Telegram turns the text into
// the photo's caption, X drops it into the composer beside the image.
//
// This exists because that one intent is the whole difference between "share
// your card" and "share your card, then remember to paste something".
class SkrShareModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SkrShare")

    AsyncFunction("shareImageWithText") { fileUri: String, text: String, dialogTitle: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()

      val file = File(Uri.parse(fileUri).path ?: throw IllegalArgumentException("The card file has no path."))
      if (!file.exists()) throw IllegalArgumentException("The card file is no longer there.")

      // Reuses the provider expo-file-system already declares, so this module
      // needs no manifest entry of its own and no second copy of the file.
      val content = FileProvider.getUriForFile(
        context,
        "${context.packageName}.FileSystemFileProvider",
        file,
      )

      val send = Intent(Intent.ACTION_SEND).apply {
        type = "image/png"
        putExtra(Intent.EXTRA_STREAM, content)
        putExtra(Intent.EXTRA_TEXT, text)
        // Some targets read the subject instead of the text, and an app that
        // reads neither is no worse off for it.
        putExtra(Intent.EXTRA_SUBJECT, text.lineSequence().firstOrNull() ?: text)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        clipData = android.content.ClipData.newUri(context.contentResolver, "card", content)
      }

      val chooser = Intent.createChooser(send, dialogTitle).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }

      // Launched from the activity when there is one: a chooser started from
      // the application context lands in its own task and can come back behind
      // the app instead of in front of it.
      val activity = appContext.currentActivity
      if (activity != null) activity.startActivity(chooser) else context.startActivity(chooser)
    }
  }
}
