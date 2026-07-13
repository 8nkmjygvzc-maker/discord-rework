import { Injectable, Logger } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  LinkEmbed,
  MAX_EMBED_DESCRIPTION_LENGTH,
  MAX_EMBED_SITENAME_LENGTH,
  MAX_EMBED_TITLE_LENGTH,
} from '@parley/shared';

/** Obergrenzen für den Seitenabruf – gegen Missbrauch (Speicher/Zeit/SSRF). */
const FETCH_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 512 * 1024;
const UNFURL_USER_AGENT = 'ParleyBot/1.0 (+link-preview)';

/**
 * Link-Vorschau (Unfurl, Feinschliff). Holt die OpenGraph-/HTML-Metadaten
 * einer verlinkten Seite SERVERSEITIG, weil der Browser fremdes HTML wegen
 * CORS nicht lesen darf. Der Absender ruft das beim Senden einmal auf und legt
 * das Ergebnis in den E2EE-Klartext – der Server sieht die URL nur hier
 * transient (nichts wird gespeichert).
 *
 * SSRF-Schutz ist zwingend: Der Server würde sonst zu jedem beliebigen (auch
 * internen) Ziel Requests stellen. Deshalb: nur http(s), nur Standard-Ports,
 * DNS-Auflösung + Sperre privater/reservierter IPs, jede Weiterleitung wird
 * erneut geprüft, begrenzte Redirect-Zahl und begrenzte Antwortgröße.
 */
@Injectable()
export class UnfurlService {
  private readonly logger = new Logger(UnfurlService.name);

  /** Holt die Vorschau oder null (unerreichbar/kein HTML/nichts Brauchbares). */
  async unfurl(rawUrl: string): Promise<LinkEmbed | null> {
    const fetched = await this.safeFetch(rawUrl);
    if (!fetched) return null;
    return this.parseEmbed(fetched.finalUrl, fetched.html);
  }

  /**
   * Lädt die Seite SSRF-sicher: prüft Protokoll/Port/Ziel-IP vor jedem Hop,
   * folgt Weiterleitungen manuell (damit auch das Redirect-Ziel geprüft wird)
   * und liest den Body nur bis MAX_HTML_BYTES.
   */
  private async safeFetch(rawUrl: string): Promise<{ finalUrl: string; html: string } | null> {
    let current = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let url: URL;
      try {
        url = new URL(current);
      } catch {
        return null;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      // Nur Standard-Ports – exotische Ports sind ein SSRF-Hebel gegen interne
      // Dienste (z. B. Datenbanken, Metadaten-Endpunkte).
      if (url.port !== '' && url.port !== '80' && url.port !== '443') return null;
      if (!(await this.hostIsPublic(url.hostname))) {
        this.logger.warn(`Unfurl blockiert (nicht-öffentliches Ziel): ${url.hostname}`);
        return null;
      }

      let res: Response;
      try {
        res = await fetch(url, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: {
            'user-agent': UNFURL_USER_AGENT,
            accept: 'text/html,application/xhtml+xml',
            'accept-language': 'en,de;q=0.8',
          },
        });
      } catch {
        return null;
      }

      // Weiterleitung: Ziel auflösen und in der nächsten Runde erneut prüfen.
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) return null;
        try {
          current = new URL(location, url).href;
        } catch {
          return null;
        }
        continue;
      }

      if (res.status !== 200) return null;
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.toLowerCase().includes('text/html')) return null;
      const html = await this.readCapped(res);
      return { finalUrl: url.href, html };
    }
    return null; // zu viele Weiterleitungen
  }

  /** Liest den Response-Body als UTF-8, aber höchstens MAX_HTML_BYTES. */
  private async readCapped(res: Response): Promise<string> {
    const reader = res.body?.getReader();
    if (!reader) return '';
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(Buffer.from(value));
          total += value.byteLength;
          if (total >= MAX_HTML_BYTES) {
            await reader.cancel();
            break;
          }
        }
      }
    } catch {
      // Abbruch/Netzfehler mitten im Lesen → mit dem bisher Gelesenen weiter.
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  /** Ist der Host öffentlich erreichbar (kein privates/reserviertes Netz)? */
  private async hostIsPublic(hostname: string): Promise<boolean> {
    // IPv6-Literale kommen aus URL.hostname mit eckigen Klammern („[::1]").
    const host = hostname.replace(/^\[|\]$/g, '');
    if (isIP(host)) return !isPrivateIp(host);
    let results: { address: string }[];
    try {
      results = await lookup(host, { all: true });
    } catch {
      return false;
    }
    if (results.length === 0) return false;
    // ALLE aufgelösten Adressen müssen öffentlich sein (kein Split-Horizon-Trick).
    return results.every((r) => !isPrivateIp(r.address));
  }

  /** Baut aus dem HTML die Vorschau-Karte (OpenGraph, Fallback <title>/meta). */
  private parseEmbed(finalUrl: string, html: string): LinkEmbed | null {
    const meta = extractMeta(html);
    const title = clip(
      meta.get('og:title') ?? meta.get('twitter:title') ?? extractTitle(html),
      MAX_EMBED_TITLE_LENGTH,
    );
    const description = clip(
      meta.get('og:description') ?? meta.get('twitter:description') ?? meta.get('description'),
      MAX_EMBED_DESCRIPTION_LENGTH,
    );
    const siteName = clip(meta.get('og:site_name'), MAX_EMBED_SITENAME_LENGTH);
    const rawImage =
      meta.get('og:image') ??
      meta.get('og:image:url') ??
      meta.get('twitter:image') ??
      meta.get('twitter:image:src');
    const imageUrl = resolveImage(rawImage, finalUrl);

    if (!title && !description && !imageUrl) return null;
    const embed: LinkEmbed = { url: finalUrl };
    if (title) embed.title = title;
    if (description) embed.description = description;
    if (siteName) embed.siteName = siteName;
    if (imageUrl) embed.imageUrl = imageUrl;
    return embed;
  }
}

// --- SSRF: private/reservierte IP-Bereiche -------------------------------------

/** Sicherheitshalber blocken, was nicht sauber als öffentliche IP durchgeht. */
function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return true;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // this/private/loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24 (test)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51) return true; // 198.51.100/24 (test)
  if (a === 203 && b === 0) return true; // 203.0.113/24 (test)
  if (a >= 224) return true; // multicast + reserviert + 255.255.255.255
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0]; // Zone-Index abschneiden
  if (addr === '::1' || addr === '::') return true; // loopback/unspecified
  const mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]); // IPv4-mapped ::ffff:a.b.c.d
  const first = addr.split(':')[0];
  if (first.startsWith('fc') || first.startsWith('fd')) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(first)) return true; // fe80::/10 link-local
  return false;
}

// --- HTML-Extraktion (leichtgewichtig, ohne Parser-Abhängigkeit) ---------------

/** Sammelt <meta property|name=… content=…> als key→content (erster gewinnt). */
function extractMeta(html: string): Map<string, string> {
  const map = new Map<string, string>();
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const key = (attr(tag, 'property') ?? attr(tag, 'name'))?.toLowerCase();
    const content = attr(tag, 'content');
    if (key && content && !map.has(key)) map.set(key, decodeEntities(content));
  }
  return map;
}

/** Liest ein Attribut aus einem einzelnen Tag (", ' oder unquoted). */
function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'));
  if (!match) return null;
  return match[2] ?? match[3] ?? match[4] ?? null;
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(match[1].trim()) : undefined;
}

/** Bild-URL gegen die Seiten-URL auflösen; nur http(s) behalten. */
function resolveImage(raw: string | undefined, base: string): string | undefined {
  if (!raw) return undefined;
  let resolved: URL;
  try {
    resolved = new URL(decodeEntities(raw), base);
  } catch {
    return undefined;
  }
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return undefined;
  return resolved.href;
}

/** Die häufigsten HTML-Entities dekodieren (Titel/Beschreibung enthalten sie oft). */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&'); // zuletzt, sonst würde &amp;lt; falsch aufgelöst
}

function safeCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

function clip(value: string | undefined, maxLength: number): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}
