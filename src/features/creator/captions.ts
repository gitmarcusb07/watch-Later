import type { CreatorFormat, CreatorTemplateId, CreatorTitleRef } from '@/domain/models/creator';

export interface CaptionSuggestion {
  label: string;
  text: string;
}

export interface CaptionInput {
  templateId: CreatorTemplateId;
  format: CreatorFormat;
  titleRefs: CreatorTitleRef[];
}

/**
 * Rule-based caption + hashtag suggestions. Fully offline and deterministic:
 * no AI key, no network, and no invented facts — title names, years, and
 * dates come straight from the snapshots on the slides.
 */

function yearSuffix(ref: CreatorTitleRef): string {
  return ref.year ? ` (${ref.year})` : '';
}

function quote(title: string): string {
  return `“${title}”`;
}

function numberedLines(refs: CreatorTitleRef[]): string {
  return refs.map((ref, index) => `${index + 1}. ${ref.title}${yearSuffix(ref)}`).join('\n');
}

function datedLines(refs: CreatorTitleRef[]): string {
  return refs.map((ref) => `• ${ref.title}${ref.releaseDate ? ` — ${ref.releaseDate}` : ''}`).join('\n');
}

/** Up to three caption starters for the project, tailored to its template. */
export function suggestCaptions(input: CaptionInput): CaptionSuggestion[] {
  const refs = input.titleRefs;
  const first = refs[0];
  const second = refs[1];
  const count = refs.length;
  const suggestions: CaptionSuggestion[] = [];

  switch (input.templateId) {
    case 'movie-spotlight':
      if (first) {
        suggestions.push({ label: 'Tonight’s pick', text: `Movie night sorted 🎬 ${quote(first.title)}${yearSuffix(first)} is the one.` });
      }
      suggestions.push({ label: 'Short & clean', text: 'One movie. Zero decisions. 🍿 Save this for tonight.' });
      break;
    case 'series-spotlight':
      if (first) {
        suggestions.push({ label: 'Binge mode', text: `Currently binging ${quote(first.title)} 📺 One more episode won’t hurt… right?` });
      }
      suggestions.push({ label: 'Weekend plan', text: 'Weekend plans: cancelled. Series queued. 📺' });
      break;
    case 'top5':
      suggestions.push({
        label: 'Ranked five',
        text: `My top 5 right now — how many have you seen? 🏆\n\n${numberedLines(refs)}`,
      });
      suggestions.push({ label: 'Debate bait', text: 'Five picks, zero regrets. Tell me what I got wrong 👇' });
      break;
    case 'stacked-ranking':
      suggestions.push({
        label: 'The stack',
        text: count
          ? `The stack right now — how many have you seen? 🏆\n\n${numberedLines(refs)}`
          : 'The stack right now — how many have you seen? 🏆',
      });
      suggestions.push({ label: 'Debate bait', text: 'All of these, in this order. Tell me what I got wrong 👇' });
      break;
    case 'collage-cover':
      suggestions.push({
        label: 'Cover post',
        text: count
          ? `The ones that defined the era — how many have you watched? 🎬\n\n${numberedLines(refs)}`
          : 'The ones that defined the era — how many have you watched? 🎬',
      });
      suggestions.push({ label: 'Swipe prompt', text: 'Swipe through — and tell me which one I missed 👇' });
      break;
    case 'page-promo':
      suggestions.push({ label: 'Follow call', text: 'Daily picks, zero filler. Follow so you never miss one 🍿' });
      suggestions.push({ label: 'Page intro', text: 'One page, every pick worth your night. Hit follow and stay for the lists 📌' });
      break;
    case 'movie-comparison':
      suggestions.push({
        label: 'Head to head',
        text: first && second
          ? `${quote(first.title)} or ${quote(second.title)}? Only one gets the crown tonight 🥊`
          : 'Two movies, one winner. You decide 🥊',
      });
      suggestions.push({ label: 'Poll starter', text: 'Comment 1 or 2 — I’m counting. 🥊' });
      break;
    case 'watchlist-collection':
      suggestions.push({
        label: 'Watchlist flex',
        text: `My watchlist is officially out of control 🍿 ${count} on deck and counting.`,
      });
      suggestions.push({ label: 'Queue check', text: 'Building the perfect watch queue. Which one should I start with? 👇' });
      break;
    case 'upcoming-releases':
      suggestions.push({
        label: 'Save the dates',
        text: `On the calendar and not missing a single one 📅\n\n${datedLines(refs)}`,
      });
      suggestions.push({ label: 'Hype post', text: 'These releases are coming for my sleep schedule 📅 Save this so you don’t miss them.' });
      break;
  }
  return suggestions.filter((suggestion) => suggestion.text.trim().length > 0).slice(0, 3);
}

/** Hashtags from the project's actual metadata. Deduped, keyed off real genres. */
export function suggestHashtags(refs: CreatorTitleRef[]): string[] {
  const tags: string[] = ['#WatchLater', '#NowWatching'];
  const hasMovie = refs.some((ref) => ref.mediaType === 'movie');
  const hasSeries = refs.some((ref) => ref.mediaType !== 'movie');
  if (hasMovie) tags.push('#MovieNight');
  if (hasSeries) tags.push('#SeriesBinge');
  const genreTags = refs
    .flatMap((ref) => ref.genres)
    .map((genre) => `#${genre.replace(/[^A-Za-z0-9]/g, '')}`)
    .filter((tag) => tag.length > 1);
  const seen = new Set(tags.map((tag) => tag.toLowerCase()));
  for (const tag of genreTags) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 10) break;
  }
  return tags;
}

/** Joins a caption body with hashtags, keeping the blank separator tidy. */
export function composeCaption(text: string, hashtags: string[]): string {
  const body = text.trim();
  const tags = hashtags.join(' ').trim();
  if (body && tags) return `${body}\n\n${tags}`;
  return body || tags;
}
