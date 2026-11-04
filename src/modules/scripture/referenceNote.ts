/**
 * Connecting Scripture to the user's own notes.
 *
 * A note stores a Scripture reference as ordinary text on its own line:
 *
 *     Scripture reference: Revelation 13:18 (WEB)
 *
 * No new database column and no change to the notes feature: the reference is just text the
 * user can see, edit or delete. The Scripture text itself is never copied into the note, so
 * what the user writes stays visibly separate from what the Bible says, and BEACON never adds
 * commentary of its own.
 */

export const REFERENCE_PREFIX = 'Scripture reference: ';
export const NOTES_PROMPT = 'My notes:';

/** The most references surfaced as links for one note. */
const MAX_LINKS = 20;

export interface NoteSeed {
  title: string;
  body: string;
}

export function buildReferenceNote(canonical: string, translationAbbreviation: string): NoteSeed {
  return {
    title: canonical,
    body: `${REFERENCE_PREFIX}${canonical} (${translationAbbreviation})\n\n${NOTES_PROMPT}\n`,
  };
}

const REFERENCE_LINE =
  /^Scripture reference: ([A-Za-z0-9 .:-]{1,100}?) \([A-Za-z0-9]{1,12}\)[ \t]*\r?$/gm;

/** References written in the `Scripture reference: … (WEB)` form, in order, without repeats. */
export function extractReferences(body: string): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(REFERENCE_LINE)) {
    const reference = (match[1] as string).trim();
    if (!found.includes(reference)) found.push(reference);
    if (found.length >= MAX_LINKS) break;
  }
  return found;
}
