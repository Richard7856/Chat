const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

export const SESSION_STORAGE_KEY = "euromex.session";

export interface StoredSession {
  accessToken: string;
  expiresInSec: number;
  user: {
    id: string;
    username: string;
    displayName: string;
    role: "user" | "admin";
  };
  device: {
    id: string;
    deviceName: string;
    platform: "web" | "ios" | "android" | "desktop";
  };
}

export function loadSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession) {
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearSession() {
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    auth?: boolean;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.auth) {
    const s = loadSession();
    if (s) headers["Authorization"] = `Bearer ${s.accessToken}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "POST",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    let errMsg = `${res.status}`;
    try {
      const payload = (await res.json()) as { error?: string };
      if (payload.error) errMsg = payload.error;
    } catch {}
    throw new ApiError(errMsg, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
