/**
 * Typen für Text-Nachrichten. Seit Phase 6 Ende-zu-Ende-verschlüsselt:
 * Der Server sieht nur Ciphertext, Nonce und den Klartext-Header
 * (keyId/Iteration/Signatur – nötig, damit Empfänger den richtigen
 * Sender-Key-Zustand wählen können).
 *
 * Seit Phase 8 ist der E2EE-Klartext strukturiert (MessageContentV1):
 * Text plus optionale Anhangs-Metadaten inkl. Dateischlüssel – der Server
 * kennt von Anhängen nur ID und Blob-Größe.
 *
 * Seit Phase 9 trägt der Klartext außerdem optionale Antwort-Bezüge (Zitat)
 * und kann ein Reaktions-Event sein. Beides reist ausschließlich IM
 * Ciphertext – der Server sieht weder Antwort-Graphen noch Emojis; für ihn
 * ist eine Reaktion eine ganz normale (kleine) Nachricht.
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

/**
 * Nachricht bearbeiten (Phase 13). Nur der Autor; da Ende-zu-Ende-verschlüsselt,
 * ersetzt der Client den kompletten Ciphertext (neu verschlüsselt mit dem
 * aktuellen Sender-Key). Anhänge bleiben unverändert.
 */
export interface EditMessageRequest {
  ciphertext: string;
  nonce: string;
  header: EncryptedMessageHeader;
}

/** Antwort der History: älteste zuerst, `hasMore` für „Ältere laden“. */
export interface MessageHistoryResponse {
  messages: MessageInfo[];
  hasMore: boolean;
}

// --- E2EE-Klartext-Format (Phase 8/9) ------------------------------------------

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

/**
 * Antwort-Bezug (Phase 9): Referenz + Zitat-Vorschau reisen IM E2EE-Klartext
 * (Prinzip wie bei Signal). Die Vorschau ist eingebettet, damit das Zitat auch
 * dann lesbar ist, wenn die Originalnachricht nicht (mehr) geladen ist.
 */
export interface ReplyRef {
  messageId: string;
  senderId: string;
  senderUsername: string;
  /** Kurzer Klartext-Auszug der Originalnachricht. */
  preview: string;
}

/**
 * Reaktions-Event (Phase 9): Eine „Nachricht“, deren Inhalt nur aus einer
 * Emoji-Reaktion auf eine andere Nachricht besteht. Toggle-Semantik über
 * add/remove-Events; der letzte Stand pro (Nutzer, Emoji, Ziel) gewinnt –
 * aggregiert wird ausschließlich im Client.
 */
export interface ReactionContent {
  targetMessageId: string;
  emoji: string;
  action: 'add' | 'remove';
}

/** Genug für Emoji-Sequenzen (Hautfarben/ZWJ), zu kurz für Text-Missbrauch. */
export const MAX_REACTION_EMOJI_LENGTH = 32;
export const MAX_REPLY_PREVIEW_LENGTH = 160;

/**
 * Absenderkontrollierte Nachrichten-Referenzen (replyTo/Reaktions-Ziel) müssen
 * wie Server-IDs aussehen (UUID-Zeichenvorrat) – alles andere wird verworfen.
 * Verhindert u. a. Selector-Injektion, wenn die UI per ID Elemente sucht.
 */
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Sieht `value` wie eine Emoji-Sequenz aus? Erlaubt sind nur Emoji-Bausteine
 * (inkl. ZWJ, Variation Selector, Keycap, Hautfarben, Regionalindikatoren),
 * und mindestens ein Nicht-ASCII-Zeichen muss dabei sein – sonst wären „123“
 * oder „#“ gültig, obwohl sie nur aus Keycap-BAUSTEINEN bestehen. Reaktionen
 * sind absenderkontrolliert; ohne diesen Check ließe sich beliebiger kurzer
 * Text als „Reaktion“ in die UI aller Mitglieder rendern.
 */
export function isPlausibleReactionEmoji(value: string): boolean {
  if (value.length === 0 || value.length > MAX_REACTION_EMOJI_LENGTH) return false;
  if (!/^[\p{Emoji}\p{Emoji_Component}]+$/u.test(value)) return false;
  return [...value].some((ch) => (ch.codePointAt(0) ?? 0) > 0x7f);
}

export interface MessageContentV1 {
  v: 1;
  text: string;
  attachments?: AttachmentMeta[];
  replyTo?: ReplyRef;
  /** Wenn gesetzt, ist diese Nachricht ein Reaktions-Event (text bleibt leer). */
  reaction?: ReactionContent;
}

export interface DecodedMessageContent {
  text: string;
  attachments: AttachmentMeta[];
  replyTo: ReplyRef | null;
  reaction: ReactionContent | null;
}

/** Baut den zu verschlüsselnden Klartext (immer JSON, Version 1). */
export function encodeMessageContent(
  text: string,
  attachments: AttachmentMeta[] = [],
  replyTo?: ReplyRef,
): string {
  const content: MessageContentV1 = {
    v: 1,
    text,
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(replyTo
      ? { replyTo: { ...replyTo, preview: replyTo.preview.slice(0, MAX_REPLY_PREVIEW_LENGTH) } }
      : {}),
  };
  return JSON.stringify(content);
}

/** Baut den Klartext eines Reaktions-Events. */
export function encodeReactionContent(
  targetMessageId: string,
  emoji: string,
  action: 'add' | 'remove',
): string {
  const content: MessageContentV1 = {
    v: 1,
    text: '',
    reaction: { targetMessageId, emoji: emoji.slice(0, MAX_REACTION_EMOJI_LENGTH), action },
  };
  return JSON.stringify(content);
}

/**
 * Liest den entschlüsselten Klartext. Nachrichten aus Phase 6/7 sind rohe
 * Strings – alles, was nicht als v1-JSON durchgeht, wird als Text behandelt.
 * replyTo/reaction stammen vom (nur signierten, nicht vertrauenswürdigen)
 * Absender und werden defensiv validiert – kaputte Felder fallen auf null.
 */
export function decodeMessageContent(plaintext: string): DecodedMessageContent {
  if (plaintext.startsWith('{')) {
    try {
      const parsed = JSON.parse(plaintext) as Partial<MessageContentV1>;
      if (parsed !== null && parsed.v === 1 && typeof parsed.text === 'string') {
        return {
          text: parsed.text,
          attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
          replyTo: sanitizeReplyRef(parsed.replyTo),
          reaction: sanitizeReaction(parsed.reaction),
        };
      }
    } catch {
      // kein JSON → Rohtext aus einer früheren Phase
    }
  }
  return { text: plaintext, attachments: [], replyTo: null, reaction: null };
}

function sanitizeReplyRef(value: unknown): ReplyRef | null {
  if (typeof value !== 'object' || value === null) return null;
  const ref = value as Partial<ReplyRef>;
  if (
    typeof ref.messageId !== 'string' ||
    !MESSAGE_ID_PATTERN.test(ref.messageId) ||
    typeof ref.senderId !== 'string' ||
    typeof ref.senderUsername !== 'string' ||
    typeof ref.preview !== 'string'
  ) {
    return null;
  }
  return {
    messageId: ref.messageId,
    senderId: ref.senderId,
    senderUsername: ref.senderUsername.slice(0, 32),
    preview: ref.preview.slice(0, MAX_REPLY_PREVIEW_LENGTH),
  };
}

function sanitizeReaction(value: unknown): ReactionContent | null {
  if (typeof value !== 'object' || value === null) return null;
  const reaction = value as Partial<ReactionContent>;
  if (
    typeof reaction.targetMessageId !== 'string' ||
    !MESSAGE_ID_PATTERN.test(reaction.targetMessageId) ||
    typeof reaction.emoji !== 'string' ||
    !isPlausibleReactionEmoji(reaction.emoji) ||
    (reaction.action !== 'add' && reaction.action !== 'remove')
  ) {
    return null;
  }
  return {
    targetMessageId: reaction.targetMessageId,
    emoji: reaction.emoji,
    action: reaction.action,
  };
}
