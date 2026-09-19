import { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn } from 'react-native-reanimated';
import QRCode from 'react-native-qrcode-svg';
import Svg, { Circle, Path } from 'react-native-svg';
import { t } from '../i18n';
import { colors, font, radius, spacing, type } from '../theme';
import { Button, Eyebrow, Panel } from './kit';
import { MINT } from './stake/stakeTx';

// A donation, in whatever coin the person actually has.
//
// The old sheet took SKR only, built the transfer itself and sent it through
// Mobile Wallet Adapter — which is exactly the door the Seeker wallet slammed
// on our domain ("Scam site detected"). This one hands the wallet a Solana Pay
// link instead: recipient, amount and token already filled in, and the wallet
// does its own building, its own signing and its own sending. No app identity,
// no domain to distrust, and it works from any wallet on the phone — or from
// a different phone entirely, over the code.
//
// Solana first, because everyone on this chain holds at least some of it.
// SKR and USDC one tap away, and "any coin" shows the bare address for
// everything else the wallet can send.

const RECIPIENT = 'BmJaEmaEURBDpj91GUTvJcpKy2MAu8ZtRFRPaMpEuuax';
const RECIPIENT_NAME = 'kosa.skr';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

type Coin = { key: string; unit: string; mint: string | null; quick: string[] };
const COINS: Coin[] = [
  { key: 'SOL', unit: 'SOL', mint: null, quick: ['0.1', '0.5', '1', '5'] },
  { key: 'SKR', unit: 'SKR', mint: MINT.toBase58(), quick: ['10', '100', '500', '1000'] },
  { key: 'USDC', unit: 'USDC', mint: USDC_MINT, quick: ['1', '5', '10', '50'] },
];

// The mark on each coin pill: drawn, not downloaded. The three bars and the
// dollar say "which coin" without copying anyone's exact logo; SKR wears the
// eye it always wears here.
function CoinMark({ coin, on }: { coin: string; on: boolean }) {
  const dim = on ? 1 : 0.55;
  if (coin === 'SOL') {
    return (
      <Svg width={24} height={24} viewBox="0 0 24 24" opacity={dim}>
        <Circle cx={12} cy={12} r={12} fill="#0E1721" />
        <Path d="M7.4 8.6h7.9l1.7-1.8H9.1Z" fill={colors.accent} />
        <Path d="M7.4 13h7.9l1.7 1.8H9.1Z" fill={colors.positive} />
        <Path d="M7.4 17.4h7.9l1.7-1.8H9.1Z" fill={colors.accent} fillOpacity={0.7} />
      </Svg>
    );
  }
  if (coin === 'SKR') {
    return (
      <Svg width={24} height={24} viewBox="0 0 100 100" opacity={dim}>
        <Circle cx={50} cy={50} r={50} fill="#131007" />
        <Path d="M16 50 C25 33 36 28 50 28 C64 28 75 33 84 50 C75 67 64 72 50 72 C36 72 25 67 16 50 Z" fill="none" stroke={colors.metal} strokeWidth={6} />
        <Circle cx={50} cy={50} r={9} fill={colors.metal} />
      </Svg>
    );
  }
  if (coin === 'USDC') {
    return (
      <Svg width={24} height={24} viewBox="0 0 24 24" opacity={dim}>
        <Circle cx={12} cy={12} r={12} fill="#0E1721" />
        <Path d="M14.8 9.3c-.2-1.2-1.1-1.9-2.6-1.9-1.6 0-2.6.8-2.6 2 0 1 .6 1.5 2 1.8l1.3.3c2.2.5 3.2 1.3 3.2 2.9 0 1.9-1.5 3.1-3.8 3.1-2.3 0-3.8-1.1-4-3h1.5c.2 1.1 1.2 1.7 2.6 1.7 1.5 0 2.4-.7 2.4-1.7 0-.9-.6-1.4-1.9-1.7l-1.5-.4c-2-.5-3-1.4-3-2.9 0-1.9 1.6-3.2 3.9-3.2 2.2 0 3.7 1.2 3.9 3z" fill="#8296A8" />
        <Path d="M12 4.6v2M12 17.4v2" stroke="#8296A8" strokeWidth={1.4} strokeLinecap="round" />
      </Svg>
    );
  }
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" opacity={dim}>
      <Circle cx={12} cy={12} r={12} fill="#0E1721" />
      <Circle cx={7} cy={12} r={1.6} fill="#8296A8" /><Circle cx={12} cy={12} r={1.6} fill="#8296A8" /><Circle cx={17} cy={12} r={1.6} fill="#8296A8" />
    </Svg>
  );
}

export function TipSheet({ onClose }: { onClose: () => void }) {
  const [coin, setCoin] = useState<Coin | null>(COINS[0]!);
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const clean = amount.trim().replace(',', '.');
  const parsed = Number(clean);
  const good = Number.isFinite(parsed) && parsed > 0;

  // The Solana Pay link: everything filled in, nothing signed by us.
  const link = useMemo(() => {
    const params: string[] = [];
    if (coin && good) params.push(`amount=${encodeURIComponent(clean)}`);
    if (coin?.mint) params.push(`spl-token=${coin.mint}`);
    params.push('label=SKR%20Eyes');
    return `solana:${RECIPIENT}?${params.join('&')}`;
  }, [coin, good, clean]);

  const pay = () => {
    void Haptics.selectionAsync();
    setStatus(null);
    Linking.openURL(link).catch(() => setStatus(t('No wallet answered. Scan the code or copy the address by hand.')));
  };

  const pick = (next: Coin | null) => {
    void Haptics.selectionAsync();
    setCoin(next);
    setAmount('');
    setStatus(null);
  };

  return (
    <Animated.View entering={FadeIn.duration(180)} style={styles.screen}>
      {/* The gold light behind the sheet: this screen is the thank-you room. */}
      <View pointerEvents="none" style={styles.glow} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <View style={styles.headCopy}>
            <Eyebrow tone={colors.metal}>{t('Support SKR Eyes')}</Eyebrow>
            <Text style={styles.title}>{t('Send a thank you')}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={onClose} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable>
        </View>

        {/* The coins. Solana first because everyone has it. */}
        <View style={styles.coins}>
          {COINS.map((option) => {
            const on = coin?.key === option.key;
            return (
              <Pressable key={option.key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => pick(option)} style={[styles.coin, on && styles.coinOn]}>
                <CoinMark coin={option.key} on={on} />
                <Text style={[styles.coinLabel, on && styles.coinLabelOn]}>{option.key}</Text>
              </Pressable>
            );
          })}
          <Pressable accessibilityRole="button" accessibilityState={{ selected: coin == null }} onPress={() => pick(null)} style={[styles.coin, coin == null && styles.coinOn]}>
            <CoinMark coin="ANY" on={coin == null} />
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.coinLabel, coin == null && styles.coinLabelOn]}>{t('Any coin')}</Text>
          </Pressable>
        </View>

        {coin ? (
          <>
            {/* The amount, one big figure. */}
            <View style={styles.amountBlock}>
              <View style={styles.amountRow}>
                <TextInput
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={colors.faint}
                  value={amount}
                  onChangeText={(next) => { setAmount(next); setStatus(null); }}
                  style={styles.amountInput}
                />
                <Text style={styles.amountUnit}>{coin.unit}</Text>
              </View>
              <View style={styles.quicks}>
                {coin.quick.map((preset) => {
                  const on = clean === preset;
                  return (
                    <Pressable key={preset} accessibilityRole="button" onPress={() => { void Haptics.selectionAsync(); setAmount(preset); }} style={[styles.quick, on && styles.quickOn]}>
                      <Text style={[styles.quickText, on && styles.quickTextOn]}>{preset}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Button
              hero
              tone={colors.metal}
              label={good ? t('Donate {amount} {coin}', { amount: clean, coin: coin.unit }) : t('Send a tip')}
              onPress={pay}
              disabled={!good}
            />
            <Text style={styles.how}>{t('Your wallet opens with everything already filled in. Check it there and press send.')}</Text>
          </>
        ) : (
          <Text style={styles.how}>{t('Send any coin to this address.')}</Text>
        )}

        {status ? <Text style={styles.status}>{status}</Text> : null}

        {/* The receipt: who gets it, and a code any phone can read. */}
        <Panel style={styles.receipt}>
          <View style={styles.qrBox}>
            <QRCode value={coin ? link : `solana:${RECIPIENT}`} size={104} backgroundColor="#F2F7FB" color="#131007" />
          </View>
          <View style={styles.receiptCopy}>
            <Text style={styles.receiptName}>{RECIPIENT_NAME}</Text>
            <Text style={styles.receiptAddr} numberOfLines={coin ? 1 : 3}>{coin ? `${RECIPIENT.slice(0, 4)}…${RECIPIENT.slice(-4)}` : RECIPIENT}</Text>
            <Text style={styles.receiptHint}>{t('Or scan it from another phone.')}</Text>
          </View>
        </Panel>

        <View style={styles.footer}>
          <Text style={styles.foot}>{t('A tip changes nothing about your position and nothing about any airdrop. It is a thank you, not a fee.')}</Text>
          <Text style={styles.foot}>{t('Free and open source, built by one Seeker. Tips in SKR go to kosa.skr and are staked right away, all of them.')}</Text>
        </View>
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.bg, zIndex: 30 },
  glow: { position: 'absolute', top: -170, alignSelf: 'center', width: 480, height: 360, borderRadius: 240, backgroundColor: colors.metalWash },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  headCopy: { gap: 3, flexShrink: 1 },
  title: { color: colors.text, fontFamily: font.black, fontSize: 26, letterSpacing: -0.6 },
  close: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, borderWidth: 1, borderColor: colors.lineStrong },
  closeText: { color: colors.text, fontSize: 20, lineHeight: 22 },
  coins: { flexDirection: 'row', gap: spacing.sm },
  coin: { flex: 1, alignItems: 'center', gap: 7, paddingVertical: 13, paddingHorizontal: 4, borderRadius: 14, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line },
  coinOn: { backgroundColor: colors.accentWash, borderWidth: 1.5, borderColor: colors.accent },
  coinLabel: { color: colors.muted, fontFamily: font.bold, fontSize: 12.5 },
  coinLabelOn: { color: colors.accent },
  amountBlock: { alignItems: 'center', gap: spacing.lg, paddingTop: spacing.sm },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, justifyContent: 'center' },
  amountInput: { minWidth: 90, maxWidth: 240, textAlign: 'center', color: colors.text, fontFamily: font.black, fontSize: 56, letterSpacing: -2.4, padding: 0, fontVariant: ['tabular-nums'] },
  amountUnit: { color: colors.muted, fontFamily: font.semibold, fontSize: 17 },
  quicks: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' },
  quick: { minWidth: 60, alignItems: 'center', paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  quickOn: { borderColor: colors.accent, backgroundColor: colors.accentWash },
  quickText: { color: colors.muted, fontFamily: font.semibold, fontSize: 13, fontVariant: ['tabular-nums'] },
  quickTextOn: { color: colors.accent },
  how: { color: colors.muted, fontFamily: font.regular, ...type.small, textAlign: 'center', paddingHorizontal: spacing.md },
  status: { color: colors.pending, fontFamily: font.medium, ...type.small, textAlign: 'center' },
  receipt: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.md },
  qrBox: { backgroundColor: '#F2F7FB', borderRadius: 12, padding: 8 },
  receiptCopy: { flex: 1, gap: 4 },
  receiptName: { color: '#E8CF95', fontFamily: font.monoSemibold, fontSize: 15, textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2.5 },
  receiptAddr: { color: colors.faint, fontFamily: font.mono, fontSize: 11 },
  receiptHint: { color: colors.muted, fontFamily: font.regular, ...type.micro },
  footer: { gap: spacing.sm },
  foot: { color: colors.muted, fontFamily: font.regular, ...type.micro },
});
