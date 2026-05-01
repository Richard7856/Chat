const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

export const SESSION_STORAGE_KEY = "euromex.session";

/**
 * Permisos granulares (Fase 24). Coinciden con UserPermissionsSchema en el
 * shared package — duplicados aquí en la sesión local para no tener que
 * hacer fetch de /auth/me cada vez que el cliente decide ocultar UI.
 */
export interface SessionPermissions {
  canDownloadAttachments: boolean;
  canShareExternally: boolean;
  canCreateGroups: boolean;
  canInviteUsers: boolean;
  canInitiateCalls: boolean;
  maxAttachmentMb: number;
}

export interface StoredSession {
  accessToken: string;
  expiresInSec: number;
  user: {
    id: string;
    username: string;
    displayName: string;
    role: "user" | "admin";
    /** Fase 24 — opcional para sesiones viejas que no traen permisos. */
    permissions?: SessionPermissions;
  };
  device: {
    id: string;
    deviceName: string;
    platform: "web" | "ios" | "android" | "desktop";
  };
}

/** Defaults conservadores cuando la sesión es vieja (pre-Fase 24). */
export const DEFAULT_PERMISSIONS: SessionPermissions = {
  canDownloadAttachments: true,
  canShareExternally: false,
  canCreateGroups: true,
  canInviteUsers: false,
  canInitiateCalls: true,
  maxAttachmentMb: 50,
};

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
  // El device hint se guarda por separado y sobrevive a clearSession().
  // La página de login lo lee para ofrecer re-auth con solo TOTP.
  _saveDeviceHint({
    deviceId: session.device.id,
    username: session.user.username,
    displayName: session.user.displayName,
  });
}

/** Limpia el token de acceso sin tocar el device hint ni el keypair E2EE. */
export function clearSession() {
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

// ============================================================================
// Device hint — persiste entre sesiones para el flujo de re-auth
// ============================================================================

const DEVICE_HINT_KEY = "euromex.device-hint";

/** Datos mínimos del dispositivo conocido, usados en el login rápido. */
export interface DeviceHint {
  deviceId: string;
  username: string;
  displayName: string;
}

function _saveDeviceHint(hint: DeviceHint) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEVICE_HINT_KEY, JSON.stringify(hint));
}

export function loadDeviceHint(): DeviceHint | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(DEVICE_HINT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DeviceHint;
  } catch {
    return null;
  }
}

/** Borra el hint — se llama cuando el device fue revocado o el usuario
 *  elige "usar otra cuenta". */
export function clearDeviceHint() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DEVICE_HINT_KEY);
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
