/**
 * Erkennung von http(s)-Links im Nachrichtentext (Feinschliff). Bewusst nur
 * explizite `http://`/`https://`-Schemata – kein „www."-Raten und keine
 * anderen Protokolle, damit z. B. `javascript:`-URLs schon auf Parser-Ebene
 * ausgeschlossen sind.
 */

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

/** Satzzeichen, die typischerweise NACH einem Link stehen (nicht Teil der URL). */
const TRAILING_PUNCTUATION = /[.,;:!?…]+$/;

export interface LinkSegment {
  text: string;
  /** Ziel-URL, wenn das Segment ein Link ist, sonst null. */
  href: string | null;
}

function countChar(text: string, char: string): number {
  let count = 0;
  for (const c of text) if (c === char) count += 1;
  return count;
}

/** Zerlegt Text in Roh- und Link-Segmente (fürs Rendern als <a> in der UI). */
export function splitLinks(text: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    let url = match[0];
    // „Siehe https://beispiel.de.“ – das Satzende gehört nicht zur URL.
    url = url.replace(TRAILING_PUNCTUATION, '');
    // Schließende Klammern nur behalten, solange sie in der URL ausbalanciert
    // sind: `/wiki/Foo_(Bar)` bleibt ganz, bei „(siehe https://x.de)“ fällt
    // die Satzklammer weg. Danach evtl. freigelegte Satzzeichen erneut kappen.
    while (url.endsWith(')') && countChar(url, ')') > countChar(url, '(')) {
      url = url.slice(0, -1).replace(TRAILING_PUNCTUATION, '');
    }
    // Nur das nackte Schema („https://“) ist kein Link.
    if (!/^https?:\/\/./i.test(url)) continue;
    if (match.index > last) segments.push({ text: text.slice(last, match.index), href: null });
    segments.push({ text: url, href: url });
    last = match.index + url.length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), href: null });
  return segments;
}
