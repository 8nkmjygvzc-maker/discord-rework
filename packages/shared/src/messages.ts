/**
 * Typen für Text-Nachrichten. Seit Phase 6 Ende-zu-Ende-verschlüsselt:
 * Der Server sieht nur Ciphertext, Nonce und den Klartext-Header
 * (keyId/Iteration/Signatur – nötig, damit Empfänger den richtigen
 * Sender-Key-Zustand wählen können).
 */
import type { EncryptedMessageHeader } from './crypto/senderkey';

export interface MessageInfo {
  id: string;
  channelId: string;
  senderId: string;
  /** Denormalisiert, damit die UI keine Nutzer-Lookups braucht. */
  senderUsername: string;
  ciphertext: string;
  nonce: string;
  header: EncryptedMessageHeader;
  createdAt: string;
  editedAt: string | null;
}

export interface SendMessageRequest {
  ciphertext: string;
  nonce: string;
  header: EncryptedMessageHeader;
}

/** Antwort der History: älteste zuerst, `hasMore` für „Ältere laden“. */
export interface MessageHistoryResponse {
  messages: MessageInfo[];
  hasMore: boolean;
}
