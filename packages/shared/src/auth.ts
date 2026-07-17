/** Öffentliche Nutzerdaten, wie die API sie ausliefert (nie passwordHash!). */
export interface AuthUser {
  id: string;
  username: string;
  email: string;
  avatarUrl: string | null;
  /** Profil-Banner (Querformat) – null = Farbverlauf auf der Profilkarte. */
  bannerUrl: string | null;
  status: string;
  createdAt: string;
}

/** Antwort von /api/auth/register, /login und /refresh.
 *  Das Refresh-Token wird separat als httpOnly-Cookie gesetzt. */
export interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

/** Request-Body für PATCH /api/users/me. */
export interface UpdateProfileRequest {
  status?: string;
  avatarUrl?: string;
  /** Nur '' erlaubt (Banner entfernen) – gesetzt wird per Upload-Endpunkt. */
  bannerUrl?: string;
}

/**
 * Maximale Größe hochgeladener Profil-/Server-Bilder (Phase 15). Der Client
 * skaliert vor dem Upload auf 256 px herunter – das Limit ist nur die harte
 * serverseitige Grenze gegen Missbrauch.
 */
export const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024;
