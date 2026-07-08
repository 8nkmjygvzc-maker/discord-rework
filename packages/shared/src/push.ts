/**
 * Web-Push-Benachrichtigungen (Phase 12). Echte Push-Zustellung – auch bei
 * geschlossenem Tab – über einen Service Worker und den Push-Dienst des
 * Browsers (VAPID). Wegen E2EE sind die Nutzdaten bewusst inhaltsarm: der
 * Server kennt keinen Klartext, die Notification nennt nur Absender/Kanal als
 * Metadaten und öffnet die App zum eigentlichen Entschlüsseln.
 */

/** Antwort von GET /api/push/vapid-public-key. */
export interface VapidPublicKeyResponse {
  /** base64url-kodierter öffentlicher VAPID-Schlüssel; leer, wenn Push aus ist. */
  publicKey: string;
}

/**
 * Body von POST /api/push/subscribe – die vom Browser (PushManager) erzeugte
 * Subscription. Entspricht `PushSubscription.toJSON()`.
 */
export interface PushSubscribeRequest {
  endpoint: string;
  keys: {
    /** Öffentlicher ECDH-Schlüssel des Clients (base64url). */
    p256dh: string;
    /** Auth-Secret (base64url). */
    auth: string;
  };
}

/** Body von POST /api/push/unsubscribe. */
export interface PushUnsubscribeRequest {
  endpoint: string;
}

/**
 * Nutzdaten einer Push-Notification (JSON im Push-Body). Der Service Worker
 * baut daraus die Notification. Kein Nachrichtentext – nur Metadaten.
 */
export interface PushPayload {
  title: string;
  body: string;
  /** Relative URL, die beim Klick geöffnet/fokussiert wird. */
  url?: string;
  /** Gruppierungs-Tag (ersetzt statt stapelt gleichartige Notifications). */
  tag?: string;
}

/**
 * Body von POST /api/channels/:id/notify-mentions. Der SENDENDE Client meldet,
 * welche Kanal-Mitglieder er per @-Erwähnung angesprochen hat (Erwähnungen
 * stecken E2E-verschlüsselt im Text – nur der Client kann sie erkennen). Der
 * Server verifiziert die Sende-Berechtigung und pusht offline Erwähnte.
 */
export interface NotifyMentionsRequest {
  /** User-IDs der erwähnten Kanal-Mitglieder. */
  userIds: string[];
}
