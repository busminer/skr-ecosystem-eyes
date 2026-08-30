import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { t } from '../../i18n';
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
  if (state === 'sent' || state === 'confirmed') return { label: t('staked'), tone: colors.positive };
  if (state === 'unknown') return { label: t('did not go out'), tone: colors.negative };
  return { label: t('waiting'), tone: colors.muted };
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
  // An anchor is free again the moment its part has gone out, so a finished day
  // is not the end of the day: one more fingerprint buys another round. What the
  // anchors limit is how many parts can be waiting at once, never how many a day
  // can hold.
  const settled = parts.length > 0 && parts.every((part) => part.state !== 'ready' && part.state !== 'unsigned');
  const planning = parts.length === 0 || settled;
  const canApprove = armed && ready >= anchorCount && perPart >= MIN_STAKE_RAW && busy == null;

  if (!vault.present) {
    return (
      <Panel>
        <Eyebrow>{t('Staking on a schedule')}</Eyebrow>
        <Text style={styles.lead}>
          {t('This phone has no Seed Vault, and a schedule can only be signed there. Ordinary staking still works from your profile.')}
        </Text>
      </Panel>
    );
  }

  return (
    <View style={styles.screen}>
      {!armed ? (
        <Panel>
          <Eyebrow>{t('Staking on a schedule')}</Eyebrow>
          <Text style={styles.headline}>{t('Approve once in the morning. The day stakes itself.')}</Text>
          <Text style={styles.lead}>
            {t('Your key never leaves the Seed Vault and your signatures never leave this phone. You can stop it at any moment, and stopping works even against us.')}
          </Text>
          {setupCost != null && setupCost > 0 ? (
            <Text style={styles.fine}>
              {t('Turning it on costs {sol} SOL, held as a deposit and returned in full when you stop. One wallet confirmation.', { sol: setupCost.toFixed(4) })}
            </Text>
          ) : null}
          <Button
            label={busy === 'setup' ? t('Setting up…') : t('Turn it on')}
            onPress={() => void turnOn()}
            disabled={busy != null}
            fill
          />
        </Panel>
      ) : null}

      {armed && planning ? (
        <Panel>
          <Eyebrow>{t('Today')}</Eyebrow>

          <View style={styles.amountRow}>
            <TextInput
              style={styles.amount}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="1"
              placeholderTextColor={colors.faint}
            />
            <Text style={styles.unit}>{t('SKR each time')}</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('How many times')}</Text>
            <RangeSwitch
              value={String(anchorCount)}
              options={['3', '5', '8', '12']}
              onChange={(next) => setAnchorCount(Number(next))}
            />
          </View>

          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('How far apart')}</Text>
            <RangeSwitch value={spread} options={SPREADS} label={t} onChange={setSpread} />
          </View>

          {overPrecise ? <Text style={styles.warn}>{t('SKR has six decimals; a seventh cannot be staked.')}</Text> : null}
          {tooSmall ? <Text style={styles.warn}>{t('Each time must stake at least 1 SKR.')}</Text> : null}
          {ready < anchorCount ? (
            <Text style={styles.warn}>
              {t('This phone is set up for {ready} a day. Tap Turn it on again to raise it to {wanted}.', { ready, wanted: anchorCount })}
            </Text>
          ) : null}

          <Text style={styles.summary}>
            {perPart >= MIN_STAKE_RAW
              ? t('{total} SKR over the day · {count} times · {minutes} minutes apart', { total: fromRaw(perPart * BigInt(anchorCount)), count: anchorCount, minutes: SPREAD_MINUTES[spread] ?? 5 })
              : t('Enter how much to stake each time.')}
          </Text>

          <Button
            label={busy === 'signing'
              ? t('Waiting for your fingerprint…')
              : settled
                ? t('Stake {count} more', { count: anchorCount })
                : touches > 1 ? t('Approve the day · {count} fingerprints', { count: touches }) : t('Approve the day')}
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
            <Eyebrow>{t('Today')}</Eyebrow>
            <Text style={styles.progress}>{t('{done} of {total} staked', { done, total: parts.length })}</Text>
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
            {settled
              ? t('Every one of these has gone out. The anchors are free again, so another round is one fingerprint away.')
              : t('Each one goes out on its own when its time comes. Android may be a few minutes late, and for now it only goes out while the app is running — a scheduled wake-up is the next piece.')}
          </Text>

          <Button label={t('Stop the day')} onPress={() => void clearPlan()} ghost fill />
        </Panel>
      ) : null}

      {busy ? <ActivityIndicator color={colors.accent} /> : null}
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {error ? <Text style={styles.warn}>{error}</Text> : null}
      {lamports != null && lamports < 5_000_000 ? (
        <Text style={styles.warn}>{t('Low on SOL: every stake costs a fraction of a cent in fees.')}</Text>
      ) : null}
      <Button label={t('Refresh')} onPress={() => void refresh()} ghost fill />
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
