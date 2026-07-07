/**
 * @Erwähnungen (Phase 9). Wegen E2EE kann NUR der Client Erwähnungen erkennen –
 * der Server sieht ausschließlich Ciphertext. Erkannt wird nach dem
 * Entschlüsseln per Textsuche über die bekannten Benutzernamen des Kanals.
 * Benutzernamen bestehen aus [a-zA-Z0-9_.] (Register-Validierung), das Muster
 * ist also eindeutig tokenisierbar.
 */

const MENTION_PATTERN = /@([a-zA-Z0-9_.]+)/g;

/** Zerlegt Text in Roh- und Erwähnungs-Segmente (fürs Hervorheben in der UI). */
export interface TextSegment {
  text: string;
  /** Benutzername ohne @, wenn das Segment eine bekannte Erwähnung ist. */
  mention: string | null;
}

export function splitMentions(text: string, knownUsernames: string[]): TextSegment[] {
  const known = new Set(knownUsernames.map((u) => u.toLowerCase()));
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const username = match[1];
    if (!known.has(username.toLowerCase())) continue;
    if (match.index > last) segments.push({ text: text.slice(last, match.index), mention: null });
    segments.push({ text: match[0], mention: username });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), mention: null });
  return segments;
}

/** Wird `username` im Text erwähnt? (case-insensitiv, wie bei Discord üblich) */
export function mentionsUser(text: string, username: string): boolean {
  const wanted = username.toLowerCase();
  for (const match of text.matchAll(MENTION_PATTERN)) {
    if (match[1].toLowerCase() === wanted) return true;
  }
  return false;
}
