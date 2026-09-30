import { memo, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../../i18n';
import { integer } from '../../format';
import { colors, font, radius, spacing, type } from '../../theme';
import { Button, Eyebrow } from '../../lab/kit';
import { MiniEye } from './AroundYou';
import type { WorldEye } from './geometry';

// Five hundred tiny Eyes cannot be read by a finger alone, and nobody can be
// found by looking. So: a name typed, the Eyes that match, and the one picked
// is rung on the Iris and opened. Yours always heads the list.

const MAX_SHOWN = 40;

export const FindEye = memo(function FindEye({ eyes, onPick }: { eyes: WorldEye[]; onPick: (serial: number) => void }) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\.skr$/, '');
    const pool = q ? eyes.filter((eye) => eye.name.toLowerCase().includes(q)) : eyes;
    return [...pool].sort((a, b) => Number(b.me) - Number(a.me) || a.rank - b.rank).slice(0, MAX_SHOWN);
  }, [eyes, query]);
  const close = () => { setOpen(false); setQuery(''); };
  return (
    <>
      <Button label={t('Find an Eye')} ghost onPress={() => setOpen(true)} />
      <Modal visible={open} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
        <View style={[styles.screen, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.head}>
            <Eyebrow>{t('Find an Eye')}</Eyebrow>
            <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('Close')}>
              <Text style={styles.close}>{t('Close')}</Text>
            </Pressable>
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('Type a name, like kosa.skr')}
            placeholderTextColor={colors.dim}
            selectionColor={colors.accent}
            style={styles.input}
            maxFontSizeMultiplier={1.3}
          />
          <FlatList
            data={rows}
            keyExtractor={(eye) => String(eye.serial)}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<Text style={styles.empty}>{t('No Eye by that name')}</Text>}
            renderItem={({ item }) => (
              <Pressable onPress={() => { close(); onPick(item.serial); }} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="button">
                <MiniEye awake={item.awake} mine={item.me} w={30} />
                <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={[styles.name, item.me && styles.nameMe]}>{item.name}</Text>
                <Text maxFontSizeMultiplier={1.3} style={styles.days}>{item.streak === 1 ? t('1 day') : t('{count} days', { count: integer(item.streak) })}</Text>
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.panelSolid, paddingHorizontal: spacing.lg, gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { color: colors.accent, fontFamily: font.semibold, ...type.body },
  input: { color: colors.text, fontFamily: font.medium, fontSize: 17, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.button, paddingHorizontal: spacing.md, paddingVertical: 10, backgroundColor: colors.inset },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(21, 33, 44, 0.6)' },
  pressed: { opacity: 0.7 },
  name: { flex: 1, color: colors.text, fontFamily: font.medium, fontSize: 15, lineHeight: 20 },
  nameMe: { color: colors.metal, fontFamily: font.semibold },
  days: { color: colors.muted, fontFamily: font.medium, fontSize: 13.5, fontVariant: ['tabular-nums'] },
  empty: { color: colors.faint, fontFamily: font.regular, ...type.body, textAlign: 'center', paddingVertical: spacing.xl },
});
