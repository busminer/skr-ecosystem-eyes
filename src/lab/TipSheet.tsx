import { useCallback, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Buffer } from 'buffer';
import { ComputeBudgetProgram, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { base64ToUint8Array } from '@solana-mobile/mobile-wallet-adapter-protocol/encoding';
import { t } from '../i18n';
import { playCue } from '../sound';
import { colors, font, gold, radius, spacing, type } from '../theme';
import { Button, Eyebrow, Panel } from './kit';
import { fetchBlockhash, fetchStatus, fetchWalletBalance } from './stake/gateway';
import { MINT, TOKEN_DECIMALS, deriveTokenAccount, fromRaw, toRaw, tooPrecise } from './stake/stakeTx';

// A tip in SKR, sent straight from the person's wallet to kosa.skr.
//
// It is a plain token transfer, not a stake: the wallet signs it, the wallet
// broadcasts it, and nothing of it passes through our server except the
// blockhash before and the signature status after — the same two doors the
// stake uses. Everything that arrives is staked right away; the line on the
// sheet says so, and a tip changes nothing about anyone's position.

const RECIPIENT = new PublicKey('BmJaEmaEURBDpj91GUTvJcpKy2MAu8ZtRFRPaMpEuuax');
const RECIPIENT_NAME = 'kosa.skr';
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM = new PublicKey('11111111111111111111111111111111');
const APP_IDENTITY = { name: 'SKR Eyes', uri: 'https://skr.alexkosa.dev', icon: 'favicon.ico' };
const PRESETS = ['8', '16', '64'];

// The recipient's token account is created if it does not exist yet, and left
// alone if it does: the idempotent form of the instruction, one byte of data.
function createAtaIdempotent(payer: PublicKey, owner: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM,
    data: Buffer.from([1]),
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: deriveTokenAccount(owner), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: MINT, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
  });
}

// TransferChecked: the amount and the decimals both travel with it, so a
// wrong mint or a wrong scale is refused by the token program itself.
function transferChecked(user: PublicKey, amountRaw: bigint): TransactionInstruction {
  const data = Buffer.alloc(10);
  data[0] = 12;
  new DataView(data.buffer, data.byteOffset, data.byteLength).setBigUint64(1, amountRaw, true);
  data[9] = TOKEN_DECIMALS;
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    data,
    keys: [
      { pubkey: deriveTokenAccount(user), isSigner: false, isWritable: true },
      { pubkey: MINT, isSigner: false, isWritable: false },
      { pubkey: deriveTokenAccount(RECIPIENT), isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: false },
    ],
  });
}

export function buildTipTransaction(user: PublicKey, amountRaw: bigint, blockhash: string): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: user,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
      createAtaIdempotent(user, RECIPIENT),
      transferChecked(user, amountRaw),
    ],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

type Phase = 'idle' | 'signing' | 'confirming' | 'done' | 'error';

export function TipSheet({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState('16');
  const [phase, setPhase] = useState<Phase>('idle');
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const raw = useMemo(() => toRaw(amount), [amount]);
  const overPrecise = tooPrecise(amount);
  const ready = raw > 0n && !overPrecise && phase === 'idle';

  const send = useCallback(async () => {
    setPhase('signing');
    setError(null);
    try {
      const { blockhash, slot } = await fetchBlockhash();
      const sent = await transact(async (adapter) => {
        const authorization = await adapter.authorize({ chain: 'solana:mainnet', identity: APP_IDENTITY });
        const account = authorization.accounts[0];
        if (!account) throw new Error(t('The wallet did not return an account.'));
        const user = new PublicKey(base64ToUint8Array(account.address));
        // The balance is read for the message only; the chain is the judge.
        void fetchWalletBalance(user.toBase58()).then((balance) => setHeld((balance.balance).toFixed(2))).catch(() => undefined);
        const transaction = buildTipTransaction(user, raw, blockhash);
        const signatures = await adapter.signAndSendTransactions({ transactions: [transaction], minContextSlot: slot }) as string[];
        return signatures[0];
      });
      if (typeof sent !== 'string' || !sent) throw new Error(t('The wallet returned no signature.'));
      setSignature(sent);
      setPhase('confirming');
      // Ask the chain a few times, then stop: the signature is on the sheet
      // either way, and Solscan can answer the rest.
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        const status = await fetchStatus(sent).catch(() => null);
        if (status?.err) throw new Error(t('The chain rejected the transfer.'));
        if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') break;
      }
      setPhase('done');
      playCue('coin', 0.5);
    } catch (caught) {
      setPhase('error');
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(/cancel|declin|reject/i.test(message) ? t('The wallet declined. Nothing was sent.') : message);
    }
  }, [raw]);

  return (
    <Animated.View entering={FadeIn.duration(180)} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <View>
            <Eyebrow tone={colors.metal}>{t('Support SKR Eyes')}</Eyebrow>
            <Text style={styles.title}>{t('A tip in SKR')}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={onClose} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable>
        </View>

        <Panel style={styles.panel}>
          <Text style={styles.lead}>{t('This app is free, open source, and built by one Seeker. If it saved you a moment, a tip is welcome. Every SKR that arrives is staked right away, all of it.')}</Text>
          <Text style={styles.note}>{t('A tip changes nothing about your position and nothing about any airdrop. It is a thank you, not a fee.')}</Text>
        </Panel>

        {phase === 'done' && signature ? (
          <Panel style={styles.panel} tone={colors.positive}>
            <Eyebrow tone={colors.positive}>{t('Thank you')}</Eyebrow>
            <Text style={styles.doneTitle}>{t('{amount} SKR on its way to {name}', { amount: fromRaw(raw), name: RECIPIENT_NAME })}</Text>
            <Text style={styles.mono}>{`signature  ${signature.slice(0, 8)}…${signature.slice(-8)}\ncommitment confirmed by the wallet, checked by the app`}</Text>
            <Button ghost label={t('Open on Solscan')} onPress={() => void Linking.openURL(`https://solscan.io/tx/${signature}`)} />
            <Button label={t('Done')} onPress={onClose} tone={colors.metal} />
          </Panel>
        ) : (
          <>
            <Panel style={styles.panel}>
              <Eyebrow>{t('How much')}</Eyebrow>
              <View style={styles.presets}>
                {PRESETS.map((option) => {
                  const on = option === amount;
                  return (
                    <Pressable key={option} onPress={() => { void Haptics.selectionAsync(); setAmount(option); }} style={[styles.preset, on && styles.presetOn]}>
                      <Text style={[styles.presetLabel, on && styles.presetLabelOn]}>{option} SKR</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.amountRow}>
                <TextInput
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={colors.faint}
                  value={amount}
                  onChangeText={setAmount}
                  style={styles.amountInput}
                />
                <Text style={styles.amountUnit}>SKR</Text>
              </View>
              <Text style={[styles.note, overPrecise && styles.warn]}>
                {overPrecise ? t('SKR has six decimal places. Shorten the amount.') : held ? t('You hold {held} SKR.', { held }) : t('Goes to {name}, the wallet behind this app.', { name: RECIPIENT_NAME })}
              </Text>
            </Panel>

            <Button
              label={phase === 'signing' ? t('Approve in your wallet') : phase === 'confirming' ? t('Landing on chain…') : raw > 0n ? t('Send {amount} SKR to {name}', { amount: fromRaw(raw), name: RECIPIENT_NAME }) : t('Send a tip')}
              onPress={() => void send()}
              disabled={!ready}
              tone={colors.metal}
            />
            {phase === 'error' && error ? <Pressable onPress={() => setPhase('idle')}><Text style={styles.error}>{error}</Text></Pressable> : null}
            {phase === 'error' && signature ? <Text style={styles.mono}>{`signature  ${signature.slice(0, 8)}…${signature.slice(-8)}`}</Text> : null}
          </>
        )}

        <Text style={styles.foot}>{t('Your wallet signs and sends it. The app only fetches a blockhash before and reads the status after.')}</Text>
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.bg, zIndex: 30 },
  content: { padding: spacing.lg, paddingBottom: 140, gap: spacing.lg },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { color: colors.text, fontFamily: font.bold, fontSize: 22, marginTop: spacing.xs },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: colors.lineStrong },
  closeText: { color: colors.text, fontSize: 20, lineHeight: 22 },
  panel: { padding: spacing.md, gap: spacing.sm },
  lead: { color: colors.text, fontFamily: font.regular, ...type.body },
  note: { color: colors.muted, fontFamily: font.regular, ...type.small },
  warn: { color: colors.pending },
  presets: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  preset: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: radius.inner, paddingVertical: 10, alignItems: 'center' },
  presetOn: { borderColor: colors.metal, backgroundColor: colors.panelHi },
  presetLabel: { color: colors.muted, fontFamily: font.semibold, fontSize: 13 },
  presetLabelOn: { color: colors.metal },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  amountInput: { flex: 1, minHeight: 50, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.inner, paddingHorizontal: spacing.lg, color: colors.text, backgroundColor: colors.bg, fontFamily: font.mono, fontSize: 18 },
  amountUnit: { color: colors.muted, fontFamily: font.semibold, fontSize: 14 },
  doneTitle: { color: colors.text, fontFamily: font.bold, fontSize: 18 },
  mono: { color: colors.muted, fontFamily: font.mono, ...type.micro },
  error: { color: colors.negative, fontFamily: font.medium, ...type.small },
  foot: { color: colors.faint, fontFamily: font.regular, ...type.micro },
});
