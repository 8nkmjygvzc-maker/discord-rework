import { MAX_EMBEDS_PER_MESSAGE } from '@parley/shared';
import type { LinkEmbed, UnfurlResponse } from '@parley/shared';
import { splitLinks } from './links';
import { useAuthStore } from '../store/auth';

/**
 * Gesamt-Deckel, damit ein langsamer/hängender Host den Versand nicht blockiert.
 * Jeder Server-Unfurl hat sein eigenes 5-s-Zeitlimit; hier zusätzlich ein Deckel
 * über ALLE parallelen Abrufe. Läuft er ab, wird ohne Karte(n) gesendet.
 */
const OVERALL_TIMEOUT_MS = 6_000;

/** Eindeutige http(s)-URLs aus dem Text (in Reihenfolge, gedeckelt). */
export function extractUrls(text: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const segment of splitLinks(text)) {
    if (segment.href && !seen.has(segment.href)) {
      seen.add(segment.href);
      urls.push(segment.href);
      if (urls.length >= MAX_EMBEDS_PER_MESSAGE) break;
    }
  }
  return urls;
}

/**
 * Holt Vorschau-Karten für die Links im Text (automatisch beim Senden). Der
 * Server holt die Metadaten (Browser-CORS erlaubt den fremden HTML-Abruf nicht,
 * und der Server-Proxy schützt zugleich die IP des Absenders). Best-effort:
 * Fehler/Timeouts liefern einfach keine Karte, ohne den Versand zu blockieren.
 */
export async function buildEmbeds(text: string): Promise<LinkEmbed[]> {
  const urls = extractUrls(text);
  if (urls.length === 0) return [];
  const authFetch = useAuthStore.getState().authFetch;

  const fetches = urls.map(async (url): Promise<LinkEmbed | null> => {
    try {
      const res = await authFetch<UnfurlResponse>('/api/unfurl', {
        method: 'POST',
        body: { url },
      });
      return res.embed;
    } catch {
      return null;
    }
  });

  const timeout = new Promise<(LinkEmbed | null)[]>((resolve) => {
    setTimeout(() => resolve([]), OVERALL_TIMEOUT_MS);
  });

  const settled = await Promise.race([Promise.all(fetches), timeout]);
  return settled.filter((embed): embed is LinkEmbed => embed !== null);
}
