# The store build, signed with the release key, verified, and nothing else (Alex, 01.10: sign it).
#
#   powershell -ExecutionPolicy Bypass -File scripts\build-release.ps1 -Name skr-eyes-2.0.0-rc5-release
#
# Reads the key's password from C:\Users\Alex Kosa\skr-keys\pass alias.txt INSIDE this process, hands it
# to Gradle through the four environment variables the build expects, and never prints it. The only
# things written to the console are the certificate digest and whether it is the one the store and the
# attestor pin. A build whose digest is not d90bb194... is deleted, not kept.
#
# It builds the store package (no -PskrLabId), arm64 only. It does not publish anything: the store is
# Alex's act (docs/DECISIONS.md), and the dapp-store CLI is not touched here.
param(
  [string]$Name = 'skr-eyes-2.0.0-release',
  [string]$Keys = 'C:\Users\Alex Kosa\skr-keys',
  [string]$Alias = 'skr-eyes-release'
)
$ErrorActionPreference = 'Stop'
$Pinned = 'd90bb194498ee4dce0669aa5ddcc30c6a13d43750fac4768a240ade9228e4763'
$root = Split-Path -Parent $PSScriptRoot
$android = Join-Path $root 'android'
$jks = Join-Path $Keys 'skr-eyes-release.jks'
if (-not (Test-Path -LiteralPath $jks)) { throw "no keystore at $jks" }

# The password file: take whatever is not a label and not the alias. Structure only is ever reported.
$raw = Get-Content -LiteralPath (Join-Path $Keys 'pass alias.txt') -Raw -Encoding UTF8
$tokens = @($raw -split '\s+' | Where-Object { $_ -ne '' })
$values = New-Object System.Collections.Generic.List[string]
foreach ($t in $tokens) {
  if ($t -match '^(?i:(pass|password|storepass|keypass|alias|parol|пароль|алиас))[:=]?$') { continue }
  if ($t -match '^(?i:(pass|password|storepass|keypass))[:=](.+)$') { $values.Add($Matches[2]); continue }
  if ($t -match '^(?i:alias)[:=](.+)$') { continue }
  if ($t -eq $Alias) { continue }
  $values.Add($t)
}
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot'
$keytool = Join-Path $env:JAVA_HOME 'bin\keytool.exe'
# The file holds the password and (maybe) the alias. Which is which is decided by the keystore itself:
# the right password opens it, and then the other value, if there is one, must be one of its aliases.
$secret = $null
$candidates = @($values)
if ($candidates.Count -eq 1) { $candidates += $Alias }
foreach ($pw in $candidates) {
  $env:KS_TRY = $pw
  $listing = & $keytool -list -keystore $jks -storepass:env KS_TRY 2>&1
  if ($LASTEXITCODE -eq 0) {
    $secret = $pw
    $names = @($listing | Select-String '^([^,\s]+), .*PrivateKeyEntry' | ForEach-Object { $_.Matches.Groups[1].Value })
    if ($names.Count -ge 1) { $Alias = $names[0] }
    break
  }
}
Remove-Item Env:KS_TRY -ErrorAction SilentlyContinue
if (-not $secret) { throw "none of the $($candidates.Count) values in the password file opens the keystore (structure only, nothing printed)" }
"password found: $($secret.Length) characters (not shown); alias in the keystore: $Alias"

$env:SKR_EYES_KEYSTORE_PATH = $jks
$env:SKR_EYES_KEY_ALIAS = $Alias
$env:SKR_EYES_KEYSTORE_PASSWORD = $secret
$env:SKR_EYES_KEY_PASSWORD = $secret

Push-Location $android
try {
  # Gradle and Expo write harmless notices to stderr (the NODE_ENV one among them); in Windows PowerShell
  # that would turn into a terminating error under 'Stop', so the native call runs under 'Continue' and
  # only its exit code counts.
  $ErrorActionPreference = 'Continue'
  & .\gradlew.bat assembleRelease '-PreactNativeArchitectures=arm64-v8a' --console=plain 2>&1 |
    ForEach-Object { "$_" } | Where-Object { $_ -match 'BUILD (SUCCESSFUL|FAILED)|What went wrong|SKR EYES:|error:|FAILURE' }
  $code = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($code -ne 0) { throw "gradle exited with $code" }
} finally {
  Pop-Location
  Remove-Item Env:SKR_EYES_KEYSTORE_PASSWORD, Env:SKR_EYES_KEY_PASSWORD -ErrorAction SilentlyContinue
}

$apk = Join-Path $android 'app\build\outputs\apk\release\app-release.apk'
$builds = Join-Path $root 'builds'
New-Item -ItemType Directory -Force $builds | Out-Null
$out = Join-Path $builds "$Name.apk"
Copy-Item -LiteralPath $apk -Destination $out -Force

$apksigner = 'C:\Users\Alex Kosa\AppData\Local\Android\Sdk\build-tools\36.0.0\apksigner.bat'
$certs = & $apksigner verify --print-certs $out 2>&1
$digest = ($certs | Select-String 'Signer #1 certificate SHA-256 digest: (\w+)').Matches.Groups[1].Value
"signature digest: $digest"
if ($digest -ne $Pinned) {
  Remove-Item -LiteralPath $out -Force
  throw "WRONG KEY: the digest is not the pinned one ($Pinned). The build was deleted."
}
"signature OK: $Name.apk carries the pinned store digest d90bb194..."
(Get-Item $out).Length | ForEach-Object { "size: $([math]::Round($_ / 1MB, 1)) MB" }
