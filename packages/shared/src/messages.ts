/** Typen für Text-Nachrichten (Phase 4 – noch unverschlüsselt, E2EE folgt in Phase 6). */

export interface MessageInfo {
  id: string;
  channelId: string;
  senderId: string;
  /** Denormalisiert, damit die UI keine Nutzer-Lookups braucht. */
  senderUsername: string;
  content: string;
  createdAt: string;
  editedAt: string | null;
}

export interface SendMessageRequest {
  content: string;
}

/** Antwort der History: älteste zuerst, `hasMore` für „Ältere laden“. */
export interface MessageHistoryResponse {
  messages: MessageInfo[];
  hasMore: boolean;
}
