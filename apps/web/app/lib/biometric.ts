/**
 * Fase 27 — Wrapper de biometría para Android (BiometricPrompt) y iOS
 * (LocalAuthentication / Face ID + Touch ID).
 *
 * Estrategia E2EE-friendly:
 * - El "secret" guardado en Keystore/Keychain es el biometric_unlock_token
 *   que emite el server (JWT firmado con TTL 90d). NUNCA es el password ni
 *   el TOTP secret.
 * - El plugin capacitor-native-biometric envuelve nativamente:
 *   • Android Keystore con KeyGenParameterSpec.setUserAuthenticationRequired
 *   • iOS Keychain con kSecAccessControlBiometryAny / BiometryCurrentSet
 * - En web puro (no APK) todo este módulo es un no-op: las funciones
 *   resuelven con valores que indican "no disponible" sin tirar errores.
 *
 * Patrón de uso:
 *   1. Activar (settings):  enableBiometricUnlock(token, username)
 *   2. Re-loguear:          token = await unlockWithBiometric()
 *                           → POST /auth/biometric/unlock { biometricToken: token }
 *   3. Desactivar:          clearBiometricUnlock()
 *   4. Step-up admin:       const ok = await verifyBiometric("Razón…")
 */

import { Capacitor } from "@capacitor/core";

// El plugin se importa lazy en cada función para evitar que un import top-
// level intente inicializar código nativo durante SSR de Next.js.
// (Capacitor.isNativePlatform() en Node devuelve false sin tirar error,
// así que feature-detection funciona en cualquier ambiente.)

let cachedAvailable: boolean | null = null;

/**
 * Devuelve true SOLO si:
 * - El runtime es Capacitor nativo (APK/IPA, no browser ni SSR).
 * - El device tiene sensor biométrico (huella o face).
 * - Hay al menos una huella/face enrolada.
 *
 * Cached por sesión: el resultado no cambia mientras la app esté abierta.
 * Si el usuario sale a Settings, enrola una huella y vuelve, requiere
 * cerrar y reabrir la app. Trade-off aceptable.
 */
export async function isBiometricAvailable(): Promise<boolean> {
  if (cachedAvailable !== null) return cachedAvailable;
  if (typeof window === "undefined") {
    cachedAvailable = false;
    return false;
  }
  if (!Capacitor.isNativePlatform()) {
    cachedAvailable = false;
    return false;
  }
  try {
    const { NativeBiometric } = await import("capacitor-native-biometric");
    const r = await NativeBiometric.isAvailable();
    cachedAvailable = !!r.isAvailable;
    return cachedAvailable;
  } catch {
    cachedAvailable = false;
    return false;
  }
}

/** Identificador del slot en Keychain/Keystore. Único por app, no por user. */
const BIOMETRIC_SLOT = "euromex.biometric.unlock";

/** Flag local — el server es la autoridad pero el cliente cachea para
 *  decidir qué pantalla de login mostrar al abrir la app. */
const LOCAL_FLAG_KEY = "euromex.biometric.enabled";

/**
 * Guarda el biometric_unlock_token (JWT del server) en Keystore/Keychain
 * cifrado con biometría. El cliente NO debe persistirlo en localStorage.
 *
 * `username` se guarda junto al token solo para mostrar "@usuario" al lado
 * del botón biométrico en la pantalla de login (UX, no seguridad).
 */
export async function enableBiometricUnlock(
  token: string,
  username: string,
): Promise<void> {
  if (!(await isBiometricAvailable())) {
    throw new Error("biometric_unavailable");
  }
  const { NativeBiometric } = await import("capacitor-native-biometric");
  await NativeBiometric.setCredentials({
    server: BIOMETRIC_SLOT,
    username,
    password: token,
  });
  if (typeof window !== "undefined") {
    window.localStorage.setItem(LOCAL_FLAG_KEY, "1");
  }
}

/**
 * Trigger del biometric prompt → si el usuario pasa la verificación,
 * recupera el token guardado. Si cancela, falla, o no hay credenciales,
 * devuelve null (sin throw) para que el UI fallback al login normal.
 */
export async function unlockWithBiometric(): Promise<{ token: string; username: string } | null> {
  if (!(await isBiometricAvailable())) return null;
  try {
    const { NativeBiometric } = await import("capacitor-native-biometric");
    await NativeBiometric.verifyIdentity({
      reason: "Iniciar sesión en Euromex Chat",
      title: "Confirmación biométrica",
      subtitle: "Usa tu huella o Face ID",
      description: "Confirma tu identidad para entrar.",
    });
    const cred = await NativeBiometric.getCredentials({ server: BIOMETRIC_SLOT });
    return { token: cred.password, username: cred.username };
  } catch {
    return null;
  }
}

/**
 * Borra el token del Keystore/Keychain. Llamar cuando:
 * - El usuario desactiva biometría en Settings (después de hit /disable).
 * - El server respondió `biometric_revoked` al unlock (token ya no sirve).
 * - El usuario hizo logout total (?). Discutible — por ahora SÍ se borra
 *   en logout para que un atacante físico que roba el device sin la huella
 *   tampoco pueda explotar la conveniencia. Si en el futuro queremos
 *   "logout sin perder biometría" eso requiere cambios en este wrapper.
 */
export async function clearBiometricUnlock(): Promise<void> {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(LOCAL_FLAG_KEY);
  }
  if (!(await isBiometricAvailable())) return;
  try {
    const { NativeBiometric } = await import("capacitor-native-biometric");
    await NativeBiometric.deleteCredentials({ server: BIOMETRIC_SLOT });
  } catch {
    // Silencio — puede no haber credenciales para borrar.
  }
}

/**
 * Lee el flag local sin tocar Keystore. Útil para que el UI decida
 * "¿muestro el botón biométrico?" sin pagar el costo de un prompt nativo.
 *
 * NOTA: el flag puede mentir si el usuario limpió el storage de la app
 * pero no las credenciales del Keystore (Android raramente, iOS más
 * común). En ese caso el siguiente unlock fallará y el UI debe fallback
 * al login normal sin asumir que la mentira es maliciosa.
 */
export function hasLocalBiometricFlag(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(LOCAL_FLAG_KEY) === "1";
}

/**
 * Step-up auth biométrico para acciones admin sensibles. NO involucra al
 * server: solo el prompt nativo. El caller interpreta el `true` como "el
 * dueño biométrico del device acaba de confirmar la acción aquí, ahora".
 *
 * Si el device no tiene biometría disponible (ej. estamos en la web),
 * devuelve `false` y el caller debe fallback a re-auth TOTP.
 */
export async function verifyBiometric(reason: string): Promise<boolean> {
  if (!(await isBiometricAvailable())) return false;
  try {
    const { NativeBiometric } = await import("capacitor-native-biometric");
    await NativeBiometric.verifyIdentity({
      reason,
      title: "Confirmación biométrica",
      subtitle: "Esta acción requiere autenticación",
      description: reason,
    });
    return true;
  } catch {
    return false;
  }
}
