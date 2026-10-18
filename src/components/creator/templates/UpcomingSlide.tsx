import { StyleSheet, View } from 'react-native';
import type { CreatorBranding, CreatorSlide, CreatorTitleRef } from '@/domain/models/creator';
import type { CreatorPalette } from '../palette';
import { BrandMark, SlidePoster, SlideText, joinMeta } from '../primitives';
import { mediaTypeLabel, rowMeta, splitSlideDate } from '@/features/creator/slideText';

/**
 * Dated upcoming releases. Every date comes from the provider snapshot; a
 * missing date reads "TBA" — the template never guesses a window.
 */
export function UpcomingSlide({ slide, palette, showBranding, branding }: { slide: CreatorSlide; palette: CreatorPalette; showBranding: boolean; branding: CreatorBranding }) {
  const refs = slide.titleRefs.slice(0, 5);
  const subtitle = slide.subtitle.trim();
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <SlideText style={[styles.heading, { color: palette.text }]} numberOfLines={1} adjustsFontSizeToFit>{slide.headline.trim() || 'COMING SOON'}</SlideText>
        {subtitle ? <SlideText style={[styles.subheading, { color: palette.textSecondary }]} numberOfLines={1}>{subtitle}</SlideText> : null}
      </View>
      {refs.length ? (
        <View style={styles.rows}>
          {refs.map((ref) => <ReleaseRow key={`${ref.provider}:${ref.providerId}`} refItem={ref} slide={slide} palette={palette} />)}
        </View>
      ) : (
        <View style={styles.empty}>
          <SlideText style={[styles.emptyText, { color: palette.textMuted }]}>Add upcoming titles to build this countdown</SlideText>
        </View>
      )}
      <View style={styles.footer}>
        {slide.closing ? <SlideText style={[styles.closing, { color: palette.accent.primary }]} numberOfLines={1}>{slide.closing}</SlideText> : null}
        {showBranding ? <BrandMark palette={palette} label={branding.name} /> : null}
      </View>
    </View>
  );
}

function ReleaseRow({ refItem, slide, palette }: { refItem: CreatorTitleRef; slide: CreatorSlide; palette: CreatorPalette }) {
  const date = splitSlideDate(refItem.releaseDate);
  // The pill carries day + month (and weekday); the meta line carries the
  // year — a full date the pill could never fit.
  const meta = joinMeta([mediaTypeLabel(refItem), rowMeta(refItem, slide)]);
  return (
    <View style={styles.row}>
      <View style={[styles.datePill, { backgroundColor: palette.accentSoft }]}>
        {date ? (
          <>
            {date.weekday ? <SlideText style={[styles.dateWeekday, { color: palette.accent.primary }]} numberOfLines={1}>{date.weekday}</SlideText> : null}
            <SlideText style={[styles.dateTop, { color: palette.accent.primary }]} numberOfLines={1}>{date.top}</SlideText>
            <SlideText style={[styles.dateBottom, { color: palette.accent.primary }]} numberOfLines={1}>{date.bottom}</SlideText>
          </>
        ) : (
          <SlideText style={[styles.dateTba, { color: palette.textMuted }]} numberOfLines={1}>TBA</SlideText>
        )}
      </View>
      <SlidePoster uri={refItem.posterUrl} title={refItem.title} style={styles.poster} radius={7} />
      <View style={styles.stack}>
        <SlideText style={[styles.title, { color: palette.text }]} numberOfLines={2}>{refItem.title}</SlideText>
        {meta ? <SlideText style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>{meta}</SlideText> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14 },
  header: { gap: 3, marginBottom: 10 },
  heading: { fontSize: 24, lineHeight: 28, fontWeight: '800', letterSpacing: 0.5 },
  subheading: { fontSize: 11, lineHeight: 14, fontWeight: '500' },
  rows: { flex: 1, gap: 7, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  datePill: { width: 42, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  dateWeekday: { fontSize: 7.5, lineHeight: 9, fontWeight: '800', letterSpacing: 1.1, opacity: 0.85 },
  dateTop: { fontSize: 15, lineHeight: 17, fontWeight: '800' },
  dateBottom: { fontSize: 8, lineHeight: 10, fontWeight: '700', letterSpacing: 1.2 },
  dateTba: { fontSize: 10, lineHeight: 12, fontWeight: '700', letterSpacing: 0.6 },
  poster: { width: 33, height: 49.5 },
  stack: { flex: 1, minWidth: 0, gap: 1 },
  title: { fontSize: 13, lineHeight: 16, fontWeight: '700' },
  meta: { fontSize: 9.5, lineHeight: 12, fontWeight: '500' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  emptyText: { fontSize: 11.5, lineHeight: 16, textAlign: 'center' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, minHeight: 14 },
  closing: { fontSize: 10.5, lineHeight: 13, fontWeight: '700', letterSpacing: 0.4, flexShrink: 1 },
});
