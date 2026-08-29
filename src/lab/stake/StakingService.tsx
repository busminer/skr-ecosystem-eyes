import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, font, radius, spacing, type } from '../../theme';
import { Button, Evidence, Eyebrow, Panel, Pill, RangeSwitch } from '../kit';
import { useDeferredStaking } from './useDeferredStaking';
import { MIN_STAKE_RAW, fromRaw, toRaw, tooPrecise } from './stakeTx';

// Staking on a schedule, laid out in the order it actually happens.
//
// The screen is deliberately literal: every step says what it costs, what it
// commits to, and what it does not do. This is a feature where the person
// approves transactions that will be sent hours later, and the vault will not
// explain those transactions on our behalf — it signs the bytes it is handed
// without reading them. So the explaining is this screen's job, and it is the
// only place the amounts are ever shown before they become signatures.

const SPACINGS = ['5 min', '30 min', '2 h', '4 h'];
const SPACING_MINUTES: Record<string, number> = { '5 min': 5, '30 min': 30, '2 h': 120, '4 h': 240 };

function windowLabel(from: number, to: number): string {
  const clock = (stamp: number) => new Date(stamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${clock(from)} – ${clock(to)}`;
}

function partTone(state: string): string {
  if (state === 'sent' || state === 'confirmed') return colors.positive;
  if (state === 'unknown') return colors.negative;
  if (state === 'ready') return colors.accent;
  return colors.lineStrong;
}

export function StakingService({ wallet }: { wallet: string }) {
  const {
    vault, anchors, parts, lamports, rent, busy, error, note,
    anchorCount, setAnchorCount,
    refresh, enterVault, createAnchors, approveDay, sendPart, clearPlan,
  } = useDeferredStaking(wallet);

  const [amount, setAmount] = useState('1');
  const [gap, setGap] = useState<string>(SPACINGS[0] as string);

  const perPart = useMemo(() => toRaw(amount), [amount]);
  const overPrecise = tooPrecise(amount);
  const tooSmall = !overPrecise && perPart > 0n && perPart < MIN_STAKE_RAW;

  const batch = vault.limits?.maxSigningRequests ?? 3;
  const ready = anchors.filter((anchor) => anchor.usable).length;
  const missing = anchors.length - ready;
  const fingerprints = Math.ceil(anchorCount / Math.max(1, batch));
  const anchorCost = rent == null ? null : (rent * missing) / 1e9;
  const canApprove = vault.authToken != null && vault.account != null && ready >= anchorCount
    && perPart >= MIN_STAKE_RAW && busy == null;

  return (
    <View style={styles.screen}>
      <Panel>
        <Eyebrow>Step 1 · the vault</Eyebrow>
        <Text style={styles.lead}>
          A wallet signs and sends in one motion, so a part meant for the afternoon would leave at once.
          Seed Vault hands the signature back instead, and the part waits here on your phone.
        </Text>
        {vault.present ? (
          <Evidence lines={[
            vault.permission ? 'Access granted' : 'Access not granted yet',
            vault.seedName ? `Seed: ${vault.seedName}` : 'No seed opened for this app',
            vault.account ? `Signing key matches your wallet` : 'No vault account matches this wallet',
            vault.permission
              ? `This vault signs ${batch} transaction(s) per fingerprint`
              : 'Batch size unknown until access is granted',
          ]} />
        ) : (
          <Text style={styles.warn}>
            No Seed Vault on this phone. A schedule needs one; ordinary staking still works.
          </Text>
        )}
        {vault.present && !vault.account ? (
          <Button
            label={busy === 'vault' ? 'Opening…' : 'Open the vault'}
            onPress={() => void enterVault()}
            disabled={busy != null}
            fill
          />
        ) : null}
      </Panel>

      <Panel>
        <Eyebrow>Step 2 · the anchors</Eyebrow>
        <Text style={styles.lead}>
          A signed transaction normally dies within a minute. An anchor replaces that clock, so a part
          stays valid until it is sent. One anchor carries one part, and closing an anchor cancels
          every part still waiting — that works even against us.
        </Text>

        <View style={styles.row}>
          <Text style={styles.rowLabel}>Parts per day</Text>
          <RangeSwitch
            value={String(anchorCount)}
            options={['1', '3', '5', '8']}
            onChange={(next) => setAnchorCount(Number(next))}
          />
        </View>

        <View style={styles.anchorList}>
          {anchors.map((anchor) => (
            <View key={anchor.address} style={styles.anchorRow}>
              <Text style={styles.anchorName}>{`Anchor ${anchor.index + 1}`}</Text>
              <Pill
                label={anchor.usable ? 'ready' : anchor.exists ? 'not yours' : 'missing'}
                tone={anchor.usable ? colors.positive : colors.pending}
              />
            </View>
          ))}
        </View>

        <Evidence lines={[
          `${ready} of ${anchors.length} anchors ready`,
          missing === 0
            ? 'Rent already paid; closing an anchor returns it'
            : anchorCost != null
              ? `Making the rest costs ${anchorCost.toFixed(5)} SOL of rent, returned when you close them`
              : 'Rent for the missing anchors is still being read',
          lamports != null ? `Wallet holds ${(lamports / 1e9).toFixed(4)} SOL` : 'Wallet balance unread',
        ]} />

        {missing > 0 ? (
          <Button
            label={busy === 'anchors' ? 'Waiting for the wallet…' : `Make ${missing} anchor(s)`}
            onPress={() => void createAnchors()}
            disabled={busy != null}
            fill
          />
        ) : null}
      </Panel>

      <Panel>
        <Eyebrow>Step 3 · approve the day</Eyebrow>
        <Text style={styles.lead}>
          Each part stakes the same amount at its own hour. You approve them all now, with one
          fingerprint per {batch}.
        </Text>

        <View style={styles.amountRow}>
          <TextInput
            style={styles.amount}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="1"
            placeholderTextColor={colors.faint}
          />
          <Text style={styles.unit}>SKR per part</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.rowLabel}>Gap between parts</Text>
          <RangeSwitch value={gap} options={SPACINGS} onChange={setGap} />
        </View>

        <Evidence lines={[
          perPart > 0n ? `Total ${fromRaw(perPart * BigInt(anchorCount))} SKR across ${anchorCount} part(s)` : 'Enter an amount',
          `${fingerprints} fingerprint(s) to approve them all`,
          'Nothing is uploaded. The signatures stay on this phone and die with the app.',
        ]} />

        {overPrecise ? <Text style={styles.warn}>SKR has six decimals; a seventh cannot be staked.</Text> : null}
        {tooSmall ? <Text style={styles.warn}>Each part must stake at least 1 SKR.</Text> : null}

        <Button
          label={busy === 'signing' ? 'Waiting for the vault…' : 'Approve the day'}
          onPress={() => void approveDay({
            perPartRaw: perPart,
            count: anchorCount,
            spacingMinutes: SPACING_MINUTES[gap] ?? 5,
          })}
          disabled={!canApprove}
          fill
        />
      </Panel>

      {parts.length > 0 ? (
        <Panel>
          <Eyebrow>Step 4 · the day</Eyebrow>
          {parts.map((part) => {
            const open = Date.now() >= part.sendAfter;
            return (
              <View key={part.index} style={styles.partRow}>
                <View style={styles.partHead}>
                  <Text style={styles.partName}>{`Part ${part.index + 1} · ${fromRaw(BigInt(part.amountRaw))} SKR`}</Text>
                  <Pill label={part.state} tone={partTone(part.state)} />
                </View>
                <Text style={styles.partWindow}>{windowLabel(part.sendAfter, part.sendBefore)}</Text>
                {part.state === 'ready' ? (
                  <Button
                    label={busy === `send-${part.index}` ? 'Sending…' : open ? 'Send now' : 'Send early'}
                    onPress={() => void sendPart(part.index)}
                    disabled={busy != null}
                    ghost={!open}
                    fill
                  />
                ) : null}
                {part.signature ? <Text style={styles.partSig}>{part.signature.slice(0, 24)}…</Text> : null}
              </View>
            );
          })}
          <Button label="Forget this plan" onPress={() => void clearPlan()} ghost fill />
        </Panel>
      ) : null}

      {busy ? <ActivityIndicator color={colors.accent} /> : null}
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {error ? <Text style={styles.warn}>{error}</Text> : null}
      <Button label="Refresh" onPress={() => void refresh()} ghost fill />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { gap: spacing.md },
  lead: { ...type.body, color: colors.muted, fontFamily: font.regular, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  rowLabel: { ...type.body, color: colors.muted, fontFamily: font.regular },
  anchorList: { gap: spacing.xs, marginBottom: spacing.sm },
  anchorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  anchorName: { ...type.body, color: colors.text, fontFamily: font.mono },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
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
  partRow: { gap: spacing.xs, marginBottom: spacing.sm },
  partHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  partName: { ...type.body, color: colors.text, fontFamily: font.regular },
  partWindow: { ...type.micro, color: colors.muted, fontFamily: font.mono },
  partSig: { ...type.micro, color: colors.faint, fontFamily: font.mono },
  note: { ...type.micro, color: colors.muted, fontFamily: font.regular },
  warn: { ...type.micro, color: colors.negative, fontFamily: font.regular },
});
