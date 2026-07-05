/** Öffentliche Nutzerdaten, wie die API sie ausliefert (nie passwordHash!). */
export interface AuthUser {
  id: string;
  username: string;
  email: string;
  avatarUrl: string | null;
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
}
