import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { colors, font, radius, spacing, type } from '../../theme';
import { t } from '../../i18n';
import { Button, Evidence, Eyebrow, Panel } from '../kit';
import { FIRST_STAKE_RENT_LAMPORTS, MIN_STAKE_RAW, fromRaw, toRaw, tooPrecise } from './stakeTx';
import { useStakeRun } from './useStakeRun';

import { fetchWalletBalance } from './gateway';

const COUNTS = [1, 4, 8, 16];

function partTone(state: string): string {
  if (state === 'confirmed') return colors.positive;
  if (state === 'failed') return colors.negative;
  if (state === 'unknown') return colors.pending;
  if (state === 'sending' || state === 'sent') return colors.pending;
  return colors.lineStrong;
}

export function StakeSheet({ wallet, hasPosition, onClose, presetAmount, presetSplit }: { wallet: string; hasPosition: boolean; onClose: () => void; presetAmount?: string; presetSplit?: number }) {
  // The daily sixteen opens the sheet already filled in: one SKR, sixteen
  // parts, one approval. Everything else about the sheet stays the same, so
  // the person still sees the balance check and the total before signing.
  const [amount, setAmount] = useState(presetAmount ?? '');
  const [split, setSplit] = useState(presetSplit ?? 1);

  // What the wallet actually holds, read once when the sheet opens.
  //
  // Until this existed the app would happily build a stake larger than the
  // wallet: sixteen parts of sixteen SKR on twenty-eight SKR, of which the
  // chain took the first and refused fifteen. The person saw fifteen failures
  // and no reason, and would sooner blame the app than their balance.
  const [held, setHeld] = useState<bigint | null>(null);
  useEffect(() => {
    let gone = false;
    fetchWalletBalance(wallet)
      .then((result) => { if (!gone) setHeld(BigInt(result.rawBalance)); })
      // A balance we could not read must not block a stake. The chain is still
      // the judge; this is only here to save people from a refusal it can see
      // coming.
      .catch(() => { if (!gone) setHeld(null); });
    return () => { gone = true; };
  }, [wallet]);
  const { run, phase, error, uncertain, start, resume, clear, confirmed, total } = useStakeRun(wallet);

  // The amount is what goes into one transaction; the count is how many such
  // transactions to send. The total is the product, and it is always visible.
  const perPart = useMemo(() => toRaw(amount), [amount]);
  const totalRaw = perPart * BigInt(split);
  const overPrecise = tooPrecise(amount);
  const tooSmall = !overPrecise && perPart > 0n && perPart < MIN_STAKE_RAW;
  // The balance is shown to two decimals rather than to the token's full six.
  // What somebody needs from this line is whether they can afford the stake,
  // and 332.256236 answers that no better than 332.25 while reading as noise.
  // The comparison itself still uses every last unit.
  const heldShort = held == null ? null : (Number(held) / 1e6).toFixed(2);
  const overBalance = held != null && totalRaw > held;
  const affordableParts = held != null && perPart > 0n ? Number(held / perPart) : null;
  const ready = perPart >= MIN_STAKE_RAW && phase === 'idle' && !overBalance;
  const working = phase === 'preparing' || phase === 'signing' || phase === 'sending';

  return (
    <Animated.View entering={FadeIn.duration(180)} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <View>
            <Eyebrow>{t('Stake SKR')}</Eyebrow>
            <Text style={styles.title}>{t('Add to your position')}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={onClose} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable>
        </View>

        {run == null ? (
          <>
            <Panel style={styles.panel}>
              <Eyebrow>{t('Amount per transaction')}</Eyebrow>
              <View style={styles.amountRow}>
                <TextInput
                  autoFocus
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={colors.faint}
                  value={amount}
                  onChangeText={setAmount}
                  style={styles.amountInput}
                />
                <Text style={styles.amountUnit}>SKR</Text>
              </View>
              <Text style={[styles.hint, (tooSmall || overPrecise) && styles.warn]}>
                {overPrecise
                  ? t('SKR has six decimal places. Shorten the amount — the extra digits cannot be staked.')
                  : tooSmall
                    ? t('A single transaction cannot stake less than 1 SKR.')
                    : t('This is what one transaction stakes. The total is this amount times the count below.')}
              </Text>
            </Panel>

            <Panel style={styles.panel}>
              <Eyebrow>{t('How many transactions')}</Eyebrow>
              <View style={styles.splits}>
                {COUNTS.map((option) => {
                  const on = option === split;
                  // An option costing more than the wallet holds is shown, not
                  // hidden: seeing that 16 needs 256 SKR and you hold 28 is the
                  // explanation. Hiding it would just be a shorter row.
                  const unaffordable = held != null && perPart > 0n && perPart * BigInt(option) > held;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => { void Haptics.selectionAsync(); setSplit(option); }}
                      style={[styles.split, on && styles.splitOn, unaffordable && styles.splitShort]}
                    >
                      <Text style={[styles.splitLabel, on && styles.splitLabelOn, unaffordable && styles.splitLabelShort]}>{option} tx</Text>
                      <Text style={[styles.splitNeed, unaffordable && styles.splitLabelShort]}>{perPart > 0n ? `${fromRaw(perPart * BigInt(option))} SKR` : '—'}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.hint}>
                {split === 1
                  ? t('One transaction, one wallet approval.')
                  : t('{count} identical transactions from one approval, sent one after another. Each one is a separate on-chain stake.', { count: split })}
              </Text>

              {/* Said in the wallet's own terms rather than as an error code.
                  The chain would refuse this anyway; the point is to say so
                  before the person has spent a fee finding out. */}
              {overBalance ? (
                <Text style={styles.shortfall}>
                  {t('This needs {needed} SKR and you hold {held}. ', { needed: fromRaw(totalRaw), held: heldShort ?? '' })}
                  {affordableParts && affordableParts > 0
                    ? (affordableParts === 1 ? t('At this amount you can send 1 part.') : t('At this amount you can send {count} parts.', { count: affordableParts }))
                    : t('Lower the amount to stake what you have.')}
                </Text>
              ) : held != null ? (
                <Text style={styles.holding}>{t('You hold {held} SKR.', { held: heldShort ?? '' })}</Text>
              ) : null}
            </Panel>

            <Panel style={styles.panel}>
              <Eyebrow>{t('Before you sign')}</Eyebrow>
              <View style={styles.summary}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>{t('sent as')}</Text>
                  <Text style={styles.summaryValue}>{perPart > 0n ? `${split} × ${fromRaw(perPart)} SKR` : '—'}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>{t('you stake in total')}</Text>
                  <Text style={[styles.summaryValue, styles.summaryTotal]}>{totalRaw > 0n ? `${fromRaw(totalRaw)} SKR` : '—'}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>{t('position account rent')}</Text>
                  <Text style={styles.summaryValue}>
                    {hasPosition ? t('already paid') : t('{sol} SOL, once', { sol: (FIRST_STAKE_RENT_LAMPORTS / 1_000_000_000).toFixed(6) })}
                  </Text>
                </View>
              </View>
              <Text style={styles.hint}>
                {hasPosition
                  ? t('Your position account already exists, so only the network fee applies — a few thousand lamports per transaction.')
                  : t('The first stake creates your position account and its rent stays with the account. Network fees are a few thousand lamports per transaction.')}
              </Text>
            </Panel>

            <Button
              label={working
                ? t('Working…')
                : tooSmall
                  ? t('At least 1 SKR per transaction')
                  : totalRaw > 0n ? t('Sign and stake {amount} SKR', { amount: fromRaw(totalRaw) }) : t('Sign and stake')}
              onPress={() => void start(perPart, split)}
              disabled={!ready}
            />
          </>
        ) : (
          <>
            <Panel style={styles.panel}>
              <View style={styles.progressHead}>
                <Eyebrow tone={phase === 'done' ? colors.positive : phase === 'error' ? colors.negative : colors.accent}>
                  {phase === 'done'
                    ? t('All parts landed')
                    : phase === 'error'
                      ? t('Stopped')
                      : phase === 'signing'
                        ? t('Approve in your wallet')
                        : phase === 'preparing'
                          ? t('Preparing transactions')
                          : phase === 'idle'
                            ? t('A run from before')
                            : t('Landing on chain')}
                </Eyebrow>
                <Text style={styles.counter}>{confirmed} / {total}</Text>
              </View>
              <View style={styles.track}>
                <Animated.View style={[styles.fill, { width: `${total > 0 ? (confirmed / total) * 100 : 0}%` }]} />
              </View>
              <View style={styles.parts}>
                {run.parts.map((part) => (
                  <Animated.View key={part.index} entering={FadeInDown.duration(200)} style={styles.partRow}>
                    <View style={[styles.partDot, { backgroundColor: partTone(part.state) }]} />
                    <Text style={styles.partAmount}>{fromRaw(BigInt(part.amountRaw))} SKR</Text>
                    <Text style={[styles.partState, { color: partTone(part.state) }]}>{t(part.state)}</Text>
                  </Animated.View>
                ))}
              </View>
            </Panel>

            {error ? (
              <Panel style={styles.errorPanel} tone={uncertain ? colors.pending : colors.negative}>
                <Eyebrow tone={uncertain ? colors.pending : colors.negative}>{uncertain ? t('We do not know yet') : t('What happened')}</Eyebrow>
                <Text style={styles.errorText}>{error}</Text>
              </Panel>
            ) : null}

            {/* Whenever nothing is in flight there is always a way back to the
                form. A finished run must never become a dead end. */}
            <View style={styles.actions}>
              {phase === 'error' && run.parts.some((part) => part.signature) ? <Button fill label={t('Ask the chain again')} onPress={resume} ghost /> : null}
              {working ? null : <Button fill label={phase === 'done' ? t('Stake again') : uncertain ? t('Discard and start over') : t('Start over')} onPress={clear} ghost />}
              {phase === 'done' ? <Button fill label={t('Close')} onPress={() => { clear(); onClose(); }} ghost /> : null}
            </View>

            <Evidence
              lines={[
                'order      the wallet signs and sends; we write down what it returns',
                'recovery   a written-down signature is re-asked, never replaced',
                `guardian   ${run.guardianPool.slice(0, 4)}…${run.guardianPool.slice(-4)}`,
              ]}
            />
          </>
        )}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.bg, zIndex: 30 },
  content: { padding: spacing.lg, paddingBottom: 140, gap: spacing.lg },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { color: colors.text, fontFamily: font.bold, fontSize: 22, letterSpacing: -0.4, marginTop: spacing.xs },
  close: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: colors.text, fontFamily: font.regular, fontSize: 22, lineHeight: 26 },
  panel: { padding: spacing.md, gap: spacing.md },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  amountInput: { flex: 1, color: colors.text, fontFamily: font.black, fontSize: 34, letterSpacing: -1, padding: 0 },
  amountUnit: { color: colors.muted, fontFamily: font.semibold, fontSize: 14 },
  shortfall: { color: colors.pending, fontFamily: font.medium, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
  holding: { color: colors.muted, fontFamily: font.regular, fontSize: 13, marginTop: spacing.sm },
  hint: { color: colors.muted, fontFamily: font.regular, ...type.small },
  splits: { flexDirection: 'row', gap: spacing.sm },
  split: { flex: 1, alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.inner, borderWidth: 1, borderColor: colors.line },
  splitOn: { borderColor: colors.accentDim, backgroundColor: colors.panelHi },
  // Both of these were written for 1.0.0 and never wired to anything: the
  // balance check they were meant for did not exist until now.
  splitShort: { opacity: 0.45 },
  splitLabelShort: { color: colors.faint },
  splitNeed: { color: colors.faint, fontFamily: font.regular, fontSize: 10.5, marginTop: 2 },
  warn: { color: colors.pending },
  splitLabel: { color: colors.muted, fontFamily: font.semibold, fontSize: 13 },
  splitLabelOn: { color: colors.accent },
  summary: { gap: spacing.sm },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { color: colors.muted, fontFamily: font.regular, ...type.small },
  summaryValue: { color: colors.text, fontFamily: font.semibold, ...type.small },
  summaryTotal: { color: colors.accent, fontSize: 14 },
  progressHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  counter: { color: colors.text, fontFamily: font.bold, fontSize: 16, fontVariant: ['tabular-nums'] },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
  parts: { gap: spacing.sm },
  partRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  partDot: { width: 8, height: 8, borderRadius: 4 },
  partAmount: { flex: 1, color: colors.text, fontFamily: font.medium, ...type.small },
  partState: { fontFamily: font.semibold, ...type.micro },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  errorPanel: { padding: spacing.md, gap: spacing.sm, borderColor: colors.negative },
  errorText: { color: colors.text, fontFamily: font.regular, ...type.body },
});
