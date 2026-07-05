import { createHash, randomBytes } from 'node:crypto';

/** Lebensdauer des Access-Tokens (JWT). Kurz, weil nicht widerrufbar. */
export const ACCESS_TOKEN_TTL = '15m';
/** Lebensdauer des Refresh-Tokens in Tagen. */
export const REFRESH_TOKEN_TTL_DAYS = 30;

/** Erzeugt ein kryptographisch zufälliges, opakes Refresh-Token (256 Bit). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Refresh-Tokens landen nur als SHA-256-Hash in der DB. Anders als bei
 * Passwörtern reicht hier ein schneller Hash: Das Token hat volle 256 Bit
 * Entropie, Brute-Force über einen DB-Leak ist damit aussichtslos.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Ablaufzeitpunkt für ein jetzt ausgestelltes Refresh-Token. */
export function refreshTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
