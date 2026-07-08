/*
 * Parley Service Worker (Phase 12) – Web-Push-Benachrichtigungen.
 *
 * Empfängt Push-Nachrichten (auch bei geschlossenem Tab) und zeigt eine
 * Notification. Die Nutzdaten sind inhaltsarm (kein Klartext – E2EE): nur
 * Absender/Kanal als Metadaten. Ein Klick fokussiert die App bzw. öffnet sie.
 */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_err) {
    data = {};
  }
  const title = data.title || 'Parley';
  const options = {
    body: data.body || 'Neue Aktivität',
    tag: data.tag || 'parley',
    data: { url: data.url || '/' },
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client && url) await client.navigate(url).catch(() => {});
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })(),
  );
});
