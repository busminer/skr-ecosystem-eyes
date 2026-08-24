import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { colors, font, radius, spacing, type } from '../../theme';
import { Button, Evidence, Eyebrow, Panel } from '../kit';
import { FIRST_STAKE_RENT_LAMPORTS, MIN_STAKE_RAW, fromRaw, toRaw } from './stakeTx';
import { useStakeRun } from './useStakeRun';

const COUNTS = [1, 4, 8, 16];

function partTone(state: string): string {
  if (state === 'confirmed') return colors.positive;
  if (state === 'failed') return colors.negative;
  if (state === 'unknown') return colors.pending;
  if (state === 'sending' || state === 'sent') return colors.pending;
  return colors.lineStrong;
}

export function StakeSheet({ wallet, hasPosition, onClose }: { wallet: string; hasPosition: boolean; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [split, setSplit] = useState(1);
  const { run, phase, error, uncertain, start, resume, clear, confirmed, total } = useStakeRun(wallet);

  // The amount is what goes into one transaction; the count is how many such
  // transactions to send. The total is the product, and it is always visible.
  const perPart = useMemo(() => toRaw(amount), [amount]);
  const totalRaw = perPart * BigInt(split);
  const tooSmall = perPart > 0n && perPart < MIN_STAKE_RAW;
  const ready = perPart >= MIN_STAKE_RAW && phase === 'idle';
  const working = phase === 'preparing' || phase === 'signing' || phase === 'sending';

  return (
    <Animated.View entering={FadeIn.duration(180)} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <View>
            <Eyebrow>Stake SKR</Eyebrow>
            <Text style={styles.title}>Add to your position</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable>
        </View>

        {run == null ? (
          <>
            <Panel style={styles.panel}>
              <Eyebrow>Amount per transaction</Eyebrow>
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
              <Text style={[styles.hint, tooSmall && styles.warn]}>
                {tooSmall
                  ? 'A single transaction cannot stake less than 1 SKR.'
                  : 'This is what one transaction stakes. The total is this amount times the count below.'}
              </Text>
            </Panel>

            <Panel style={styles.panel}>
              <Eyebrow>How many transactions</Eyebrow>
              <View style={styles.splits}>
                {COUNTS.map((option) => {
                  const on = option === split;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => { void Haptics.selectionAsync(); setSplit(option); }}
                      style={[styles.split, on && styles.splitOn]}
                    >
                      <Text style={[styles.splitLabel, on && styles.splitLabelOn]}>{option} tx</Text>
                      <Text style={styles.splitNeed}>{perPart > 0n ? `${fromRaw(perPart * BigInt(option))} SKR` : '—'}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.hint}>
                {split === 1
                  ? 'One transaction, one wallet approval.'
                  : `${split} identical transactions from one approval, sent one after another. Each one is a separate on-chain stake.`}
              </Text>
            </Panel>

            <Panel style={styles.panel}>
              <Eyebrow>Before you sign</Eyebrow>
              <View style={styles.summary}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>sent as</Text>
                  <Text style={styles.summaryValue}>{perPart > 0n ? `${split} × ${fromRaw(perPart)} SKR` : '—'}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>you stake in total</Text>
                  <Text style={[styles.summaryValue, styles.summaryTotal]}>{totalRaw > 0n ? `${fromRaw(totalRaw)} SKR` : '—'}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>position account rent</Text>
                  <Text style={styles.summaryValue}>
                    {hasPosition ? 'already paid' : `${(FIRST_STAKE_RENT_LAMPORTS / 1_000_000_000).toFixed(6)} SOL, once`}
                  </Text>
                </View>
              </View>
              <Text style={styles.hint}>
                {hasPosition
                  ? 'Your position account already exists, so only the network fee applies — a few thousand lamports per transaction.'
                  : 'The first stake creates your position account and its rent stays with the account. Network fees are a few thousand lamports per transaction.'}
              </Text>
            </Panel>

            <Button
              label={working
                ? 'Working…'
                : tooSmall
                  ? 'At least 1 SKR per transaction'
                  : totalRaw > 0n ? `Sign and stake ${fromRaw(totalRaw)} SKR` : 'Sign and stake'}
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
                    ? 'All parts landed'
                    : phase === 'error'
                      ? 'Stopped'
                      : phase === 'signing'
                        ? 'Approve in your wallet'
                        : phase === 'preparing'
                          ? 'Preparing transactions'
                          : phase === 'idle'
                            ? 'A run from before'
                            : 'Landing on chain'}
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
                    <Text style={[styles.partState, { color: partTone(part.state) }]}>{part.state}</Text>
                  </Animated.View>
                ))}
              </View>
            </Panel>

            {error ? (
              <Panel style={styles.errorPanel} tone={uncertain ? colors.pending : colors.negative}>
                <Eyebrow tone={uncertain ? colors.pending : colors.negative}>{uncertain ? 'We do not know yet' : 'What happened'}</Eyebrow>
                <Text style={styles.errorText}>{error}</Text>
              </Panel>
            ) : null}

            {/* Whenever nothing is in flight there is always a way back to the
                form. A finished run must never become a dead end. */}
            <View style={styles.actions}>
              {phase === 'error' && run.parts.some((part) => part.signature) ? <Button fill label="Ask the chain again" onPress={resume} ghost /> : null}
              {working ? null : <Button fill label={phase === 'done' ? 'Stake again' : uncertain ? 'Discard and start over' : 'Start over'} onPress={clear} ghost />}
              {phase === 'done' ? <Button fill label="Close" onPress={() => { clear(); onClose(); }} ghost /> : null}
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
  hint: { color: colors.muted, fontFamily: font.regular, ...type.small },
  splits: { flexDirection: 'row', gap: spacing.sm },
  split: { flex: 1, alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.inner, borderWidth: 1, borderColor: colors.line },
  splitOn: { borderColor: colors.accentDim, backgroundColor: colors.panelHi },
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
