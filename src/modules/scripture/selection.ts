/** Verse selection inside the reader: one verse or a contiguous range within one chapter. */

export interface Selection {
  chapter: number;
  /** The verse the selection was started from; Shift-click extends from here. */
  anchor: number;
  from: number;
  to: number;
}

/**
 * The selection after the user activates a verse number.
 * - Nothing selected, or a different chapter: select just that verse.
 * - A single verse is selected: clicking it again clears; clicking another makes a range.
 * - A range is selected: clicking starts a new single selection (Shift extends instead).
 */
export function nextSelection(
  previous: Selection | null,
  chapter: number,
  verse: number,
  extend: boolean,
): Selection | null {
  if (previous && previous.chapter === chapter) {
    const range = {
      chapter,
      anchor: previous.anchor,
      from: Math.min(previous.anchor, verse),
      to: Math.max(previous.anchor, verse),
    };
    if (extend) return range;
    if (previous.from === previous.to) return previous.from === verse ? null : range;
  }
  return { chapter, anchor: verse, from: verse, to: verse };
}
