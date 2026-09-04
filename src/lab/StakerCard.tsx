import { StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { integer, shortAddress } from '../format';
import { colors, font, spacing, type } from '../theme';
import type { WalletProfile } from '../types';
import type { PositionAge } from './age';
import { CardArt, TIGHT_FRAME, frameRatio, type CardFacts } from './cardArt';

// How far the card reaches past the tab's 16-unit padding, leaving about three
// millimetres of background at each side.
const BLEED = 10;

// What the Me tab shows is the card itself — the same drawing that gets posted,
// not a separate in-app design that resembles it. Two drawings would drift, and
// the day they drifted the picture someone posted would stop being the thing
// they were looking at when they decided to post it.
//
// The stats underneath are the things the picture deliberately leaves out: the
// exact weight, the number of positions, the account the numbers were read
// from. The card is for pride; this row is for checking.

export function cardFacts(
  profile: WalletProfile | null,
  age: PositionAge | null,
  label: string | null,
  networkPositions: number | null,
  privacy?: { hideName: boolean; hideAmount: boolean },
): CardFacts {
  return {
    name: label || (profile ? shortAddress(profile.wallet) : 'not connected'),
    days: age?.days ?? null,
    exactDays: age?.exact ?? false,
    firstSeenAt: age?.firstSeenAt ?? null,
    positionSkr: profile?.found ? profile.totals.activeStaked : null,
    networkPositions,
    hideName: privacy?.hideName ?? false,
    hideAmount: privacy?.hideAmount ?? false,
  };
}

export function StakerCard({ profile, age, share, claimed, name, networkPositions, fallback, width, privacy }: {
  profile: WalletProfile | null;
  age: PositionAge | null;
  share: number | null;
  claimed: boolean;
  name?: string | null;
  networkPositions: number | null;
  // The last card this phone drew. Shown while the live one is still on its
  // way, so a cold start never has a hole where the card belongs.
  fallback?: CardFacts | null;
  width: number;
  privacy?: { hideName: boolean; hideAmount: boolean };
}) {
  // Merged field by field rather than card-or-card. The profile comes back in
  // under a second and the age takes several, so an all-or-nothing swap makes
  // the day count appear, vanish, and appear again — which looks like a fault
  // in the number itself. Anything the live read has not answered yet keeps
  // showing what it said last time.
  const live = cardFacts(profile, age, name ?? null, networkPositions, privacy);
  const facts: CardFacts = fallback
    ? {
        name: profile ? live.name : fallback.name,
        days: live.days ?? fallback.days,
        exactDays: live.days != null ? live.exactDays : fallback.exactDays,
        firstSeenAt: live.firstSeenAt ?? fallback.firstSeenAt,
        positionSkr: live.positionSkr ?? fallback.positionSkr,
        networkPositions: live.networkPositions ?? fallback.networkPositions,
        hideName: live.hideName,
        hideAmount: live.hideAmount,
      }
    : live;

  return (
    <View style={styles.card}>
      {/* Drawn edge to edge with no frame of our own: the card is a photograph
          of an object, and a border around it would turn the object back into a
          picture of an object. */}
      <View style={[styles.art, { width: width + BLEED * 2, height: Math.round((width + BLEED * 2) * frameRatio(TIGHT_FRAME)) }]}>
        <CardArt facts={facts} width={width + BLEED * 2} frame={TIGHT_FRAME} />
      </View>

      <View style={styles.body}>
        {/* Nothing is said here while the remembered card is standing in. The
            card above is already showing this person their own numbers, and a
            line under it asking them to connect a wallet contradicts what they
            are looking at. The tab below already offers the connect button for
            anyone who really has no session. */}
        {!claimed && fallback ? null : claimed ? (
          <View style={styles.stats}>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>{t('WEIGHT')}</Text>
              <Text style={styles.statValue}>{share != null ? `${share < 0.001 ? share.toFixed(5) : share.toFixed(3)}%` : '—'}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>{t('POSITIONS')}</Text>
              <Text style={styles.statValue}>{profile ? integer(profile.totals.positions) : '—'}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>{t('READ FROM')}</Text>
              <Text style={styles.statMono}>{profile?.positions?.[0]?.stakeAccount ? shortAddress(profile.positions[0].stakeAccount) : '—'}</Text>
            </View>
          </View>
        ) : (
          null
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20 },
  // The card steps out past the screen's own padding so only a hair of
  // background is left at its sides. Everything else on this tab is a panel and
  // wants the margin; the card is an object and wants the room.
  art: { alignSelf: 'center', marginHorizontal: -BLEED },
  body: { paddingTop: spacing.lg, paddingHorizontal: spacing.xs },
  empty: { color: colors.muted, fontFamily: font.regular, fontSize: 15, lineHeight: 21 },
  stats: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.lg },
  stat: { gap: 3 },
  statLabel: { color: colors.muted, fontFamily: font.semibold, fontSize: 10.5, letterSpacing: 1 },
  statValue: { color: colors.text, fontFamily: font.semibold, fontSize: 16, fontVariant: ['tabular-nums'] },
  statMono: { color: colors.text, fontFamily: font.mono, ...type.micro, fontSize: 13 },
});
