export interface StripFit {
  topVisible: number;
  bottomVisible: number;
  overflow: boolean;
}

/**
 * Decides how many icons of each strip group fit in `heightPx` so the groups never overlap.
 * The gap between groups is always kept; when space runs out a ⋯ slot is reserved, the top group
 * gives up icons first, and the bottom group keeps at least one icon while there's room for it.
 */
export function fitStrip(counts: { top: number; bottom: number }, heightPx: number, itemPx = 32, gapPx = 16): StripFit {
  const total = counts.top + counts.bottom;
  const room = Math.max(0, heightPx - gapPx);
  if (total * itemPx <= room) return { topVisible: counts.top, bottomVisible: counts.bottom, overflow: false };

  let slots = Math.max(0, Math.floor(room / itemPx) - 1); // one slot for ⋯
  const bottomVisible = Math.min(counts.bottom, slots > 0 ? 1 : 0) + Math.max(0, Math.min(counts.bottom - 1, slots - 1 - counts.top));
  slots -= bottomVisible;
  const topVisible = Math.max(0, Math.min(counts.top, slots));
  return { topVisible, bottomVisible, overflow: true };
}
