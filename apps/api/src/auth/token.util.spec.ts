import { describe, expect, it } from 'vitest';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  REFRESH_TOKEN_TTL_DAYS,
} from './token.util';

describe('token.util', () => {
  it('erzeugt Tokens mit ausreichender Länge und ohne Kollisionen', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateRefreshToken()));
    expect(tokens.size).toBe(100);
    for (const t of tokens) {
      // 32 Byte base64url => 43 Zeichen
      expect(t.length).toBeGreaterThanOrEqual(43);
    }
  });

  it('hasht deterministisch und gibt niemals das Token selbst zurück', () => {
    const token = generateRefreshToken();
    const hash = hashRefreshToken(token);
    expect(hash).toBe(hashRefreshToken(token));
    expect(hash).not.toContain(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('berechnet den Ablauf relativ zum Ausstellungszeitpunkt', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const expiry = refreshTokenExpiry(now);
    const diffDays = (expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(REFRESH_TOKEN_TTL_DAYS);
  });
});
