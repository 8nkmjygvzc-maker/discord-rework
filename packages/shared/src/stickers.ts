/**
 * Sticker (Discord-artig): Jeder Server hat eine Sticker-Bibliothek (Name +
 * Bild). Wer in einem Textkanal schreiben darf (SendMessages), kann Sticker
 * verschicken; hochladen/verwalten verlangt ManageStickers (löschen darf
 * zusätzlich der Uploader selbst) – gleiche Rechte-Mechanik wie das Soundboard.
 *
 * Die Bilder sind geteilte Server-Assets (wie Soundboard-Sounds) und liegen
 * bewusst UNVERSCHLÜSSELT im Objektspeicher – sie sind keine E2EE-Nachrichten-
 * inhalte (Trade-off in ROADMAP.md dokumentiert). Die Sticker-REFERENZ einer
 * Nachricht (wer welchen Sticker wohin geschickt hat) reist dagegen IM
 * E2EE-Ciphertext (MessageContentV1.sticker) – für den Server ist eine
 * Sticker-Nachricht von einer normalen Textnachricht nicht unterscheidbar.
 */

/** Obergrenze pro Bild – Sticker sollen klein bleiben (auch animierte GIFs). */
export const MAX_STICKER_BYTES = 1 * 1024 * 1024;

export const MAX_STICKER_NAME_LENGTH = 32;

/** Ein Sticker der Server-Bibliothek, wie die API ihn ausliefert. */
export interface StickerInfo {
  id: string;
  serverId: string;
  name: string;
  /** MIME-Typ des Bilds (image/*), vom Uploader gemeldet. */
  mimeType: string;
  sizeBytes: number;
  /** null, wenn das Uploader-Konto inzwischen gelöscht wurde. */
  uploaderId: string | null;
  createdAt: string;
}

/** Body von PATCH /servers/:id/stickers/:stickerId. */
export interface UpdateStickerRequest {
  name?: string;
}

/** Gateway-Event STICKER_UPDATE – Bibliothek geändert; Clients laden neu. */
export interface StickerUpdatePayload {
  serverId: string;
}
