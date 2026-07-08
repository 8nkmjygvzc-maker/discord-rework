import type { PushSubscribeRequest, VapidPublicKeyResponse } from '@parley/shared';
import { useAuthStore } from '../store/auth';

/**
 * Web-Push-Client (Phase 12). Registriert den Service Worker, verwaltet die
 * PushSubscription des Browsers und meldet sie beim Server an/ab. Push wirkt –
 * anders als die Notification-API aus Phase 9 – auch bei geschlossenem Tab.
 *
 * Die Nutzdaten bleiben inhaltsarm (E2EE): Der Server pusht nur Metadaten
 * (Absender/Kanal); den Klartext baut später die geöffnete App aus dem lokal
 * entschlüsselten Verlauf.
 */

const SW_URL = '/sw.js';

export type PushStatus = 'unsupported' | 'denied' | 'disabled' | 'enabled';

function supported(): boolean {
  return (
    'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined'
  );
}

function authFetch<T>(
  path: string,
  options?: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown },
): Promise<T> {
  return useAuthStore.getState().authFetch<T>(path, options);
}

async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  const reg = existing ?? (await navigator.serviceWorker.register(SW_URL));
  await navigator.serviceWorker.ready;
  return reg;
}

/** Aktueller Zustand für die UI (ohne etwas zu ändern). */
export async function pushStatus(): Promise<PushStatus> {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub ? 'enabled' : 'disabled';
}

/** Erlaubnis anfragen, Subscription anlegen und beim Server registrieren. */
export async function enablePush(): Promise<PushStatus> {
  if (!supported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'disabled';

  const { publicKey } = await authFetch<VapidPublicKeyResponse>('/api/push/vapid-public-key');
  if (!publicKey) return 'disabled'; // Server hat Push nicht konfiguriert (kein VAPID)

  const reg = await ensureRegistration();
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));
  await authFetch<void>('/api/push/subscribe', { method: 'POST', body: subscriptionBody(sub) });
  return 'enabled';
}

/** Subscription abmelden (Server + Browser). */
export async function disablePush(): Promise<PushStatus> {
  if (!supported()) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    await authFetch<void>('/api/push/unsubscribe', {
      method: 'POST',
      body: { endpoint: sub.endpoint },
    }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
  return 'disabled';
}

/**
 * Nach dem Login: hat der Browser bereits eine Subscription (Erlaubnis erteilt),
 * beim Server (neu) registrieren – der könnte sie nach einem DB-Reset o. Ä.
 * nicht mehr kennen. Fehler werden verschluckt (Push ist optional).
 */
export async function resyncPush(): Promise<void> {
  if (!supported() || Notification.permission !== 'granted') return;
  try {
    const reg = await ensureRegistration();
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await authFetch<void>('/api/push/subscribe', { method: 'POST', body: subscriptionBody(sub) });
    }
  } catch {
    /* Push ist optional – Fehler ignorieren. */
  }
}

function subscriptionBody(sub: PushSubscription): PushSubscribeRequest {
  const json = sub.toJSON();
  return {
    endpoint: json.endpoint ?? sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
  };
}

/** base64url (VAPID-Schlüssel) → Uint8Array für applicationServerKey. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  // Backing-Buffer explizit als ArrayBuffer, damit der Typ zu BufferSource passt.
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
