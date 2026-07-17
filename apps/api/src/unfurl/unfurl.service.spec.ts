import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// DNS-Auflösung mocken (vi.hoisted, damit die Mock-Factory die Funktion kennt).
const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mockLookup }));

import { UnfurlService } from './unfurl.service';

function htmlResponse(html: string, contentType = 'text/html; charset=utf-8'): Response {
  return new Response(html, { status: 200, headers: { 'content-type': contentType } });
}

describe('UnfurlService (SSRF-Schutz + Metadaten)', () => {
  let service: UnfurlService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new UnfurlService();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockLookup.mockReset();
    // Standard: der Host löst auf eine öffentliche IP auf.
    mockLookup.mockResolvedValue([{ address: '93.184.216.34' }]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('liest OpenGraph-Titel/Beschreibung/Bild einer öffentlichen Seite', async () => {
    fetchMock.mockResolvedValue(
      htmlResponse(
        `<html><head>
          <meta property="og:title" content="Hallo &amp; Welt">
          <meta property="og:description" content="Eine Beschreibung">
          <meta property="og:image" content="/bild.png">
          <meta property="og:site_name" content="Example">
        </head></html>`,
      ),
    );
    const embed = await service.unfurl('https://example.com/artikel');
    expect(embed?.title).toBe('Hallo & Welt'); // HTML-Entity dekodiert
    expect(embed?.description).toBe('Eine Beschreibung');
    expect(embed?.siteName).toBe('Example');
    // Relatives og:image gegen die Seiten-URL aufgelöst.
    expect(embed?.imageUrl).toBe('https://example.com/bild.png');
    expect(embed?.url).toBe('https://example.com/artikel');
  });

  it('fällt auf <title> zurück, wenn keine OG-Tags da sind', async () => {
    fetchMock.mockResolvedValue(htmlResponse('<title>Nur ein Titel</title>'));
    const embed = await service.unfurl('https://example.com/');
    expect(embed?.title).toBe('Nur ein Titel');
  });

  it('blockt IP-Literale aus privaten/Cloud-Metadaten-Netzen (ohne fetch)', async () => {
    for (const url of [
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data/', // AWS-Metadaten-Endpunkt
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://[::1]/',
    ]) {
      expect(await service.unfurl(url), url).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blockt öffentliche Namen, die auf interne IPs auflösen (DNS-Rebinding)', async () => {
    mockLookup.mockResolvedValue([{ address: '10.1.2.3' }]);
    expect(await service.unfurl('https://interner-name.example/')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blockt exotische Ports', async () => {
    expect(await service.unfurl('http://example.com:2375/')).toBeNull(); // z. B. Docker-API
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prüft auch das Ziel einer Weiterleitung erneut', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }),
    );
    expect(await service.unfurl('https://example.com/redirect')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // der interne zweite Hop wird nicht abgerufen
  });

  it('ignoriert Antworten ohne HTML-Content-Type', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"x":1}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    expect(await service.unfurl('https://example.com/data.json')).toBeNull();
  });

  it('lehnt ab, wenn die Seite keine brauchbaren Metadaten hat', async () => {
    fetchMock.mockResolvedValue(htmlResponse('<html><body>nichts</body></html>'));
    expect(await service.unfurl('https://example.com/leer')).toBeNull();
  });

  it('verwirft ein nicht-http(s) og:image, behält aber den Titel', async () => {
    fetchMock.mockResolvedValue(
      htmlResponse(
        `<meta property="og:title" content="T"><meta property="og:image" content="javascript:alert(1)">`,
      ),
    );
    const embed = await service.unfurl('https://example.com/');
    expect(embed?.title).toBe('T');
    expect(embed?.imageUrl).toBeUndefined();
  });
});
