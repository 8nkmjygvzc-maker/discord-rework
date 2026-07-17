/**
 * Soundboard (Discord-artig): Jeder Server hat eine Sound-Bibliothek (Name +
 * Emoji + kurze Audiodatei). Wer in einem Sprachkanal sitzt, kann Sounds für
 * alle Teilnehmer abspielen.
 *
 * Ablauf beim Abspielen: Der Auslöser ruft die REST-API auf; die prüft Rechte
 * (UseSoundboard) und die aktive Voice-Session und verteilt SOUNDBOARD_PLAY per
 * Gateway an alle, die GERADE im Sprachkanal sitzen. Jeder Client spielt den
 * (gecachten) Sound lokal ab – es wird also kein Audio in den SFU gemischt
 * (gleiche Mechanik wie bei Discord; hält den SFU frei von Audio-Dekodierung).
 *
 * Die Sounds sind geteilte Server-Assets (wie Servername/Rollen) und liegen
 * bewusst UNVERSCHLÜSSELT im Objektspeicher – sie sind keine E2EE-Nachrichten-
 * inhalte (Trade-off in ROADMAP.md dokumentiert).
 */

/**
 * Obergrenze pro Audiodatei (Quality-of-Life-Runde: von 1 auf 10 MiB
 * angehoben, gleiche Grenze wie Anhänge – mehr passt nicht durch den
 * Raw-Body-Parser der API). Eine DAUER-Grenze gibt es nicht mehr; die ANZAHL
 * der Sounds pro Server war schon immer unbegrenzt.
 */
export const MAX_SOUNDBOARD_SOUND_BYTES = 10 * 1024 * 1024;

export const MAX_SOUNDBOARD_NAME_LENGTH = 32;

/** Ein Sound der Server-Bibliothek, wie die API ihn ausliefert. */
export interface SoundboardSoundInfo {
  id: string;
  serverId: string;
  name: string;
  /** Optionales Anzeige-Emoji (validiert wie Reaktions-Emojis). */
  emoji: string | null;
  /** Wiedergabelautstärke 0.05–1 (clientseitig zusätzlich geklemmt). */
  volume: number;
  /** MIME-Typ der Audiodatei (audio/*), vom Uploader gemeldet. */
  mimeType: string;
  sizeBytes: number;
  /** null, wenn das Uploader-Konto inzwischen gelöscht wurde. */
  uploaderId: string | null;
  createdAt: string;
}

/** Body von PATCH /servers/:id/soundboard/:soundId. */
export interface UpdateSoundboardSoundRequest {
  name?: string;
  /** `null` entfernt das Emoji wieder. */
  emoji?: string | null;
  volume?: number;
}

/**
 * Gateway-Event SOUNDBOARD_PLAY – geht ausschließlich an Nutzer, die gerade in
 * diesem Sprachkanal sitzen. Der komplette Sound reist mit, damit Clients ohne
 * geladene Bibliothek (z. B. anderer Server ausgewählt) sofort abspielen können.
 */
export interface SoundboardPlayPayload {
  channelId: string;
  sound: SoundboardSoundInfo;
  /** Wer den Sound ausgelöst hat (für die „X spielt Y“-Anzeige). */
  userId: string;
  username: string;
}

/** Gateway-Event SOUNDBOARD_UPDATE – Bibliothek geändert; Clients laden neu. */
export interface SoundboardUpdatePayload {
  serverId: string;
}
