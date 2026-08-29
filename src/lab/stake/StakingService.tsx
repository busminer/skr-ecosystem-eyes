import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, font, radius, spacing, type } from '../../theme';
import { Button, Eyebrow, Panel, Pill, RangeSwitch } from '../kit';
import { useDeferredStaking } from './useDeferredStaking';
import { MIN_STAKE_RAW, fromRaw, toRaw, tooPrecise } from './stakeTx';

// Staking that happens without you.
//
// You say how much and how spread out, approve once, and the day runs itself.
// There is deliberately no send button anywhere on this screen: a part that only
// goes out when somebody remembers to tap is not a schedule, it is a chore with
// extra steps.
//
// What the screen does owe the person is the truth about three things — what
// they are approving before they approve it, what has actually happened since,
// and how to stop it. Everything else is plumbing and stays out of sight.

const SPREADS = ['5 min', '1 h', '2 h', '4 h'];
const SPREAD_MINUTES: Record<string, number> = { '5 min': 5, '1 h': 60, '2 h': 120, '4 h': 240 };

function clock(stamp: number): string {
  return new Date(stamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function partWord(state: string): { label: string; tone: string } {
  if (state === 'sent' || state === 'confirmed') return { label: 'staked', tone: colors.positive };
  if (state === 'unknown') return { label: 'did not go out', tone: colors.negative };
  return { label: 'waiting', tone: colors.muted };
}

export function StakingService({ wallet }: { wallet: string }) {
  const {
    vault, anchors, parts, lamports, rent, busy, error, note,
    anchorCount, setAnchorCount,
    refresh, turnOn, approveDay, clearPlan,
  } = useDeferredStaking(wallet);

  const [amount, setAmount] = useState('1');
  const [spread, setSpread] = useState<string>(SPREADS[0] as string);

  const perPart = useMemo(() => toRaw(amount), [amount]);
  const overPrecise = tooPrecise(amount);
  const tooSmall = !overPrecise && perPart > 0n && perPart < MIN_STAKE_RAW;

  const batch = vault.limits?.maxSigningRequests ?? 3;
  const ready = anchors.filter((anchor) => anchor.usable).length;
  const armed = vault.account != null && ready > 0;
  const touches = Math.ceil(anchorCount / Math.max(1, batch));
  const setupCost = rent == null ? null : (rent * Math.max(0, anchorCount - ready)) / 1e9;

  const done = parts.filter((part) => part.state === 'sent' || part.state === 'confirmed').length;
  const canApprove = armed && ready >= anchorCount && perPart >= MIN_STAKE_RAW && busy == null;

  if (!vault.present) {
    return (
      <Panel>
        <Eyebrow>Staking on a schedule</Eyebrow>
        <Text style={styles.lead}>
          This phone has no Seed Vault, and a schedule can only be signed there. Ordinary staking
          still works from your profile.
        </Text>
      </Panel>
    );
  }

  return (
    <View style={styles.screen}>
      {!armed ? (
        <Panel>
          <Eyebrow>Staking on a schedule</Eyebrow>
          <Text style={styles.headline}>Approve once in the morning. The day stakes itself.</Text>
          <Text style={styles.lead}>
            Your key never leaves the Seed Vault and your signatures never leave this phone. You can
            stop it at any moment, and stopping works even against us.
          </Text>
          {setupCost != null && setupCost > 0 ? (
            <Text style={styles.fine}>
              {`Turning it on costs ${setupCost.toFixed(4)} SOL, held as a deposit and returned in full when you stop. One wallet confirmation.`}
            </Text>
          ) : null}
          <Button
            label={busy === 'setup' ? 'Setting up…' : 'Turn it on'}
            onPress={() => void turnOn()}
            disabled={busy != null}
            fill
          />
        </Panel>
      ) : null}

      {armed && parts.length === 0 ? (
        <Panel>
          <Eyebrow>Today</Eyebrow>

          <View style={styles.amountRow}>
            <TextInput
              style={styles.amount}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="1"
              placeholderTextColor={colors.faint}
            />
            <Text style={styles.unit}>SKR each time</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.rowLabel}>How many times</Text>
            <RangeSwitch
              value={String(anchorCount)}
              options={['1', '3', '5', '8']}
              onChange={(next) => setAnchorCount(Number(next))}
            />
          </View>

          <View style={styles.row}>
            <Text style={styles.rowLabel}>How far apart</Text>
            <RangeSwitch value={spread} options={SPREADS} onChange={setSpread} />
          </View>

          {overPrecise ? <Text style={styles.warn}>SKR has six decimals; a seventh cannot be staked.</Text> : null}
          {tooSmall ? <Text style={styles.warn}>Each time must stake at least 1 SKR.</Text> : null}
          {ready < anchorCount ? (
            <Text style={styles.warn}>
              {`This phone is set up for ${ready} a day. Tap Turn it on again to raise it to ${anchorCount}.`}
            </Text>
          ) : null}

          <Text style={styles.summary}>
            {perPart >= MIN_STAKE_RAW
              ? `${fromRaw(perPart * BigInt(anchorCount))} SKR over the day · ${anchorCount} times · ${SPREAD_MINUTES[spread]} minutes apart`
              : 'Enter how much to stake each time.'}
          </Text>

          <Button
            label={busy === 'signing'
              ? 'Waiting for your fingerprint…'
              : touches > 1 ? `Approve the day · ${touches} fingerprints` : 'Approve the day'}
            onPress={() => void approveDay({
              perPartRaw: perPart,
              count: anchorCount,
              spacingMinutes: SPREAD_MINUTES[spread] ?? 5,
            })}
            disabled={!canApprove}
            fill
          />
        </Panel>
      ) : null}

      {parts.length > 0 ? (
        <Panel>
          <View style={styles.headRow}>
            <Eyebrow>Today</Eyebrow>
            <Text style={styles.progress}>{`${done} of ${parts.length} staked`}</Text>
          </View>

          {parts.map((part) => {
            const word = partWord(part.state);
            return (
              <View key={part.index} style={styles.partRow}>
                <Text style={styles.partTime}>{clock(part.sendAfter)}</Text>
                <Text style={styles.partAmount}>{`${fromRaw(BigInt(part.amountRaw))} SKR`}</Text>
                <Pill label={word.label} tone={word.tone} />
              </View>
            );
          })}

          <Text style={styles.fine}>
            Each one goes out on its own when its time comes. Android may be a few minutes late, and
            for now it only goes out while the app is running — a scheduled wake-up is the next piece.
          </Text>

          <Button label="Stop the day" onPress={() => void clearPlan()} ghost fill />
        </Panel>
      ) : null}

      {busy ? <ActivityIndicator color={colors.accent} /> : null}
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {error ? <Text style={styles.warn}>{error}</Text> : null}
      {lamports != null && lamports < 5_000_000 ? (
        <Text style={styles.warn}>Low on SOL: every stake costs a fraction of a cent in fees.</Text>
      ) : null}
      <Button label="Refresh" onPress={() => void refresh()} ghost fill />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { gap: spacing.md },
  headline: { ...type.tile, color: colors.text, fontFamily: font.semibold, marginBottom: spacing.sm },
  lead: { ...type.body, color: colors.muted, fontFamily: font.regular, marginBottom: spacing.sm },
  fine: { ...type.micro, color: colors.faint, fontFamily: font.regular, marginBottom: spacing.sm },
  summary: { ...type.body, color: colors.text, fontFamily: font.regular, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  rowLabel: { ...type.body, color: colors.muted, fontFamily: font.regular },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  progress: { ...type.micro, color: colors.muted, fontFamily: font.mono },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  amount: {
    flex: 1,
    ...type.tile,
    color: colors.text,
    fontFamily: font.mono,
    borderRadius: radius.inner,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  unit: { ...type.body, color: colors.muted, fontFamily: font.regular },
  partRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  partTime: { ...type.body, color: colors.text, fontFamily: font.mono, width: 72 },
  partAmount: { ...type.body, color: colors.muted, fontFamily: font.regular, flex: 1 },
  note: { ...type.micro, color: colors.muted, fontFamily: font.regular },
  warn: { ...type.micro, color: colors.negative, fontFamily: font.regular },
});
