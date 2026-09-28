package dev.alexkosa.skreyes.witness

import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

// Seeker Witness: a hardware key in this phone that signs only under a living
// finger, with Google's attestation chain to prove both facts.
//
// Five calls. `createKey` is born with the attestor's challenge and hands back
// the chain for the attestor to read; `sign` shows the system fingerprint
// prompt and returns one DER signature; `hasKey`, `publicKey` and `deleteKey`
// are what they say. Every failure carries a stable code from the list below, so the screen
// can tell a cancelled prompt from a locked sensor without reading messages.
class SeekerWitnessModule : Module() {
  object Codes {
    const val UNSUPPORTED = "E_WITNESS_UNSUPPORTED"
    const val NO_BIOMETRICS = "E_WITNESS_NO_BIOMETRICS"
    const val NO_ACTIVITY = "E_WITNESS_NO_ACTIVITY"
    const val BAD_CHALLENGE = "E_WITNESS_BAD_CHALLENGE"
    const val KEYGEN = "E_WITNESS_KEYGEN"
    const val NO_KEY = "E_WITNESS_NO_KEY"
    const val KEY_INVALIDATED = "E_WITNESS_KEY_INVALIDATED"
    const val CANCELLED = "E_WITNESS_CANCELLED"
    const val LOCKOUT = "E_WITNESS_LOCKOUT"
    const val FAILED = "E_WITNESS_FAILED"
  }

  class WitnessException(code: String, message: String, cause: Throwable? = null) : CodedException(code, message, cause)

  // The words on the fingerprint prompt, passed in from JS already translated.
  class PromptTexts : Record {
    @Field val title: String = "Sign with your finger"
    @Field val subtitle: String? = null
    @Field val description: String? = null
    @Field val cancel: String = "Cancel"
  }

  private fun supported() {
    // setDevicePropertiesAttestationIncluded is Android 12; the Seeker ships 16.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      throw WitnessException(Codes.UNSUPPORTED, "Android 12 or newer is required for a device-attested key")
    }
  }

  private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

  // The prompt's own error codes, folded into ours. A cancel is a cancel
  // whichever of the three ways it arrived; a lockout is worth its own word
  // because the person has to wait, not retry.
  private fun promptCode(code: Int) = when (code) {
    BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED,
    BiometricPrompt.BIOMETRIC_ERROR_CANCELED,
    FingerPrompt.ERROR_NEGATIVE_BUTTON -> Codes.CANCELLED
    BiometricPrompt.BIOMETRIC_ERROR_LOCKOUT,
    BiometricPrompt.BIOMETRIC_ERROR_LOCKOUT_PERMANENT -> Codes.LOCKOUT
    BiometricPrompt.BIOMETRIC_ERROR_NO_BIOMETRICS,
    BiometricPrompt.BIOMETRIC_ERROR_HW_NOT_PRESENT,
    BiometricPrompt.BIOMETRIC_ERROR_HW_UNAVAILABLE -> Codes.NO_BIOMETRICS
    else -> Codes.FAILED
  }

  override fun definition() = ModuleDefinition {
    Name("SeekerWitness")

    // Read lazily, on first access from JS, so the react context exists by
    // then. PACKAGE is the application id this build actually runs under
    // (`dev.alexkosa.skreyes`, or `.lab` for a sideloaded test build), which
    // is what decides which attestor the JS side talks to.
    Constants {
      mapOf(
        "ERR_UNSUPPORTED" to Codes.UNSUPPORTED,
        "ERR_NO_BIOMETRICS" to Codes.NO_BIOMETRICS,
        "ERR_NO_ACTIVITY" to Codes.NO_ACTIVITY,
        "ERR_BAD_CHALLENGE" to Codes.BAD_CHALLENGE,
        "ERR_KEYGEN" to Codes.KEYGEN,
        "ERR_NO_KEY" to Codes.NO_KEY,
        "ERR_KEY_INVALIDATED" to Codes.KEY_INVALIDATED,
        "ERR_CANCELLED" to Codes.CANCELLED,
        "ERR_LOCKOUT" to Codes.LOCKOUT,
        "ERR_FAILED" to Codes.FAILED,
        "KEY_ALIAS" to WitnessKey.ALIAS,
        "PACKAGE" to (appContext.reactContext?.packageName ?: ""),
      )
    }

    AsyncFunction("hasKey") {
      supported()
      WitnessKey.exists()
    }

    // The compressed public key of the key in this phone right now, hex, or
    // null when there is none. The phone holds one key under one alias while
    // the JS side keeps one enrollment per wallet, so a second wallet enrolled
    // here replaces the first one's key. The JS side compares this with the
    // record it is about to use and enrolls again when they differ, instead
    // of signing for a key the server no longer has for that wallet.
    AsyncFunction("publicKey") {
      supported()
      if (WitnessKey.exists()) hex(WitnessKey.compressedPublicKey()) else null
    }

    // Born with the attestor's challenge (base64 of its raw bytes). Refuses up
    // front when the phone has no usable Class 3 biometric: a key that is not
    // finger-bound would only come back from the attestor as a red verdict.
    AsyncFunction("createKey") { challengeBase64: String ->
      supported()
      val challenge = try {
        Base64.decode(challengeBase64, Base64.DEFAULT)
      } catch (e: IllegalArgumentException) {
        throw WitnessException(Codes.BAD_CHALLENGE, "the challenge is not base64", e)
      }
      if (challenge.size < 16) throw WitnessException(Codes.BAD_CHALLENGE, "the challenge is too short to be a nonce")

      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      when (val status = FingerPrompt.status(context)) {
        BiometricManager.BIOMETRIC_SUCCESS -> Unit
        else -> throw WitnessException(Codes.NO_BIOMETRICS, "no Class 3 biometric is usable on this phone (BiometricManager $status)")
      }

      val born = try {
        WitnessKey.generate(challenge)
      } catch (e: Exception) {
        throw WitnessException(Codes.KEYGEN, e.message ?: "key generation failed", e)
      }
      mapOf(
        "p256Compressed" to hex(WitnessKey.compressedPublicKey()),
        "chainPem" to WitnessKey.chainPem(),
        "strongBox" to born.strongBox,
        "fingerBound" to WitnessKey.isFingerBound(),
      )
    }

    // One DER ECDSA-SHA256 signature over the message (base64 of its raw
    // bytes), after the system fingerprint prompt. Rejects with CANCELLED when
    // the person backs out, LOCKOUT when the sensor is locked, KEY_INVALIDATED
    // when a new fingerprint was enrolled since the key was born (the dead key
    // is removed so the caller can enroll again).
    AsyncFunction("sign") { messageBase64: String, texts: PromptTexts, promise: Promise ->
      try {
        supported()
      } catch (e: CodedException) {
        promise.reject(e); return@AsyncFunction
      }
      val message = try {
        Base64.decode(messageBase64, Base64.DEFAULT)
      } catch (e: IllegalArgumentException) {
        promise.reject(WitnessException(Codes.FAILED, "the message is not base64", e)); return@AsyncFunction
      }
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject(WitnessException(Codes.NO_ACTIVITY, "no foreground activity to show the prompt on")); return@AsyncFunction
      }
      if (!WitnessKey.exists()) {
        promise.reject(WitnessException(Codes.NO_KEY, "no witness key in this phone")); return@AsyncFunction
      }
      val signature = try {
        WitnessKey.beginSign()
      } catch (e: KeyPermanentlyInvalidatedException) {
        runCatching { WitnessKey.delete() }
        promise.reject(WitnessException(Codes.KEY_INVALIDATED, "a new fingerprint was enrolled on this phone, so the key is gone for good", e))
        return@AsyncFunction
      } catch (e: Exception) {
        promise.reject(WitnessException(Codes.FAILED, e.message ?: "the key could not be opened", e)); return@AsyncFunction
      }

      val words = FingerPrompt.Texts(texts.title, texts.subtitle, texts.description, texts.cancel)
      activity.runOnUiThread {
        try {
          FingerPrompt.authorize(
            activity, signature, words,
            onAuthorized = { armed ->
              try {
                armed.update(message)
                val der = armed.sign()
                promise.resolve(mapOf("derSignatureBase64" to Base64.encodeToString(der, Base64.NO_WRAP)))
              } catch (e: Exception) {
                promise.reject(WitnessException(Codes.FAILED, e.message ?: "the hardware did not sign", e))
              }
            },
            onError = { code, text ->
              promise.reject(WitnessException(promptCode(code), "finger: $text ($code)"))
            },
          )
        } catch (e: Exception) {
          promise.reject(WitnessException(Codes.FAILED, e.message ?: "the prompt could not be shown", e))
        }
      }
    }

    AsyncFunction("deleteKey") {
      supported()
      WitnessKey.delete()
    }
  }
}
