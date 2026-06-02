// Right-to-left helpers for plain-text Telegram posts.
//
// These bots post Arabic (and other RTL) text with NO parse_mode — Arabic
// du'a/Quran punctuation contains characters Markdown/HTML parsing would reject
// with a 400, so plain text is the only safe choice. But plain text means the
// HTML dir="rtl" trick is unavailable, so we lean on Unicode's own bidi isolates
// (UAX #9) to pin a line's direction and wall it off from neighbouring text.

/** Unicode bidi isolates (UAX #9). */
const LRI = '⁦'; // LEFT-TO-RIGHT ISOLATE
const RLI = '⁧'; // RIGHT-TO-LEFT ISOLATE
const FSI = '⁨'; // FIRST-STRONG ISOLATE
const PDI = '⁩'; // POP DIRECTIONAL ISOLATE

/**
 * Wrap a line in a right-to-left bidi isolate (RLI…PDI). Use this for text you
 * KNOW is RTL (Arabic content). The isolate pins the line right-to-left and
 * walls it off from anything Telegram appends to it — e.g. the vote %/count it
 * adds to each poll option, which otherwise renders over a leading emoji. Pairs
 * with keeping any emoji at the END of the string.
 */
export function rtlIsolate(text: string): string {
  return `${RLI}${text}${PDI}`;
}

/** Wrap a line in a left-to-right bidi isolate (LRI…PDI). The mirror of
 *  rtlIsolate for text you know is LTR. */
export function ltrIsolate(text: string): string {
  return `${LRI}${text}${PDI}`;
}

/**
 * Wrap a line in a first-strong isolate (FSI…PDI): the renderer infers the
 * direction from the first strongly-directional character in the text. Use this
 * when the direction is unknown or mixed (e.g. a user-supplied string), so each
 * line lays out by its own content and never leaks direction into its
 * neighbours.
 */
export function autoIsolate(text: string): string {
  return `${FSI}${text}${PDI}`;
}
