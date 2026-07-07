/**
 * Typen für Text-Nachrichten. Seit Phase 6 Ende-zu-Ende-verschlüsselt:
 * Der Server sieht nur Ciphertext, Nonce und den Klartext-Header
 * (keyId/Iteration/Signatur – nötig, damit Empfänger den richtigen
 * Sender-Key-Zustand wählen können).
 *
 * Seit Phase 8 ist der E2EE-Klartext strukturiert (MessageContentV1):
 * Text plus optionale Anhangs-Metadaten inkl. Dateischlüssel – der Server
 * kennt von Anhängen nur ID und Blob-Größe.
 */
import type { EncryptedMessageHeader } from './crypto/senderkey';

/** Server-seitige Sicht auf einen Anhang – bewusst nur unverfängliche Felder. */
export interface AttachmentInfo {
  id: string;
  /** Größe des Ciphertext-Blobs (Klartextgröße steht in der Nachricht selbst). */
  sizeBytes: number;
}

/** Obergrenzen für Anhänge (Klartext; der Ciphertext ist 16 Bytes größer). */
export const MAX_ATTACHMENT_PLAINTEXT_BYTES = 10 * 1024 * 1024;
/** Vom Server akzeptierte Blob-Größe (Klartext + AEAD-Overhead + Luft). */
export const MAX_ATTACHMENT_CIPHERTEXT_BYTES = MAX_ATTACHMENT_PLAINTEXT_BYTES + 64;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

export interface MessageInfo {
  id: string;
  channelId: string;
  senderId: string;
  /** Denormalisiert, damit die UI keine Nutzer-Lookups braucht. */
  senderUsername: string;
  ciphertext: string;
  nonce: string;
  header: EncryptedMessageHeader;
  attachments: AttachmentInfo[];
  createdAt: string;
  editedAt: string | null;
}

export interface SendMessageRequest {
  ciphertext: string;
  nonce: string;
  header: EncryptedMessageHeader;
  /** IDs zuvor hochgeladener Anhänge (werden beim Senden an die Nachricht gebunden). */
  attachmentIds?: string[];
}

/** Antwort der History: älteste zuerst, `hasMore` für „Ältere laden“. */
export interface MessageHistoryResponse {
  messages: MessageInfo[];
  hasMore: boolean;
}

// --- E2EE-Klartext-Format (Phase 8) -------------------------------------------

/** Vorschaubild eines Bild-Anhangs – eigener verschlüsselter Blob. */
export interface AttachmentThumbnailMeta {
  id: string;
  key: string;
  nonce: string;
  width: number;
  height: number;
}

/**
 * Anhangs-Metadaten, wie sie IM E2EE-Klartext der Nachricht stehen.
 * `key`/`nonce` entschlüsseln den Blob hinter GET /api/attachments/:id.
 */
export interface AttachmentMeta {
  id: string;
  name: string;
  mimeType: string;
  /** Klartext-Größe (fürs UI; der Server kennt nur die Blob-Größe). */
  sizeBytes: number;
  key: string;
  nonce: string;
  thumbnail?: AttachmentThumbnailMeta;
}

export interface MessageContentV1 {
  v: 1;
  text: string;
  attachments?: AttachmentMeta[];
}

export interface DecodedMessageContent {
  text: string;
  attachments: AttachmentMeta[];
}

/** Baut den zu verschlüsselnden Klartext (immer JSON, Version 1). */
export function encodeMessageContent(text: string, attachments: AttachmentMeta[] = []): string {
  const content: MessageContentV1 = {
    v: 1,
    text,
    ...(attachments.length > 0 ? { attachments } : {}),
  };
  return JSON.stringify(content);
}

/**
 * Liest den entschlüsselten Klartext. Nachrichten aus Phase 6/7 sind rohe
 * Strings – alles, was nicht als v1-JSON durchgeht, wird als Text behandelt.
 */
export function decodeMessageContent(plaintext: string): DecodedMessageContent {
  if (plaintext.startsWith('{')) {
    try {
      const parsed = JSON.parse(plaintext) as Partial<MessageContentV1>;
      if (parsed !== null && parsed.v === 1 && typeof parsed.text === 'string') {
        return {
          text: parsed.text,
          attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
        };
      }
    } catch {
      // kein JSON → Rohtext aus einer früheren Phase
    }
  }
  return { text: plaintext, attachments: [] };
}
