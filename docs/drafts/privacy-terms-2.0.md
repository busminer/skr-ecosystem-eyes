# Privacy and Terms for SKR Eyes 2.0 — draft

Draft of 28.09.2026, written after the security audit (Р-2): the live pages at
skr-eyes.alexkosa.dev/privacy and /terms (23.08.2026) say the app builds no
transactions, never asks the wallet to sign and keeps nothing on the server.
In 2.0 the app mints the Eye, blinks it, binds the phone with a wallet
signature and the server keeps a ledger. Not published: Alex says yes first.
Lines marked [check] need a fact confirmed before publishing.

---

## Privacy Policy

SKR Eyes has no accounts, no sign-up and no advertising. This page explains
exactly what the app keeps on your phone, what our server keeps, what is
written to the Solana blockchain for good, and how to erase what can be erased.

Last updated [date of publishing]

### Who is responsible

SKR Eyes is an independent product built and operated by Alex Kosa. Questions
about this policy or about your data go to [email].

### What SKR Eyes never collects

- No name, email, phone number or any other identity information.
- No account: there is nothing to register and nothing to log in to.
- No seed phrase and no private key. The app cannot read them; they stay in
  Seed Vault on your phone.
- No fingerprint. The fingerprint sensor only tells Android that your finger
  was there; the app and our server never receive a fingerprint or any image
  of it.
- No advertising identifiers, no tracking pixels, no third-party SDKs that
  profile you. No contacts, photos, location or files.

### What is stored on your phone

- The public address of the wallet you connected, the name the wallet reported
  for it, and the authorization token your wallet issued, so the app can
  reconnect quietly.
- Your alert settings and the Blink reminders scheduled with Android.
- If you verify your Seeker for an Eye: a signing key created inside the
  phone's StrongBox secure element. It cannot leave the chip and only signs
  after your fingerprint.

### What our server keeps

When you use the Eye, our server at skr.alexkosa.dev keeps:

- Your wallet's public address and your Eye: its number, its asset address,
  its streak, its Blinks and the transactions that paid for them.
- For the fingerprint check: the public half of the StrongBox key and the
  certificate chain Google's hardware attestation produced for it. That chain
  describes the device (brand and model, Android version and security patch
  level, whether the boot is verified and the bootloader locked) and this app;
  it contains no fingerprint and no personal name.
- The Eyes you looked at ("gazes") and the app version that asked.
- Operational logs, which include wallet addresses, for up to [check: retention
  of the journal of skr-eye-mint] days. [check: does the main server now write
  a hashed install number (x-skr-install)? The app 2.0 does not send it.]

To show your staking position the app sends the public wallet address you
chose; the server reads public Solana data for it and answers.

### What is on the blockchain for good

Your Eye is an NFT (a Metaplex Core asset) in your wallet on Solana. Its
number, streak, Blinks and picture address are public on the blockchain and
cannot be erased by us or by anyone. The picture shows your Eye's number,
streak and, if shown, your stake size and rank. Every payment is a public
Solana transaction.

### How to delete what can be deleted

- On the phone: in Me, tap Disconnect. Uninstalling removes everything else.
- On the server: write to [email] from any channel and include a message
  signed by the wallet (or sign it in the app when that button exists); we
  delete the fingerprint binding and the gazes for that wallet. The ledger of
  Eyes and payments mirrors the public blockchain and is kept, because the
  blockchain keeps it anyway.

### Server logs and Cloudflare

Our server and the Cloudflare network in front of it process the IP address of
each request to deliver the answer and to limit abuse. We do not sell it and do
not build profiles from it.

### Third parties

- Cloudflare delivers this site and the app's API.
- A Solana RPC provider is used by our server to read the blockchain and send
  transactions. The app never contacts it directly.
- Google's hardware attestation roots are used to check the StrongBox key.
- Your wallet application (Seed Vault Wallet) shows and signs every
  transaction under its own privacy policy.

### Children

SKR Eyes is not directed at children and is not intended for anyone under 13.

### Changes

If this policy changes, the date at the top changes with it.

### Not affiliated

SKR Eyes is an independent product. It is not affiliated with, endorsed by or
sponsored by Solana Foundation or Solana Mobile.

---

## Terms of Use

Short version: the app reads a public blockchain and lets you mint and keep one
Eye, a collectible NFT. It never holds your keys or your money. The Eye is not
an investment and no token is promised.

Last updated [date of publishing]

### What SKR Eyes is

SKR Eyes is an independent application for SKR stakers on Solana Mobile
Seeker. It shows staking data read from the blockchain, and it lets the holder
of a Seeker mint one Eye per wallet and blink it once every 8 hours.

### The Eye

- The Eye is a collectible NFT (Metaplex Core) minted to your wallet. It is
  frozen: it cannot be sold or transferred while it is frozen. Only the
  collection owner's wallet can thaw it.
- Minting and each Blink are paid in SOL from your wallet to the maker of SKR
  Eyes. Minting also puts a storage deposit into the Eye's own account on
  Solana, where it stays, and pays Metaplex's create fee (0.0015 SOL today,
  held in the same account and collectable by Metaplex); every transaction
  pays a network fee set by your wallet. The amounts are shown before your wallet
  asks you to approve. Payments are final and are not refunded.
- The streak counts days in a row with at least one Blink (UTC days). A missed
  day starts it over. We may restore a day lost because of a failure on our
  side.
- The Eye gives no rights, income or share of anything. No token, airdrop or
  reward is promised for holding an Eye or for a streak.

### No custody

SKR Eyes never holds or moves your funds. Every transaction is shown by your
wallet and signed by you. The app checks every transaction before asking you
to sign it: you pay the fee yourself, SOL goes only to the maker's address
shown in the app, and no other token is touched.

### Not financial advice

Nothing in the app or on this site is investment, financial, legal or tax
advice. The Eye is not an investment.

### Availability

The service is provided as is, without warranty. It may be unavailable,
interrupted or discontinued; an Eye already minted stays in your wallet on
Solana either way. To the maximum extent permitted by law, we are not liable
for any loss arising from use of the app, including a broken streak, failed
or delayed transactions, or decisions taken on the basis of displayed data.

### Acceptable use

Do not use the app to break the law, to attack the service, to automate the
fingerprint check or the Blink, or to misrepresent it as an official product
of anyone else. We may refuse service to wallets or devices used to abuse it.

### Source and licence

[check: is the 2.0 source published? The live text points at
github.com/busminer/skr-ecosystem-eyes under MIT.]

### Not affiliated

SKR Eyes is an independent product. It is not affiliated with, endorsed by or
sponsored by Solana Foundation or Solana Mobile. Product names and trademarks
belong to their respective owners.

### Contact

[email]
