/** Schlanker Fetch-Wrapper für die Parley-API mit einheitlicher Fehlerbehandlung. */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  accessToken?: string | null;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    // Cookies (Refresh-Token) nur an unseren eigenen Origin senden.
    credentials: 'same-origin',
  });

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get('content-type')?.includes('application/json') ?? false;
  const data: unknown = isJson ? await res.json() : null;

  if (!res.ok) throw toApiError(res, data);
  return data as T;
}

/** Roh-Upload für verschlüsselte Anhänge (Phase 8) – Body ist der Ciphertext. */
export async function apiUpload<T>(
  path: string,
  body: Uint8Array,
  accessToken?: string | null,
): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body as BodyInit,
    credentials: 'same-origin',
  });
  const isJson = res.headers.get('content-type')?.includes('application/json') ?? false;
  const data: unknown = isJson ? await res.json() : null;
  if (!res.ok) throw toApiError(res, data);
  return data as T;
}

/** Binär-Download (Ciphertext-Blob eines Anhangs). */
export async function apiDownload(path: string, accessToken?: string | null): Promise<Uint8Array> {
  const res = await fetch(path, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const isJson = res.headers.get('content-type')?.includes('application/json') ?? false;
    throw toApiError(res, isJson ? await res.json() : null);
  }
  return new Uint8Array(await res.arrayBuffer());
}

function toApiError(res: Response, data: unknown): ApiError {
  // NestJS liefert message als String oder String-Array (Validierungsfehler).
  const raw = (data as { message?: string | string[] } | null)?.message;
  const message = Array.isArray(raw) ? raw.join(' · ') : (raw ?? `Fehler ${res.status}`);
  return new ApiError(res.status, message);
}
