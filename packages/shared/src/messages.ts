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
import { MAX_STICKER_NAME_LENGTH } from './stickers';

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

/**
 * Dispatch-Payload von MESSAGE_CREATE (Phase 15: + Kanal-Kontext).
 * `context` nennt Kanal- und Server-Name (reine Server-Metadaten, kein
 * E2EE-Inhalt), damit Clients Benachrichtigungen auch für Kanäle formulieren
 * können, deren Server gerade nicht ausgewählt ist. Bei DMs entfällt er –
 * DM-Kanäle kennt der Client ohnehin vollständig.
 */
export interface MessageCreatePayload {
  message: MessageInfo;
  context?: { channelName: string; serverName: string };
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

/**
 * Sticker-Referenz: Welcher Sticker gemeint ist, reist IM E2EE-Klartext –
 * der Server sieht nur eine normale (kleine) Nachricht. Das Bild selbst holt
 * der Empfänger über GET /api/stickers/:id/image (Server-Asset, nur für
 * Mitglieder). `name` und `mimeType` sind eingebettet, damit die Nachricht
 * auch ohne geladene Sticker-Bibliothek gerendert werden kann.
 */
export interface StickerRef {
  id: string;
  name: string;
  /** image/*-Typ fürs Rendern; fehlt er, sniffen Browser das Format selbst. */
  mimeType?: string;
}

/** Genug für Emoji-Sequenzen (Hautfarben/ZWJ), zu kurz für Text-Missbrauch. */
export const MAX_REACTION_EMOJI_LENGTH = 32;
export const MAX_REPLY_PREVIEW_LENGTH = 160;

/**
 * Link-Vorschau (Embed, Phase „Feinschliff"): Titel/Beschreibung/Bild einer
 * verlinkten Seite. Der Absender holt diese Metadaten beim Senden über den
 * Server-`/unfurl`-Endpunkt (Browser-CORS lässt den fremden HTML-Abruf nicht
 * direkt zu) und legt sie – wie Anhänge – IN den E2EE-Klartext. Der Server
 * sieht die Vorschau NICHT (nur beim einmaligen Unfurl transient die URL).
 *
 * Bewusster Trade-off (ROADMAP): `imageUrl` zeigt auf den fremden Host –
 * beim Rendern lädt der LESER-Browser das Bild direkt, dessen IP wird also an
 * den Host geleakt. Discord proxyt das serverseitig; hier bewusst einfacher.
 */
export interface LinkEmbed {
  /** Verlinkte Seite (Klick-Ziel der Karte) – immer http(s). */
  url: string;
  title?: string;
  description?: string;
  /** Vorschaubild – immer http(s); wird vom Leser-Browser direkt geladen. */
  imageUrl?: string;
  /** Seitenname (og:site_name), z. B. „YouTube". */
  siteName?: string;
}

export const MAX_EMBEDS_PER_MESSAGE = 4;
export const MAX_EMBED_URL_LENGTH = 2048;
export const MAX_EMBED_TITLE_LENGTH = 300;
export const MAX_EMBED_DESCRIPTION_LENGTH = 500;
export const MAX_EMBED_SITENAME_LENGTH = 100;

/**
 * Nur explizite http(s)-URLs (kein `javascript:`/`data:`/…). Bewusst ohne
 * globales `URL`, damit die Prüfung in Browser UND Node identisch läuft.
 */
const HTTP_URL_PATTERN = /^https?:\/\/[^\s]+$/i;

function isHttpUrlString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    HTTP_URL_PATTERN.test(value)
  );
}

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
  /** Link-Vorschau-Karten zu den URLs im Text (Feinschliff). */
  embeds?: LinkEmbed[];
  /** Wenn gesetzt, zeigt diese Nachricht einen Server-Sticker (text bleibt leer). */
  sticker?: StickerRef;
}

export interface DecodedMessageContent {
  text: string;
  attachments: AttachmentMeta[];
  replyTo: ReplyRef | null;
  reaction: ReactionContent | null;
  embeds: LinkEmbed[];
  sticker: StickerRef | null;
}

/** Baut den zu verschlüsselnden Klartext (immer JSON, Version 1). */
export function encodeMessageContent(
  text: string,
  attachments: AttachmentMeta[] = [],
  replyTo?: ReplyRef,
  embeds: LinkEmbed[] = [],
  sticker?: StickerRef,
): string {
  const content: MessageContentV1 = {
    v: 1,
    text,
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(replyTo
      ? { replyTo: { ...replyTo, preview: replyTo.preview.slice(0, MAX_REPLY_PREVIEW_LENGTH) } }
      : {}),
    ...(embeds.length > 0 ? { embeds: embeds.slice(0, MAX_EMBEDS_PER_MESSAGE) } : {}),
    ...(sticker
      ? { sticker: { ...sticker, name: sticker.name.slice(0, MAX_STICKER_NAME_LENGTH) } }
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
          embeds: sanitizeEmbeds(parsed.embeds),
          sticker: sanitizeStickerRef(parsed.sticker),
        };
      }
    } catch {
      // kein JSON → Rohtext aus einer früheren Phase
    }
  }
  return {
    text: plaintext,
    attachments: [],
    replyTo: null,
    reaction: null,
    embeds: [],
    sticker: null,
  };
}

/**
 * Link-Vorschauen stammen vom (nur signierten, nicht vertrauenswürdigen)
 * Absender – defensiv validieren: `url`/`imageUrl` müssen http(s) sein (kein
 * `javascript:`/`data:`), Texte werden geklemmt, Anzahl gedeckelt. Eine Karte
 * ohne jeden Inhalt (nur url) wird verworfen.
 */
function sanitizeEmbeds(value: unknown): LinkEmbed[] {
  if (!Array.isArray(value)) return [];
  const embeds: LinkEmbed[] = [];
  for (const raw of value) {
    if (embeds.length >= MAX_EMBEDS_PER_MESSAGE) break;
    if (typeof raw !== 'object' || raw === null) continue;
    const candidate = raw as Partial<LinkEmbed>;
    if (!isHttpUrlString(candidate.url, MAX_EMBED_URL_LENGTH)) continue;
    const embed: LinkEmbed = { url: candidate.url };
    if (typeof candidate.title === 'string' && candidate.title.length > 0) {
      embed.title = candidate.title.slice(0, MAX_EMBED_TITLE_LENGTH);
    }
    if (typeof candidate.description === 'string' && candidate.description.length > 0) {
      embed.description = candidate.description.slice(0, MAX_EMBED_DESCRIPTION_LENGTH);
    }
    if (typeof candidate.siteName === 'string' && candidate.siteName.length > 0) {
      embed.siteName = candidate.siteName.slice(0, MAX_EMBED_SITENAME_LENGTH);
    }
    if (isHttpUrlString(candidate.imageUrl, MAX_EMBED_URL_LENGTH)) {
      embed.imageUrl = candidate.imageUrl;
    }
    if (embed.title || embed.description || embed.imageUrl) embeds.push(embed);
  }
  return embeds;
}

/** Anfrage an POST /api/unfurl – der Server holt die Vorschau-Metadaten. */
export interface UnfurlRequest {
  url: string;
}

/** Antwort von POST /api/unfurl: gefundene Vorschau oder null. */
export interface UnfurlResponse {
  embed: LinkEmbed | null;
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

/**
 * Sticker-Referenzen stammen vom (nur signierten, nicht vertrauenswürdigen)
 * Absender: Die ID muss wie eine Server-ID aussehen (sie landet in einer URL
 * und als React-Key), der MIME-Typ muss ein image/*-Typ sein (er landet im
 * Blob-Typ) – sonst wird das Feld verworfen bzw. weggelassen.
 */
function sanitizeStickerRef(value: unknown): StickerRef | null {
  if (typeof value !== 'object' || value === null) return null;
  const ref = value as Partial<StickerRef>;
  if (
    typeof ref.id !== 'string' ||
    !MESSAGE_ID_PATTERN.test(ref.id) ||
    typeof ref.name !== 'string'
  ) {
    return null;
  }
  const mimeOk = typeof ref.mimeType === 'string' && /^image\/[\w.+-]{1,64}$/.test(ref.mimeType);
  return {
    id: ref.id,
    name: ref.name.slice(0, MAX_STICKER_NAME_LENGTH),
    ...(mimeOk ? { mimeType: ref.mimeType } : {}),
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
