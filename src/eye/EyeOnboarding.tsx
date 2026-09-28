import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { t } from '../i18n';
import { integer, shortAddress } from '../format';
import { useReducedMotion } from '../useReducedMotion';
import { Button } from '../lab/kit';
import { colors, font, radius, spacing } from '../theme';
import { fetchEyeHealth, type Eye, type EyePrices, type EyeStatus } from './api';
import { EYE_FINGER_ENABLED } from './config';
import { cooldownHours, leftAtPrice, rentOf, sol, usd } from './money';
import { eyeCaption } from './shareEye';
import { Glyph, Overline, type GlyphName } from './glyphs';
import { Awakening, BlinkDial, Blueprint, Breath, CardShare, IrisClimb, NightSky, OpeningRoad, cue, note, schedule, tick } from './OnboardingArt';
import { PortalEye } from './PortalEye';

// The Eye, before it is opened: seven pages that make a person want one and
// leave nothing later a surprise.
//
// DESIGN DIRECTION
//
// The story. A person is told, in this order: what the Eye is; what in their
// Seeker makes it possible; the exact road they will walk to open it; the
// one habit that keeps it; where they stand among the others; that it is a
// card they can post; and what this wallet already has and what it costs.
//
//   01 · The idea         Every Seeker carries an Eye. The living Eye wakes
//                         (two heartbeats, the lids part, the wake note), its
//                         number rises under it, and the others come out of
//                         the dark round it: a network keeping watch.
//   02 · Inside your      Built into your Seeker. A blueprint cutaway of the
//        Seeker           phone: the key in the StrongBox secure element
//                         under the fingerprint, the Seed Vault wallet, the Seeker
//                         Genesis Token, and Google's attestation chain up
//                         to its root. Each part lights on its own note and
//                         a leader line is drawn to one short line of what it
//                         guarantees. With the finger off (the store build)
//                         the page shows only what that build uses: the
//                         wallet, the Genesis Token and Solana.
//   03 · How it opens     The exact road, in order and by name: once, Verify
//                         my Seeker (Vault key, Seeker, Genesis Token,
//                         Verified); then Open my Eye (Finger, Wallet,
//                         Network, Eye opens). The same stations the real
//                         stepper draws, each with the same glyph, turning
//                         one after another until the lids part.
//   04 · The Blink        Blink every eight hours. The dial of the day round
//                         the Eye, a hand walking it, the Eye blinking at the
//                         end of each rest and the three numbers a Blink
//                         rewrites on Solana moving under it. A tap tries one.
//   05 · The Iris         One of many, move inward. The nine rings with the
//                         streak each stands for, the network blinking round
//                         the pupil, your Eye stepping ring by ring to the
//                         centre and turning gold at thirty days. Live counts.
//   06 · Your card        The Eye is a card. A sample card the server's own
//                         renderer drew (bundled, so it is never somebody
//                         else's Eye), then the post it becomes on X with the
//                         app's own caption, and the button that sends it,
//                         drawn as part of the picture.
//   07 · Ready            What this wallet has (wallet, Genesis Token, SKR
//                         position, the finger), the price to the lamport
//                         with the tier ladder, the one button.
//
// The visual language is the NFT card's night: stars, two curtains of
// aurora, the horizon, the sea catching the light, the cyan of the portal
// ring (#56E0FF) and the gold of the iris (#C9A96A) on near-black. Thin,
// precise line work in one stroke weight; glow as radial light, never as a
// box shadow; one overline in mono at the top of every page saying where in
// the sequence the person is, a seven-segment progress bar under it, a
// headline, at most two short sentences, and the rest in the picture and its
// labels. Everything is SVG and reanimated on the UI thread; Skia is not
// linked into this app.
//
// Sound and touch, sparingly. The pad (`hum`) once, when the walk-through
// first appears. Each page arrives on its own soft glass note, tone1 to
// tone7, a rising scale; the lights on a page continue up the scale from
// the page's note. Two heartbeats and the wake note when the lids part
// (pages one and three), with the heaviest touch the phone has. The chime
// where a real step lands (page three), because that is the sound the real
// stepper makes. The wink on every Blink (page four). A selection tick on
// every ring climbed and a chime at Perfect (page five). All of it through
// `ritual`, which follows the app's own switches for sound and vibration,
// and none of it runs for a person who asked the phone for less motion:
// they get every page still, in its finished state.
//
// Nothing is promised that the app does not do. The steps on page three are
// the sheet's own (MoveSheet.tsx, WitnessWalkthrough.tsx); the rings on page
// five are the Iris's (irisSceneHtml.ts); the caption on page six is the one
// shareEye.ts writes; the prices on page seven are the server's.

const PAGES = 7;

const pad = (serial: number) => `EYE #${String(serial).padStart(4, '0')}`;

// ------------------------------------------------------------------ ready --

function Check({ icon, state, label, detail, index, active }: { icon: GlyphName; state: 'yes' | 'no' | 'wait' | 'later'; label: string; detail?: string | null; index: number; active: boolean }) {
  const tone = state === 'yes' ? colors.positive : state === 'no' ? colors.negative : colors.faint;
  return (
    <Animated.View key={active ? 'on' : 'off'} entering={active ? FadeInDown.delay(250 + index * 220).duration(380) : undefined} style={styles.check}>
      <View style={[styles.checkIcon, state === 'yes' && styles.checkIconYes, state === 'no' && styles.checkIconNo]}>
        <Glyph name={icon} size={18} tone={state === 'yes' ? colors.accent : state === 'no' ? colors.negative : colors.dim} />
      </View>
      <View style={styles.checkText}>
        <Text maxFontSizeMultiplier={1.25} style={styles.checkLabel}>{label}</Text>
        {detail ? <Text maxFontSizeMultiplier={1.25} style={styles.checkDetail}>{detail}</Text> : null}
      </View>
      <View style={styles.checkMark}>
        {state === 'wait' ? <ActivityIndicator size="small" color={colors.faint} /> : (
          <Svg width={22} height={22} viewBox="0 0 22 22">
            {state === 'yes' ? <Circle cx={11} cy={11} r={10} fill={colors.positive} /> : null}
            {state === 'yes' ? <Path d="M6.5 11.3 9.6 14.4 15.6 8.2" fill="none" stroke={colors.bg} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" /> : null}
            {state === 'no' ? <Circle cx={11} cy={11} r={9.5} fill="none" stroke={tone} strokeWidth={1.8} /> : null}
            {state === 'no' ? <Path d="M7.5 7.5l7 7M14.5 7.5l-7 7" fill="none" stroke={tone} strokeWidth={2} strokeLinecap="round" /> : null}
            {state === 'later' ? <Circle cx={11} cy={11} r={3} fill={colors.dim} /> : null}
          </Svg>
        )}
      </View>
    </Animated.View>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text maxFontSizeMultiplier={1.25} style={[styles.rowLabel, strong && styles.rowStrong]}>{label}</Text>
      <Text maxFontSizeMultiplier={1.25} style={[styles.rowValue, strong && styles.rowStrong]}>{value}</Text>
    </View>
  );
}

// Where the price steps up, drawn: the first tier lit, the next one dim, and
// a mark where the next Eye will land.
function Ladder({ tier, open, nextSerial, left }: { tier: { serial: number; afterLamports: number }; open: number; nextSerial: number | null; left: number | null }) {
  const at = nextSerial != null ? Math.max(0.02, Math.min(0.98, nextSerial / Math.max(1, tier.serial))) : null;
  return (
    <View style={styles.ladder}>
      <View style={styles.ladderBar}>
        <View style={styles.ladderTier}>
          {at != null ? <View style={[styles.ladderYou, { left: `${at * 100}%` }]} /> : null}
        </View>
        <View style={styles.ladderNext} />
      </View>
      <View style={styles.ladderRow}>
        <View style={styles.ladderCell}>
          <Text maxFontSizeMultiplier={1.2} style={styles.ladderText}>{t('#1 to #{last}', { last: integer(tier.serial) })}</Text>
          <Text maxFontSizeMultiplier={1.2} style={styles.ladderPrice}>{`${sol(open)} SOL`}</Text>
          {left != null ? <Text maxFontSizeMultiplier={1.2} style={styles.ladderNote}>{t('{count} left at this price', { count: integer(left) })}</Text> : null}
        </View>
        <View style={[styles.ladderCell, styles.ladderCellRight]}>
          <Text maxFontSizeMultiplier={1.2} style={[styles.ladderText, styles.ladderDim]}>{t('From #{first}', { first: integer(tier.serial + 1) })}</Text>
          <Text maxFontSizeMultiplier={1.2} style={[styles.ladderPrice, styles.ladderDim]}>{`${sol(tier.afterLamports)} SOL`}</Text>
        </View>
      </View>
    </View>
  );
}

// ------------------------------------------------------------------- pager --

export function EyeOnboarding({
  wallet,
  status,
  nextSerial,
  verified,
  connecting,
  connectError,
  onConnect,
  onOpen,
  onClose,
  watching = null,
  blinkedToday = null,
}: {
  // How many Eyes are open and how many blinked today, as the Iris says.
  watching?: number | null;
  blinkedToday?: number | null;
  wallet: string | null;
  status: EyeStatus | null;
  // The number the next Eye will carry, from the Iris's count; null while unknown.
  nextSerial: number | null;
  // Whether this phone has already been through the Seeker walk-through.
  verified: boolean;
  connecting: boolean;
  connectError: string | null;
  onConnect: () => void;
  // The last page's button: close this and start the open.
  onOpen: () => void;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const [height, setHeight] = useState(0);
  const reduced = useReducedMotion();
  const pager = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const finger = EYE_FINGER_ENABLED;
  // Prices come with the wallet's status; before a wallet, from the service's health.
  const [health, setHealth] = useState<EyePrices | null>(null);
  useEffect(() => {
    let live = true;
    void fetchEyeHealth().then((answer) => { if (live && answer.prices) setHealth(answer.prices); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const prices: EyePrices | null = status?.prices ?? health;

  // The pad once, as the walk-through appears; then every page on its own note.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      cue('hum', 0.25);
      return schedule([[420, () => note(1, 0.3)]]);
    }
    return schedule([[120, () => note(page + 1, 0.3)]]);
  }, [page]);

  const go = (next: number) => {
    const target = Math.max(0, Math.min(PAGES - 1, next));
    pager.current?.scrollTo({ x: target * width, animated: !reduced });
    setPage(target);
    tick();
  };

  const onScrolled = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width));
    if (next !== page) { setPage(next); tick(); }
  };

  const onLayout = (event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height);

  // The pictures take a little over a third of the screen, never more than
  // the width allows; the text under them scrolls if a large font needs it.
  const inner = width - spacing.lg * 2;
  const stage = Math.min(320, inner);
  const art = height > 0 ? Math.max(220, Math.min(stage, Math.round(height * 0.37))) : Math.min(stage, 270);
  const serial = nextSerial != null ? pad(nextSerial) : null;
  const hours = cooldownHours(prices, status?.blink?.cooldownSeconds);
  const slots = Math.max(1, Math.round(24 / Math.max(1, hours)));
  const solUsd = prices?.solUsd ?? null;
  const blinkUsd = prices ? usd(prices.blinkLamports, solUsd) : null;
  const blinkPrice = prices ? `${sol(prices.blinkLamports)} SOL${blinkUsd ? ` ≈ ${blinkUsd}` : ''}` : null;

  // The card on page six is the bundled sample (EYE #0042, streak 7, 9
  // blinks); the caption under it is the one the app writes for that Eye
  // after its seventh day, so the post matches the card.
  const caption = useMemo(() => {
    const eye: Eye = { serial: 42, asset: '', name: pad(42), openedAt: '', streak: 7, blinks: 9, lastBlinkDay: null, image: '', json: '', perfect: [] };
    return eyeCaption(eye, 'blink');
  }, []);

  // The last page, worked out for this wallet.
  const gates = status?.gates ?? null;
  const hasEye = Boolean(status?.eye);
  const open = prices?.openLamports ?? null;
  const rent = rentOf(prices);
  const total = open != null ? open + rent : null;
  const left = leftAtPrice(prices, nextSerial);
  const tier = prices?.tier ?? null;
  const staked = gates?.staked;
  const blocked = Boolean(status && !hasEye && (gates?.staked === false || gates?.sgt === false));
  const ready = page === PAGES - 1;

  // The checks that pass light on their notes as the last page arrives.
  const passes = [Boolean(wallet), Boolean(wallet && status && gates?.sgt), Boolean(wallet && status && staked), finger ? verified : false].filter(Boolean).length;
  useEffect(() => {
    if (!ready || reduced || passes === 0) return;
    return schedule(Array.from({ length: passes }, (_, k) => [420 + k * 240, () => note(4 + k, 0.22)]));
  }, [ready, reduced, passes]);

  let action: { label: string; onPress?: () => void; disabled?: boolean };
  if (!wallet) action = { label: connecting ? t('Connecting…') : t('Connect Solana Mobile'), onPress: onConnect, disabled: connecting };
  else if (!status) action = { label: t('Reading your Eye…'), disabled: true };
  else if (hasEye) action = { label: t('See my Eye'), onPress: onClose };
  else if (gates?.staked === false) action = { label: t('Needs an active SKR position'), disabled: true };
  else if (gates?.sgt === false) action = { label: t('Needs a Seeker Genesis Token'), disabled: true };
  else action = { label: finger && !verified ? t('Verify my Seeker') : t('Open my Eye'), onPress: onOpen };

  const pages: Array<{ key: string; overline: string; title: string; body: string; art: ReactElement; foot?: ReactElement | null }> = [
    {
      key: 'idea',
      overline: t('The idea'),
      title: t('Every Seeker\ncarries an Eye'),
      body: t('An NFT minted on Solana into your wallet: one per wallet, numbered in the order Eyes open. Your number is yours forever.'),
      art: <Awakening active={page === 0} reduced={reduced} serial={serial} width={inner} size={art} />,
      foot: watching != null ? (
        <Text maxFontSizeMultiplier={1.25} style={styles.caption}>
          {watching <= 0
            ? t('Be one of the first.')
            : watching === 1
              ? t('1 Eye is already open. Be one of the first.')
              : t('{count} Eyes are already open. A network of Seekers keeping watch.', { count: integer(watching) })}
        </Text>
      ) : null,
    },
    {
      key: 'seeker',
      overline: t('Inside your Seeker'),
      title: t('Your Seeker\nis the key'),
      body: finger
        ? t('No passwords, no forms. Your Seeker’s secure hardware, your fingerprint and your wallet do the proving.')
        : t('No passwords, no forms. Your Seeker wallet and its Genesis Token do the proving.'),
      art: <Blueprint active={page === 1} reduced={reduced} width={inner} height={Math.min(350, Math.round(art * 1.25))} finger={finger} noteFrom={2} />,
    },
    {
      key: 'open',
      overline: t('How it opens'),
      title: t('How your Eye\nis minted'),
      body: finger
        ? t('Your Seeker proves itself once. Then one button: your finger, your wallet, Solana, and the lids part.')
        : t('One button: your wallet approves and pays, Solana mints it, and the lids part.'),
      art: <OpeningRoad active={page === 2} reduced={reduced} width={inner} finger={finger} />,
    },
    {
      key: 'blink',
      overline: t('The Blink'),
      title: t('Blink every {hours} hours', { hours }),
      body: t('One Blink a day keeps your streak alive; every Blink is written on Solana into your Eye. Miss a day and the streak starts over.'),
      art: <BlinkDial active={page === 3} reduced={reduced} size={Math.round(art * 0.92)} slots={slots} hours={hours} />,
      foot: (
        <View style={styles.footBlock}>
          {blinkPrice ? <Text maxFontSizeMultiplier={1.25} style={styles.caption}>{`${blinkPrice} · ${t('every {hours} hours', { hours })}`}</Text> : null}
          <Text maxFontSizeMultiplier={1.25} numberOfLines={1} style={styles.captionDim}>{t('Tap the Eye to try a Blink')}</Text>
        </View>
      ),
    },
    {
      key: 'iris',
      overline: t('The Iris'),
      title: t('One of many.\nMove inward.'),
      body: t('The longer your streak, the closer your Eye sits to the centre. Thirty days unbroken and it turns gold; miss one and you start again from the edge.'),
      art: <IrisClimb active={page === 4} reduced={reduced} size={Math.min(330, inner, Math.round(art * 1.1))} />,
      foot: watching != null && watching > 0 ? (
        <Text maxFontSizeMultiplier={1.25} style={styles.caption}>
          {[
            watching === 1 ? t('1 Eye is watching') : t('{count} Eyes are watching', { count: integer(watching) }),
            blinkedToday != null && blinkedToday > 0 ? t('{count} blinked today', { count: integer(blinkedToday) }) : null,
          ].filter(Boolean).join(' · ')}
        </Text>
      ) : null,
    },
    {
      key: 'card',
      overline: t('Your card'),
      title: t('Your Eye is a card'),
      body: t('Redrawn after every Blink with your number on it. After the mint and every Blink, one button posts it to X, caption ready.'),
      art: <CardShare active={page === 5} reduced={reduced} width={inner} caption={caption} />,
    },
  ];

  const overline = ready ? t('Ready') : pages[page]?.overline ?? '';

  return (
    <View style={styles.screen} onLayout={onLayout}>
      <NightSky width={width} height={Math.max(height, 400)} still={reduced} />
      <View style={styles.top}>
        <View style={styles.topText}>
          <Overline>{`${String(page + 1).padStart(2, '0')} · ${overline}`}</Overline>
          <View style={styles.bars}>
            {Array.from({ length: PAGES }, (_, index) => (
              <Pressable key={index} onPress={() => go(index)} style={styles.barHit} accessibilityRole="button" accessibilityLabel={`${index + 1} / ${PAGES}`}>
                <View style={[styles.bar, { backgroundColor: index <= page ? colors.accent : 'rgba(120, 200, 230, 0.16)', opacity: index === page ? 1 : index < page ? 0.5 : 1 }]} />
              </Pressable>
            ))}
          </View>
        </View>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
          <Text maxFontSizeMultiplier={1.2} style={styles.skip}>{ready ? t('Close') : t('Skip')}</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrolled}
        style={styles.pager}
      >
        {pages.map((item, index) => (
          <ScrollView key={item.key} style={{ width }} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
            <View style={styles.art}>{item.art}</View>
            {item.foot ?? null}
            {page === index ? (
              <>
                <Animated.Text maxFontSizeMultiplier={1.15} entering={reduced ? undefined : FadeInDown.delay(180).duration(420)} style={styles.title}>{item.title}</Animated.Text>
                <Animated.Text maxFontSizeMultiplier={1.2} entering={reduced ? undefined : FadeInDown.delay(420).duration(420)} style={styles.body}>{item.body}</Animated.Text>
              </>
            ) : (
              <>
                <Text maxFontSizeMultiplier={1.15} style={styles.title}>{item.title}</Text>
                <Text maxFontSizeMultiplier={1.2} style={styles.body}>{item.body}</Text>
              </>
            )}
          </ScrollView>
        ))}

        <ScrollView style={{ width }} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
          <View style={styles.readyHead}>
            <View style={styles.readyEye}>
              <Breath size={84} still={reduced} />
              <PortalEye size={88} open={hasEye} instant />
            </View>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.25} style={styles.titleLeft}>{hasEye ? t('Your Eye is open') : t('Only a Seeker can mint an Eye')}</Text>
              {serial && !hasEye ? <Text maxFontSizeMultiplier={1.2} style={styles.serialLeft}>{t('Next number: {serial}', { serial })}</Text> : null}
            </View>
          </View>

          <View style={styles.card}>
            <Overline tone={colors.faint}>{t('This wallet')}</Overline>
            <Check
              index={0}
              icon="wallet"
              active={ready}
              state={wallet ? 'yes' : 'later'}
              label={t('Wallet connected')}
              detail={wallet ? shortAddress(wallet) : t('Read only. Nothing is signed here.')}
            />
            <Check
              index={1}
              icon="token"
              active={ready}
              state={!wallet ? 'later' : !status ? 'wait' : gates?.sgt ? 'yes' : gates?.sgt === false ? 'no' : 'later'}
              label={t('Seeker Genesis Token')}
              detail={!wallet ? t('Proves this phone is a Seeker') : gates?.sgt === false ? t('Not found in this wallet') : gates?.sgt ? t('Found in your wallet') : null}
            />
            <Check
              index={2}
              icon="skr"
              active={ready}
              state={!wallet ? 'later' : !status ? 'wait' : staked ? 'yes' : staked === false ? 'no' : 'later'}
              label={t('Staked SKR')}
              detail={!wallet ? t('You need SKR in staking') : staked && gates?.activeStaked ? `${integer(Number(gates.activeStaked))} SKR` : staked === false ? t('No active SKR position') : null}
            />
            {finger ? (
              <Check
                index={3}
                icon="finger"
                active={ready}
                state={verified ? 'yes' : 'later'}
                label={t('Fingerprint on this Seeker')}
                detail={verified ? t('Already verified on this phone.') : t('Checked in the next step')}
              />
            ) : null}
          </View>

          {open != null && total != null ? (
            <View style={styles.card}>
              <Overline tone={colors.faint}>{t('The mint')}</Overline>
              <Row label={t('Opening fee')} value={`${sol(open)} SOL`} />
              <Row label={t('Deposit kept inside your Eye')} value={`≈ ${sol(rent)} SOL`} />
              <View style={styles.rule} />
              <Row label={t('Total')} value={`≈ ${sol(total)} SOL${usd(total, solUsd) ? ` · ${usd(total, solUsd)}` : ''}`} strong />
              {tier ? <Ladder tier={tier} open={open} nextSerial={nextSerial} left={left} /> : null}
              <View style={styles.rule} />
              {blinkPrice ? <Row label={t('Blink')} value={`${blinkPrice} · ${t('every {hours} hours', { hours })}`} /> : null}
              <Text maxFontSizeMultiplier={1.25} style={styles.micro}>{t('The first Blink is included in the mint.')}</Text>
            </View>
          ) : (
            <View style={styles.card}><ActivityIndicator size="small" color={colors.faint} /></View>
          )}

          <Text maxFontSizeMultiplier={1.25} style={styles.fine}>{t('The opening fee and every Blink go to the maker of SKR Eyes. The deposit stays inside your Eye, in your wallet. No token is sold here.')}</Text>
          {connectError ? <Text maxFontSizeMultiplier={1.25} style={styles.error}>{connectError}</Text> : null}
          {blocked ? <Text maxFontSizeMultiplier={1.25} style={styles.fine}>{t('An Eye opens for a wallet on a Seeker with an active SKR position.')}</Text> : null}
        </ScrollView>
      </ScrollView>

      <View style={styles.bottom}>
        {!ready ? (
          <Button label={t('Next')} onPress={() => go(page + 1)} hero />
        ) : (
          <Animated.View entering={reduced ? undefined : FadeIn.duration(200)} style={styles.bottomStack}>
            <Button label={action.label} onPress={action.onPress} disabled={action.disabled} hero />
            {!hasEye ? <Button label={t('Later')} onPress={onClose} quiet /> : null}
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#03060A' },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs },
  topText: { flex: 1, gap: 6 },
  bars: { flexDirection: 'row', gap: 5 },
  barHit: { flex: 1, paddingVertical: 6 },
  bar: { height: 3, borderRadius: 2 },
  skip: { color: colors.muted, fontFamily: font.medium, fontSize: 15, paddingTop: 1 },
  pager: { flex: 1 },
  page: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: spacing.sm },
  art: { alignItems: 'center', justifyContent: 'center' },
  footBlock: { gap: 2 },
  caption: { color: colors.text, fontFamily: font.semibold, fontSize: 16, lineHeight: 22, textAlign: 'center', fontVariant: ['tabular-nums'] },
  captionDim: { color: colors.muted, fontFamily: font.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  title: { color: colors.text, fontFamily: font.bold, fontSize: 29, lineHeight: 35, letterSpacing: -0.8, textAlign: 'center', marginTop: spacing.sm },
  titleLeft: { color: colors.text, fontFamily: font.bold, fontSize: 26, lineHeight: 31, letterSpacing: -0.6 },
  body: { color: '#A9BDCE', fontFamily: font.regular, fontSize: 17, lineHeight: 25, textAlign: 'center', paddingHorizontal: spacing.xs },
  serialLeft: { color: colors.metal, fontFamily: font.monoSemibold, fontSize: 14, letterSpacing: 1.4, marginTop: 3 },
  readyHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  readyEye: { width: 88, height: 88, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: 'rgba(10, 16, 23, 0.88)', borderRadius: radius.card, borderWidth: 1, borderColor: '#13212C', padding: spacing.md, gap: spacing.md },
  check: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  checkIcon: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.line, backgroundColor: 'rgba(6, 12, 18, 0.9)', alignItems: 'center', justifyContent: 'center' },
  checkIconYes: { borderColor: colors.accentDim, backgroundColor: 'rgba(86, 224, 255, 0.08)' },
  checkIconNo: { borderColor: 'rgba(255, 126, 121, 0.5)' },
  checkText: { flex: 1, gap: 1 },
  checkLabel: { color: colors.text, fontFamily: font.semibold, fontSize: 16, lineHeight: 21 },
  checkDetail: { color: '#8FA6B9', fontFamily: font.regular, fontSize: 14, lineHeight: 19, fontVariant: ['tabular-nums'] },
  checkMark: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  rowLabel: { color: colors.muted, fontFamily: font.regular, fontSize: 15.5, lineHeight: 21, flexShrink: 1 },
  rowValue: { color: colors.text, fontFamily: font.medium, fontSize: 15.5, lineHeight: 21, fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right' },
  rowStrong: { color: colors.text, fontFamily: font.bold },
  rule: { height: 1, backgroundColor: colors.line },
  ladder: { gap: spacing.sm, paddingTop: spacing.xs },
  ladderBar: { flexDirection: 'row', gap: 3, height: 6 },
  ladderTier: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.accentDim, overflow: 'visible' },
  ladderYou: { position: 'absolute', top: -3, marginLeft: -6, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accent, borderWidth: 2, borderColor: '#0A1017' },
  ladderNext: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.line },
  ladderRow: { flexDirection: 'row', gap: spacing.md },
  ladderCell: { flex: 1, gap: 1 },
  ladderCellRight: { alignItems: 'flex-end' },
  ladderText: { color: colors.muted, fontFamily: font.regular, fontSize: 13.5, lineHeight: 18, fontVariant: ['tabular-nums'] },
  ladderPrice: { color: colors.text, fontFamily: font.semibold, fontSize: 14.5, lineHeight: 19, fontVariant: ['tabular-nums'] },
  ladderNote: { color: colors.accent, fontFamily: font.medium, fontSize: 13, lineHeight: 18, fontVariant: ['tabular-nums'] },
  ladderDim: { color: colors.faint },
  micro: { color: colors.faint, fontFamily: font.regular, fontSize: 13, lineHeight: 18 },
  fine: { color: '#8FA6B9', fontFamily: font.regular, fontSize: 14, lineHeight: 20, textAlign: 'center', paddingHorizontal: spacing.sm },
  error: { color: colors.negative, fontFamily: font.medium, fontSize: 14.5, textAlign: 'center' },
  bottom: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  bottomStack: { gap: spacing.xs },
});
