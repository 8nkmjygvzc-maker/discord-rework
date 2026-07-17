/**
 * Erkennung bekannter Medien-Links (YouTube, Spotify) für abspielbare
 * Vorschauen à la Discord. Bewusst rein clientseitig und deterministisch:
 * Die Player-URL wird beim LESER aus der Nachricht-URL abgeleitet – es wird
 * nie eine absenderkontrollierte iframe-URL gerendert, nur die hier aus
 * geprüfter Video-/Track-ID zusammengebauten Adressen.
 */

export const SPOTIFY_KINDS = ['track', 'album', 'playlist', 'episode', 'show', 'artist'] as const;
export type SpotifyKind = (typeof SPOTIFY_KINDS)[number];

export type MediaEmbed =
  | { provider: 'youtube'; videoId: string; startSeconds: number | null }
  | { provider: 'spotify'; kind: SpotifyKind; id: string };

/** YouTube-Video-IDs sind exakt 11 Zeichen Base64-URL-Alphabet. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** Spotify-IDs sind 22 Zeichen Base62. */
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

/** Erkennt YouTube-/Spotify-Links; alles andere → null (generische Karte). */
export function detectMediaEmbed(rawUrl: string): MediaEmbed | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return parseYoutube(url) ?? parseSpotify(url);
}

/** Stabiler Schlüssel zum Deduplizieren (gleicher Link mehrfach im Text). */
export function mediaEmbedKey(media: MediaEmbed): string {
  return media.provider === 'youtube'
    ? `youtube:${media.videoId}`
    : `spotify:${media.kind}:${media.id}`;
}

// --- YouTube -------------------------------------------------------------------

function parseYoutube(url: URL): MediaEmbed | null {
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
  let videoId: string | null = null;
  if (host === 'youtu.be') {
    // https://youtu.be/<id>
    videoId = url.pathname.split('/')[1] ?? null;
  } else if (host === 'youtube.com' || host === 'music.youtube.com') {
    const [, first, second] = url.pathname.split('/');
    if (first === 'watch') videoId = url.searchParams.get('v');
    else if (first === 'shorts' || first === 'embed' || first === 'live') videoId = second ?? null;
  }
  if (!videoId || !YOUTUBE_ID.test(videoId)) return null;
  const start = parseStartTime(url.searchParams.get('t') ?? url.searchParams.get('start'));
  return { provider: 'youtube', videoId, startSeconds: start };
}

/** Startzeit aus `?t=` – als Sekunden („90") oder Dauer („1h2m3s"). */
function parseStartTime(raw: string | null): number | null {
  if (!raw) return null;
  if (/^\d+s?$/.test(raw)) return parseInt(raw, 10);
  const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

/** Vorschaubild – bei YouTube deterministisch aus der Video-ID ableitbar. */
export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * Player-URL (Klick auf Play). `youtube-nocookie.com` ist YouTubes offizielle
 * Embed-Domain mit reduziertem Tracking; autoplay, weil der Nutzer gerade
 * bewusst auf Play geklickt hat.
 */
export function youtubePlayerUrl(media: Extract<MediaEmbed, { provider: 'youtube' }>): string {
  const params = new URLSearchParams({ autoplay: '1' });
  if (media.startSeconds) params.set('start', String(media.startSeconds));
  return `https://www.youtube-nocookie.com/embed/${media.videoId}?${params}`;
}

// --- Spotify -------------------------------------------------------------------

function parseSpotify(url: URL): MediaEmbed | null {
  if (url.hostname.toLowerCase() !== 'open.spotify.com') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  // Lokalisierte Links haben ein Sprach-Präfix: /intl-de/track/<id>
  if (parts[0]?.startsWith('intl-')) parts.shift();
  // Bereits eingebettete Links (/embed/track/<id>) genauso akzeptieren.
  if (parts[0] === 'embed') parts.shift();
  const [kind, id] = parts;
  if (!(SPOTIFY_KINDS as readonly string[]).includes(kind ?? '')) return null;
  if (!id || !SPOTIFY_ID.test(id)) return null;
  return { provider: 'spotify', kind: kind as SpotifyKind, id };
}

/** Offizieller Spotify-Embed-Player zur erkannten Ressource. */
export function spotifyPlayerUrl(media: Extract<MediaEmbed, { provider: 'spotify' }>): string {
  return `https://open.spotify.com/embed/${media.kind}/${media.id}`;
}

/** Höhen laut Spotify-Embed: kompakt für Einzeltitel, groß für Listen. */
export function spotifyPlayerHeight(kind: SpotifyKind): number {
  return kind === 'track' || kind === 'episode' ? 152 : 352;
}
