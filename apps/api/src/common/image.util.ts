/**
 * Bildtyp-Erkennung über Magic Bytes (Phase 15, Profil-/Server-Bilder).
 * Profil-Bilder sind – anders als Anhänge – bewusst UNverschlüsselt (sie sind
 * öffentliche Metadaten wie der Nutzername), deshalb kann und soll der Server
 * hier validieren, dass wirklich ein Bild hochgeladen wurde.
 */
export function detectImageContentType(data: Buffer): string | null {
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return 'image/png';
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    data.length >= 12 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  const gifHeader = data.length >= 6 ? data.toString('ascii', 0, 6) : '';
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
    return 'image/gif';
  }
  return null;
}
