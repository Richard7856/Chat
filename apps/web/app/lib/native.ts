/**
 * Bridge JS → Capacitor para capacidades nativas que solo existen cuando
 * la app corre dentro del wrapper Android (apps/mobile).
 *
 * Filosofía: este módulo SE COMPILA Y CORRE en el web normal sin problemas.
 * Detecta en runtime si está dentro de Capacitor (`window.Capacitor` está
 * inyectado por el WebView) y, si no, todas las funciones son no-ops.
 *
 * Esto permite que `apps/web` no tenga `@capacitor/core` como dependencia
 * — el bridge se invoca via la global que Capacitor inyecta. Menos peso
 * en el bundle web y zero impacto si alguien usa la app sin APK.
 */

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
      Plugins?: Record<
        string,
        Record<string, (...args: unknown[]) => Promise<unknown>>
      >;
    };
  }
}

/** True si el código corre dentro del WebView nativo (Capacitor Android/iOS). */
export function isNative(): boolean {
  if (typeof window === "undefined") return false;
  return window.Capacitor?.isNativePlatform?.() === true;
}

/** Plataforma actual: "android" | "ios" | "web". */
export function nativePlatform(): "android" | "ios" | "web" {
  if (typeof window === "undefined") return "web";
  const p = window.Capacitor?.getPlatform?.();
  if (p === "android" || p === "ios") return p;
  return "web";
}

/**
 * Activa o desactiva FLAG_SECURE en la ventana del Activity de Android.
 *
 * Cuando FLAG_SECURE está activo:
 *   - Se bloquean screenshots manuales (no aparece preview, sale negro)
 *   - Se bloquean screen recordings (apps tipo OBS no capturan el contenido)
 *   - El thumbnail del task switcher (Recents) sale negro
 *   - Mirroring inalámbrico (Cast/Miracast) bloqueado
 *
 * Llamamos esto en el chat con `value = !canShareExternally`. En iOS la
 * llamada es no-op (Apple no expone una API equivalente; mejor opción
 * sería detectar con UIScreen.captured y notificar al servidor).
 *
 * Implementación nativa: ver apps/mobile/SECURITY_PLUGIN.md (plugin
 * Capacitor "Security" con método setFlagSecure({ value }))
 */
export async function setFlagSecure(value: boolean): Promise<void> {
  if (!isNative()) return;
  const Security = window.Capacitor?.Plugins?.Security;
  if (!Security || typeof Security.setFlagSecure !== "function") {
    // Plugin no instalado — no romper la app, solo log
    if (typeof console !== "undefined") {
      console.warn("[native] Security plugin not available; skipping setFlagSecure");
    }
    return;
  }
  try {
    await Security.setFlagSecure({ value });
  } catch (err) {
    if (typeof console !== "undefined") {
      console.warn("[native] setFlagSecure failed", err);
    }
  }
}

/**
 * Helper de alto nivel: aplica el flag de seguridad en función del permiso
 * `can_share_externally` del usuario actual. Centraliza el invertido
 * (canShare === false → flagSecure === true).
 */
export async function applyShareExternallyPolicy(
  canShareExternally: boolean,
): Promise<void> {
  await setFlagSecure(!canShareExternally);
}
