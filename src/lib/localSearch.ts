/** Tolerant local matching: case/diacritic-insensitive, ignores punctuation,
 *  matches when every query word appears as a prefix-or-substring of some title word. */

export function normalizeLocalText(value: string): string {
  const withoutDiacritics = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return withoutDiacritics
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchesLocalQuery(title: string, query: string): boolean {
  const haystack = normalizeLocalText(title).split(' ').filter(Boolean);
  const needles = normalizeLocalText(query).split(' ').filter(Boolean);
  if (!needles.length) return true;
  if (!haystack.length) return false;
  return needles.every((needle) => haystack.some((word) => word.includes(needle)));
}

function levenshtein(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return rows[a.length][b.length];
}

/** "Did you mean" over a small candidate corpus (trending + library titles). */
export function suggestCorrection(query: string, candidates: readonly string[]): string | undefined {
  const normalized = normalizeLocalText(query);
  // Pasted novels are not search queries. The cap keeps the edit-distance
  // matrix small, so a huge paste can never stall the results screen.
  if (!normalized || normalized.length < 3 || normalized.length > 80) return undefined;
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const words = normalizeLocalText(candidate).split(' ').filter(Boolean);
    for (const word of words) {
      if (Math.abs(word.length - normalized.length) > 3) continue;
      const distance = levenshtein(normalized, word);
      if (distance > 0 && distance <= 2 && distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    if (normalizeLocalText(candidate) === normalized) return undefined;
  }
  return best;
}
