import { create } from 'zustand';
import type { AuthResponse, AuthUser, UpdateProfileRequest } from '@parley/shared';
import { apiDownload, apiFetch, apiUpload, ApiError } from '../lib/api';

/**
 * Auth-Store: Der Access-Token lebt bewusst NUR im Speicher (kein
 * localStorage → kein Diebstahl per XSS). Sessions überleben einen Reload
 * über das httpOnly-Refresh-Cookie, das initSession() einlöst.
 */
interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  /** true, sobald der initiale Session-Restore-Versuch abgeschlossen ist. */
  initialized: boolean;

  initSession: () => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (changes: UpdateProfileRequest) => Promise<void>;
  /**
   * Access-Token für das Gateway-IDENTIFY. Bei forceRefresh (Gateway hat das
   * Token gerade abgelehnt) wird über das Refresh-Cookie ein frisches geholt.
   * null = keine Sitzung mehr.
   */
  getGatewayToken: (forceRefresh: boolean) => Promise<string | null>;
  /** Authentifizierter Fetch; erneuert den Access-Token bei 401 einmalig. */
  authFetch: <T>(
    path: string,
    options?: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown },
  ) => Promise<T>;
  /** Roh-Upload (verschlüsselter Anhang) mit derselben 401-Retry-Logik. */
  authUpload: <T>(path: string, body: Uint8Array) => Promise<T>;
  /** Binär-Download (Ciphertext-Blob) mit derselben 401-Retry-Logik. */
  authDownload: (path: string) => Promise<Uint8Array>;
}

/**
 * Single-Flight: Es läuft immer höchstens EIN Refresh-Request gleichzeitig.
 * Ohne das würden parallele Aufrufe (React StrictMode, mehrere Komponenten)
 * dasselbe Refresh-Cookie doppelt einlösen und mit der Token-Rotation
 * kollidieren.
 */
let refreshInFlight: Promise<AuthResponse> | null = null;

function refreshSession(): Promise<AuthResponse> {
  refreshInFlight ??= apiFetch<AuthResponse>('/api/auth/refresh', { method: 'POST' }).finally(
    () => {
      refreshInFlight = null;
    },
  );
  return refreshInFlight;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  accessToken: null,
  initialized: false,

  initSession: async () => {
    try {
      const res = await refreshSession();
      set({ user: res.user, accessToken: res.accessToken, initialized: true });
    } catch {
      // Keine (gültige) Sitzung vorhanden – Login-Ansicht zeigen.
      set({ user: null, accessToken: null, initialized: true });
    }
  },

  register: async (username, email, password) => {
    const res = await apiFetch<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: { username, email, password },
    });
    set({ user: res.user, accessToken: res.accessToken });
  },

  login: async (email, password) => {
    const res = await apiFetch<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    set({ user: res.user, accessToken: res.accessToken });
  },

  logout: async () => {
    try {
      await apiFetch<void>('/api/auth/logout', { method: 'POST' });
    } finally {
      set({ user: null, accessToken: null });
    }
  },

  updateProfile: async (changes) => {
    const user = await get().authFetch<AuthUser>('/api/users/me', {
      method: 'PATCH',
      body: changes,
    });
    set({ user });
  },

  getGatewayToken: async (forceRefresh) => {
    const { accessToken } = get();
    if (accessToken && !forceRefresh) return accessToken;
    try {
      const res = await refreshSession();
      set({ user: res.user, accessToken: res.accessToken });
      return res.accessToken;
    } catch {
      set({ user: null, accessToken: null });
      return null;
    }
  },

  authFetch: <T>(
    path: string,
    options: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown } = {},
  ): Promise<T> => withAuthRetry((token) => apiFetch<T>(path, { ...options, accessToken: token })),

  authUpload: <T>(path: string, body: Uint8Array): Promise<T> =>
    withAuthRetry((token) => apiUpload<T>(path, body, token)),

  authDownload: (path: string): Promise<Uint8Array> =>
    withAuthRetry((token) => apiDownload(path, token)),
}));

/**
 * Führt einen authentifizierten Request aus; bei 401 wird der Access-Token
 * einmalig über das Refresh-Cookie erneuert und der Request wiederholt.
 */
async function withAuthRetry<T>(run: (accessToken: string | null) => Promise<T>): Promise<T> {
  const { getState, setState } = useAuthStore;
  try {
    return await run(getState().accessToken);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
    const res = await refreshSession().catch(() => {
      setState({ user: null, accessToken: null });
      throw e;
    });
    setState({ user: res.user, accessToken: res.accessToken });
    return run(res.accessToken);
  }
}
