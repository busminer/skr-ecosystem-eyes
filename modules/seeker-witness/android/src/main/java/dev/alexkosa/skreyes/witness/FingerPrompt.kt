package dev.alexkosa.skreyes.witness

import android.app.Activity
import android.content.Context
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal
import androidx.annotation.RequiresApi
import java.security.Signature

// The finger. Not a screen the app draws and not a check the app makes: the
// private key physically cannot produce a signature until the phone's secure
// hardware has seen a Class 3 biometric. The prompt hands StrongBox an
// authorised Signature and gets it back armed for exactly one use.
//
// Framework BiometricPrompt on purpose (see build.gradle). Every string the
// person sees arrives from JS already translated.
@RequiresApi(Build.VERSION_CODES.R)
object FingerPrompt {
  class Texts(val title: String, val subtitle: String?, val description: String?, val cancel: String)

  // The framework delivers a press on the negative button to that button's
  // listener and to nothing else: no onAuthenticationError follows. AndroidX
  // gives that press the code 13 and so do we, so the module sees one cancel
  // code for a back press and a "Cancel" tap alike.
  const val ERROR_NEGATIVE_BUTTON = 13

  // BiometricManager's own answer for a Class 3 biometric: BIOMETRIC_SUCCESS
  // when one is enrolled and usable right now, otherwise one of its
  // BIOMETRIC_ERROR_* codes.
  fun status(ctx: Context): Int {
    val bm = ctx.getSystemService(BiometricManager::class.java) ?: return BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE
    return bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
  }

  // Shows the system prompt. Exactly one of the two callbacks runs, on the
  // main thread. Must itself be called on the main thread.
  fun authorize(
    activity: Activity,
    signature: Signature,
    texts: Texts,
    onAuthorized: (Signature) -> Unit,
    onError: (code: Int, message: CharSequence) -> Unit,
  ) {
    val cancel = CancellationSignal()
    var settled = false
    val builder = BiometricPrompt.Builder(activity)
      .setTitle(texts.title)
      .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
      .setConfirmationRequired(false)
      // A biometric-only prompt must offer a way out, and the way out reports
      // itself only here (see ERROR_NEGATIVE_BUTTON), so this is where the
      // cancel is raised.
      .setNegativeButton(texts.cancel, activity.mainExecutor) { _, _ ->
        if (!settled) {
          settled = true
          cancel.cancel()
          onError(ERROR_NEGATIVE_BUTTON, "negative button")
        }
      }
    texts.subtitle?.takeIf { it.isNotBlank() }?.let { builder.setSubtitle(it) }
    texts.description?.takeIf { it.isNotBlank() }?.let { builder.setDescription(it) }

    builder.build().authenticate(
      BiometricPrompt.CryptoObject(signature), cancel, activity.mainExecutor,
      object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
          if (settled) return
          settled = true
          val armed = result.cryptoObject?.signature
          if (armed != null) onAuthorized(armed)
          else onError(BiometricPrompt.BIOMETRIC_ERROR_UNABLE_TO_PROCESS, "the prompt returned no signature")
        }

        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
          if (settled) return
          settled = true
          onError(errorCode, errString)
        }
        // onAuthenticationFailed is one bad touch, not the end: the prompt stays up.
      },
    )
  }
}
