/**
 * Browser-Benachrichtigungen für @Erwähnungen (Phase 9).
 *
 * Bewusst schlank: Nur die Notification-API des Browsers, nur solange der Tab
 * offen ist (kein Service Worker). Echte Push-Benachrichtigungen – auch bei
 * geschlossenem Tab – kommen in Phase 12. Der Klartext der Nachricht bleibt
 * dabei auf dem Gerät: Die Notification wird lokal aus der bereits
 * entschlüsselten Nachricht gebaut.
 */

export type MentionPermission = NotificationPermission | 'unsupported';

export function mentionPermission(): MentionPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export async function requestMentionPermission(): Promise<MentionPermission> {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

/**
 * Zeigt eine Erwähnungs-Benachrichtigung, wenn (a) erlaubt und (b) der Tab
 * gerade nicht im Vordergrund ist – wer den Chat ansieht, braucht kein Popup.
 */
export function notifyMention(senderUsername: string, channelLabel: string, text: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (document.hasFocus()) return;
  const body = text.length > 140 ? `${text.slice(0, 140)}…` : text;
  const notification = new Notification(`${senderUsername} erwähnt dich in ${channelLabel}`, {
    body,
    tag: 'parley-mention', // ersetzt ältere Erwähnungs-Popups statt zu stapeln
  });
  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}
