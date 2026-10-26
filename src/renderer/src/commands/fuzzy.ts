const WORD_START_BONUS = 10;
const CONSECUTIVE_BONUS = 5;

/**
 * Case-insensitive subsequence match. Returns null when `query` doesn't match `text`.
 * Characters at the start of a word score highest, then characters that follow the previous match.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return 0;
  const t = text.toLowerCase();
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const ch of q) {
    const index = t.indexOf(ch, from);
    if (index === -1) return null;
    const wordStart = index === 0 || /[\s\-_./]/.test(t[index - 1]);
    score += 1 + (wordStart ? WORD_START_BONUS : 0) + (index === previous + 1 ? CONSECUTIVE_BONUS : 0);
    previous = index;
    from = index + 1;
  }
  return score;
}
