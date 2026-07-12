/**
 * @Erwähnungen (Phase 9, erweitert in der Verbesserungs-Runde um Rollen und
 * @everyone). Wegen E2EE kann NUR der Client Erwähnungen erkennen – der Server
 * sieht ausschließlich Ciphertext. Erkannt wird nach dem Entschlüsseln per
 * Textsuche über die bekannten Benutzer- und Rollennamen des Kanals.
 *
 * Benutzernamen bestehen aus [a-zA-Z0-9_.] (Register-Validierung); Rollennamen
 * sind frei (auch Leerzeichen) – deshalb wird nicht mehr per Regex tokenisiert,
 * sondern an jeder @-Stelle der LÄNGSTE bekannte Name gematcht (Wortgrenze
 * dahinter, damit „@ann“ nicht in „@anna“ feuert).
 */

export type MentionKind = 'user' | 'role' | 'everyone';

/** Bekannte Erwähnungs-Ziele eines Kanals. */
export interface MentionTargets {
  usernames: string[];
  /** Rollennamen OHNE die Standardrolle (dafür gibt es @everyone). */
  roleNames: string[];
  /** @everyone zulassen (false in DMs – dort gibt es kein „alle“). */
  everyone: boolean;
}

/** Zerlegt Text in Roh- und Erwähnungs-Segmente (fürs Hervorheben in der UI). */
export interface TextSegment {
  text: string;
  /** Gesetzt, wenn das Segment eine bekannte Erwähnung ist. */
  mention: { kind: MentionKind; name: string } | null;
}

/** Zeichen, die einen Namen fortsetzen würden (Grenze davor/dahinter nötig). */
const WORD_CHAR = /[\p{L}\p{N}_.]/u;

interface Candidate {
  name: string;
  lower: string;
  kind: MentionKind;
}

function buildCandidates(targets: MentionTargets): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const push = (name: string, kind: MentionKind) => {
    const lower = name.toLowerCase();
    const key = `${kind}|${lower}`;
    if (name.length === 0 || seen.has(key)) return;
    seen.add(key);
    out.push({ name, lower, kind });
  };
  if (targets.everyone) push('everyone', 'everyone');
  // Nutzer vor Rollen einfügen: bei gleich langem Namen gewinnt der Nutzer
  // (der gezieltere Ping); sort ist stabil.
  for (const username of targets.usernames) push(username, 'user');
  for (const roleName of targets.roleNames) push(roleName, 'role');
  return out.sort((a, b) => b.lower.length - a.lower.length);
}

interface FoundMention {
  /** Index des `@` im Text. */
  index: number;
  /** Länge inklusive `@`. */
  length: number;
  /** Kanonischer (bekannter) Name, nicht der ggf. anders groß geschriebene Text. */
  name: string;
  kind: MentionKind;
}

/** Alle bekannten Erwähnungen im Text (case-insensitiv, längster Name gewinnt). */
export function findMentions(text: string, targets: MentionTargets): FoundMention[] {
  const candidates = buildCandidates(targets);
  if (candidates.length === 0) return [];
  const lowerText = text.toLowerCase();
  const found: FoundMention[] = [];
  let i = 0;
  while ((i = text.indexOf('@', i)) !== -1) {
    // Grenze davor: „mail@example.com“ ist keine Erwähnung von „example“.
    if (i > 0 && WORD_CHAR.test(text[i - 1])) {
      i += 1;
      continue;
    }
    let matched: FoundMention | null = null;
    for (const candidate of candidates) {
      if (!lowerText.startsWith(candidate.lower, i + 1)) continue;
      const after = text[i + 1 + candidate.name.length];
      if (after !== undefined && WORD_CHAR.test(after)) continue;
      matched = {
        index: i,
        length: candidate.name.length + 1,
        name: candidate.name,
        kind: candidate.kind,
      };
      break;
    }
    if (matched) {
      found.push(matched);
      i += matched.length;
    } else {
      i += 1;
    }
  }
  return found;
}

export function splitMentions(text: string, targets: MentionTargets): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const m of findMentions(text, targets)) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index), mention: null });
    segments.push({
      text: text.slice(m.index, m.index + m.length),
      mention: { kind: m.kind, name: m.name },
    });
    last = m.index + m.length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), mention: null });
  return segments;
}

/**
 * Bin ICH gemeint? Direkt (@benutzername), über eine meiner Rollen oder über
 * @everyone (nur wenn `targets.everyone`). Für die gelbe Hervorhebung und
 * Benachrichtigungen.
 */
export function mentionsMember(
  text: string,
  targets: MentionTargets,
  username: string,
  myRoleNames: string[],
): boolean {
  const wantedUser = username.toLowerCase();
  const wantedRoles = new Set(myRoleNames.map((r) => r.toLowerCase()));
  for (const m of findMentions(text, targets)) {
    if (m.kind === 'everyone') return true;
    if (m.kind === 'user' && m.name.toLowerCase() === wantedUser) return true;
    if (m.kind === 'role' && wantedRoles.has(m.name.toLowerCase())) return true;
  }
  return false;
}

/** Wird `username` direkt im Text erwähnt? (DM-Fall ohne Rollen/@everyone) */
export function mentionsUser(text: string, username: string): boolean {
  return mentionsMember(
    text,
    { usernames: [username], roleNames: [], everyone: false },
    username,
    [],
  );
}
