package dev.alexkosa.skreyes.witness

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import androidx.annotation.RequiresApi
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.cert.X509Certificate
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

// The Eye's finger: a P-256 key that only ever exists inside this phone's
// StrongBox (the TEE as a fallback). It is born with the attestor's challenge,
// so Google's certificate chain proves where it lives, and it is bound to a
// Class 3 biometric, so the same chain proves it cannot sign without a living
// finger on this phone.
//
// Ported from SEEKIN's WitnessKey. Two things are hardware facts here, not
// claims the app makes:
//  - no signature exists unless a finger was presented to the secure hardware
//    for that one use (timeout 0: every signature is its own touch);
//  - enrolling a new fingerprint destroys the key for good, so an Eye cannot be
//    quietly handed over to somebody else's finger. The JS side re-enrolls.
//
// The alias is this app's own. SEEKIN keeps `seekin_node`; the two apps may
// share a phone and must never share a key.
@RequiresApi(Build.VERSION_CODES.S)
object WitnessKey {
  const val ALIAS = "skr_eyes_witness"

  // What kind of body was actually born, after the fallbacks had their say.
  data class Born(val strongBox: Boolean, val fingerBound: Boolean)

  private fun keystore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  fun exists(): Boolean = keystore().containsAlias(ALIAS)

  fun delete() {
    keystore().deleteEntry(ALIAS)
  }

  // Generates a fresh finger-bound key with the attestor's challenge baked in.
  // StrongBox with device ids first, then the TEE, then the TEE without device
  // ids (emulators cannot attest ids at all). The last two will fail the
  // attestor's Seeker check, and that is the point: the verdict says why,
  // instead of the keystore crashing here.
  fun generate(challenge: ByteArray): Born {
    val ks = keystore()
    ks.deleteEntry(ALIAS)

    fun spec(strongBox: Boolean, deviceIds: Boolean) =
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256)
        .setAttestationChallenge(challenge)
        .setDevicePropertiesAttestationIncluded(deviceIds)
        .apply { if (strongBox) setIsStrongBoxBacked(true) }
        .setUserAuthenticationRequired(true)
        // Timeout 0: every single use needs its own touch, no grace window.
        .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        // A newly enrolled fingerprint kills this key rather than inheriting it.
        .setInvalidatedByBiometricEnrollment(true)
        .build()

    val kpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
    var lastFailure: Exception? = null
    try {
      kpg.initialize(spec(strongBox = true, deviceIds = true)); kpg.generateKeyPair()
      return Born(strongBox = true, fingerBound = true)
    } catch (e: StrongBoxUnavailableException) {
      lastFailure = e
    } catch (e: Exception) {
      lastFailure = e
    }
    try {
      kpg.initialize(spec(strongBox = false, deviceIds = true)); kpg.generateKeyPair()
      return Born(strongBox = false, fingerBound = true)
    } catch (e: Exception) {
      lastFailure = e
    }
    try {
      kpg.initialize(spec(strongBox = false, deviceIds = false)); kpg.generateKeyPair()
      return Born(strongBox = false, fingerBound = true)
    } catch (e: Exception) {
      lastFailure = e
    }
    throw IllegalStateException("this device cannot generate an attestable finger-bound key", lastFailure)
  }

  // True when the key in this phone refuses to sign without a finger. Read
  // from the key itself, never from a flag the app remembers.
  fun isFingerBound(): Boolean = runCatching {
    val entry = keystore().getEntry(ALIAS, null) as KeyStore.PrivateKeyEntry
    val info = KeyFactory.getInstance(entry.privateKey.algorithm, "AndroidKeyStore")
      .getKeySpec(entry.privateKey, KeyInfo::class.java)
    info.isUserAuthenticationRequired
  }.getOrDefault(false)

  // The whole attestation chain, leaf first, as the attestor's /verify wants it.
  fun chainPem(): String {
    val chain = keystore().getCertificateChain(ALIAS) ?: throw IllegalStateException("no key")
    return chain.joinToString("") { c ->
      "-----BEGIN CERTIFICATE-----\n" +
        Base64.encodeToString(c.encoded, Base64.NO_WRAP).chunked(64).joinToString("\n") +
        "\n-----END CERTIFICATE-----\n"
    }
  }

  // 33-byte compressed public key: 0x02/0x03 then X, the form the attestor
  // echoes back as `p256` and the eye-mint server stores against the wallet.
  fun compressedPublicKey(): ByteArray {
    val pub = (keystore().getCertificate(ALIAS) as X509Certificate).publicKey as ECPublicKey
    val x = pub.w.affineX.toByteArray()
      .let { it.copyOfRange(maxOf(0, it.size - 32), it.size) }
      .let { ByteArray(32 - it.size) + it }
    val prefix = if (pub.w.affineY.testBit(0)) 3 else 2
    return byteArrayOf(prefix.toByte()) + x
  }

  // A Signature armed with the private key but not yet authorised. On a
  // finger-bound key `initSign` succeeds and the hardware then refuses to sign
  // until the prompt hands this same object back approved. Throws
  // KeyPermanentlyInvalidatedException when a new fingerprint was enrolled.
  fun beginSign(): Signature {
    val entry = keystore().getEntry(ALIAS, null) as? KeyStore.PrivateKeyEntry
      ?: throw IllegalStateException("no key")
    return Signature.getInstance("SHA256withECDSA").apply { initSign(entry.privateKey) }
  }
}
