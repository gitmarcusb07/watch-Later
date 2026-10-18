import { Image, StyleSheet, View } from 'react-native';
import type { CreatorBranding, CreatorSlide, CreatorTitleRef } from '@/domain/models/creator';
import type { CreatorPalette } from '../palette';
import { BrandMark, RatingBadge, SlidePoster, SlideText, joinMeta } from '../primitives';
import { formatScore, mediaTypeLabel } from '@/features/creator/slideText';

/**
 * The stacked list: up to five rows, one title each. Each row carries the
 * title's own artwork as a soft blurred tint behind a poster thumb, the title
 * and a meta line, a year chip, and honest rating badges — the yellow IMDb
 * pill only when a real matched score exists, otherwise the TMDb star. A
 * filled subtitle renders as the big display line (the "2017" of a
 * year-by-year carousel); without one, the headline itself is the display.
 */
export function StackedRankingSlide({ slide, palette, showBranding, branding }: {
  slide: CreatorSlide;
  palette: CreatorPalette;
  showBranding: boolean;
  branding: CreatorBranding;
}) {
  const refs = slide.titleRefs.slice(0, 5);
  const headline = slide.headline.trim().toUpperCase() || 'MOST WATCHED';
  const display = slide.subtitle.trim();
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        {display ? (
          <>
            <SlideText style={[styles.kicker, { color: palette.accent.primary }]} numberOfLines={1}>{headline}</SlideText>
            <SlideText style={[styles.display, { color: palette.text }]} numberOfLines={1} adjustsFontSizeToFit>{display}</SlideText>
          </>
        ) : (
          <SlideText style={[styles.headline, { color: palette.text }]} numberOfLines={1} adjustsFontSizeToFit>{headline}</SlideText>
        )}
      </View>
      {refs.length ? (
        <View style={styles.rows}>
          {refs.map((ref) => (
            <Row key={`${ref.provider}:${ref.mediaType}:${ref.providerId}`} refItem={ref} slide={slide} />
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <SlideText style={[styles.emptyText, { color: palette.textMuted }]}>Add up to 5 titles to build this stack</SlideText>
        </View>
      )}
      <View style={styles.footer}>
        {showBranding ? <BrandMark palette={palette} label={branding.name} /> : <View />}
        {slide.closing.trim() ? <SlideText style={styles.closing} numberOfLines={1}>{slide.closing.trim()}</SlideText> : null}
      </View>
    </View>
  );
}

function Row({ refItem, slide }: { refItem: CreatorTitleRef; slide: CreatorSlide }) {
  const year = refItem.year ? String(refItem.year) : undefined;
  const imdb = slide.showRating ? formatScore(refItem.imdbRating) : undefined;
  const score = slide.showRating ? formatScore(refItem.rating) : undefined;
  const meta = joinMeta([
    mediaTypeLabel(refItem),
    slide.showGenres ? refItem.genres[0] : undefined,
  ]);
  // The title's own artwork as a soft blurred tint behind a poster thumb: a
  // full-bleed crop of a wide backdrop clips faces at row height (the old
  // look), while a bare poster leaves dead space — the blur bridges both.
  const tint = refItem.backdropUrl ?? refItem.posterUrl;
  return (
    <View style={styles.row}>
      {tint ? (
        <>
          <Image source={{ uri: tint }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={14} />
          <View style={styles.rowShade} pointerEvents="none" />
        </>
      ) : null}
      <View style={styles.rowContent}>
        <SlidePoster uri={refItem.posterUrl ?? refItem.backdropUrl} title={refItem.title} radius={7} style={styles.rowPoster} />
        <View style={styles.rowText}>
          <SlideText style={styles.rowTitle} numberOfLines={2} adjustsFontSizeToFit>{refItem.title}</SlideText>
          {meta ? <SlideText style={styles.rowMeta} numberOfLines={1}>{meta}</SlideText> : null}
        </View>
        <View style={styles.rowBadges}>
          {year && slide.showReleaseDate ? (
            <View style={styles.yearChip}>
              <SlideText style={styles.yearText}>{year}</SlideText>
            </View>
          ) : null}
          {imdb || score ? (
            <View style={styles.badgeRow}>
              {imdb ? <RatingBadge variant="imdb" value={imdb} /> : null}
              {score ? <RatingBadge variant="score" value={score} /> : null}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 14, paddingTop: 16, paddingBottom: 12 },
  header: { paddingHorizontal: 4, gap: 1, marginBottom: 10 },
  kicker: { fontSize: 11, lineHeight: 14, fontWeight: '800', letterSpacing: 2.2 },
  display: { fontSize: 30, lineHeight: 34, fontWeight: '900', letterSpacing: 0.2 },
  headline: { fontSize: 25, lineHeight: 29, fontWeight: '800', letterSpacing: 0.4 },
  rows: { flex: 1, gap: 6 },
  row: { flex: 1, minHeight: 0, borderRadius: 12, overflow: 'hidden', backgroundColor: '#241F36' },
  rowShade: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(20,14,34,0.78)' },
  rowContent: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, gap: 9 },
  rowPoster: { width: 32, height: 48 },
  rowText: { flex: 1, minWidth: 0, gap: 1 },
  rowTitle: { fontSize: 14, lineHeight: 16.5, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.1 },
  rowMeta: { fontSize: 9.5, lineHeight: 12, fontWeight: '600', color: 'rgba(255,255,255,0.72)', letterSpacing: 0.4 },
  rowBadges: { alignItems: 'flex-end', gap: 4 },
  yearChip: { borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', paddingHorizontal: 6, paddingVertical: 2 },
  yearText: { fontSize: 9.5, lineHeight: 12, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.6 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  emptyText: { fontSize: 11.5, lineHeight: 16, textAlign: 'center' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 8, minHeight: 14 },
  closing: { fontSize: 10, lineHeight: 13, fontWeight: '600', letterSpacing: 0.3, color: 'rgba(255,255,255,0.55)', flexShrink: 1 },
});
