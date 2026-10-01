import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { t } from '../../i18n';
import { colors, font, spacing, type } from '../../theme';
import type { EyeNetwork, NetworkEye } from '../api';
import { Ascent } from '../Ascent';
import { AroundYou } from './AroundYou';
import { FindEye } from './FindEye';
import { MassWorld } from './MassWorld';
import { aroundYou, irisLayout, toWorldEyes, type IrisWorld } from './geometry';

// The world of the Eyes tab. Up to thirty Eyes it is the Ascent: big round
// glowing eyes on a stair, each with its .skr name under it, the thing that
// read so well while the network was small. From thirty-one it becomes the
// Iris: the same network as one eye made of eyes, with "Around you" for the
// names near yours and Find for anyone else (01.10, Alex: at five hundred
// the stair showed thirty-six people). Both open the same Eye card.
export const IRIS_FROM = 31;

export function World({ network, meSerial, pulses, onPick }: {
  network: EyeNetwork | null;
  meSerial: number | null;
  pulses: Record<number, number>;
  onPick: (eye: NetworkEye) => void;
}) {
  const many = (network?.eyes.length ?? 0) >= IRIS_FROM;
  if (!network || !many) {
    return (
      <>
        <Ascent network={network} meSerial={meSerial} pulses={pulses} onPick={onPick} />
        <Text style={styles.hint}>{t('A Blink a day climbs one step. Tap an Eye to see it.')}</Text>
      </>
    );
  }
  return <IrisBlock network={network} meSerial={meSerial} pulses={pulses} onPick={onPick} />;
}

function IrisBlock({ network, meSerial, pulses, onPick }: { network: EyeNetwork; meSerial: number | null; pulses: Record<number, number>; onPick: (eye: NetworkEye) => void }) {
  const eyes = useMemo(() => toWorldEyes(network.eyes, meSerial), [network.eyes, meSerial]);
  // Places depend only on who is here and their streaks, never on who is
  // awake: a Blink relights an Eye and moves nobody, so a fresh read with the
  // same people does not lay the world out again.
  const places = useMemo(() => eyes.map((eye) => `${eye.serial}:${eye.streak}`).join(','), [eyes]);
  const base = useMemo<IrisWorld>(() => irisLayout(eyes), [places]); // eslint-disable-line react-hooks/exhaustive-deps
  const world = useMemo<IrisWorld>(() => {
    const now = new Map(eyes.map((eye) => [eye.serial, eye]));
    return { ...base, items: base.items.map((it) => ({ ...it, eye: now.get(it.eye.serial) ?? it.eye })) };
  }, [base, eyes]);
  const around = useMemo(() => aroundYou(eyes, world.counts), [eyes, world.counts]);
  const bySerial = useMemo(() => new Map(network.eyes.map((eye) => [eye.serial, eye])), [network.eyes]);
  const arcs = useMemo(() => network.gazes.received.map((look) => look.serial), [network.gazes.received]);

  // An Eye rung on the picture: while a chip is pressed, and for a few seconds after somebody was
  // picked from a list. Picking from a list also flies the world to them (the camera brings them
  // up close), then opens their card; closing the card leaves you looking at them.
  const [highlight, setHighlight] = useState<number | null>(null);
  const [fly, setFly] = useState<{ serial: number; nonce: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const hold = useCallback((serial: number | null) => { if (timer.current) clearTimeout(timer.current); setHighlight(serial); }, []);
  const pick = useCallback((serial: number) => { const eye = bySerial.get(serial); if (eye) onPick(eye); }, [bySerial, onPick]);
  const focus = useCallback((serial: number) => {
    setHighlight(serial);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHighlight(null), 6_000);
    setFly((current) => ({ serial, nonce: (current?.nonce ?? 0) + 1 }));
    pick(serial);
  }, [pick]);

  return (
    <View style={styles.block}>
      <MassWorld world={world} eyes={eyes} pulses={pulses} arcs={arcs} highlight={highlight} fly={fly} onPick={pick} />
      <Text style={styles.hint}>{t('Every Blink carries you a step closer to the pupil.')}</Text>
      <Text style={styles.hint}>{t('Pinch to zoom, drag to look around, twist to turn. Touch and hold to read names.')}</Text>
      {around ? <AroundYou around={around} onPick={focus} onHold={hold} /> : null}
      <FindEye eyes={eyes} onPick={focus} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  hint: { color: colors.faint, fontFamily: font.regular, ...type.micro, textAlign: 'center', paddingHorizontal: spacing.sm, marginTop: -4 },
});
