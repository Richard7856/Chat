"use client";

/**
 * Identidad por usuario — Fase 31 (cliente).
 *
 * Reemplaza el modelo de "una llave por dispositivo" (keys.ts) por "una llave
 * por usuario", compartida entre todos sus dispositivos y recuperable vía
 * escrow. Ver docs/FASE-31-IDENTIDAD-ESCROW.md.
 *
 * Flujo:
 *   - Primer login en un device: descifra la identidad con la contraseña
 *     (o la genera + enrolla si el usuario aún no tiene), y la cachea en
 *     localStorage de ESTE device.
 *   - Reauth rápido / biometría: usa la copia cacheada (no hay contraseña).
 *   - Otro device: primer login con contraseña → descifra la MISMA identidad
 *     → ambos comparten historial.
 *
 * IMPORTANTE: este módulo NO se conecta aún a la mensajería ni al login. Se
 * activará en la Capa 7 (switch device→usuario). Hasta entonces convive con
 * keys.ts sin efecto sobre el chat actual.
 */
import {
  generateIdentityKeypair,
  deriveKeyFromPassword,
  randomSalt,
  secretboxSeal,
  secretboxOpen,
  packSecretBox,
  unpackSecretBox,
  sealedBoxSeal,
  toBase64,
  fromBase64,
  type IdentityKeypair,
} from "@euromex/crypto";
import { api } from "./api";

const STORAGE_PREFIX = "euromex.identity.";
const keyForUser = (userId: string) => `${STORAGE_PREFIX}${userId}`;

interface StoredIdentity {
  publicKey: string; // base64
  privateKey: string; // base64
  cachedAt: string;
}

interface IdentityStatusResponse {
  hasIdentity: boolean;
  identityPublic: string | null;
  identityEncPw: string | null;
  pwSalt: string | null;
}

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Lee la identidad cacheada localmente en este device (sin contraseña). */
export async function loadUserIdentityLocal(userId: string): Promise<IdentityKeypair | null> {
  const storage = safeStorage();
  if (!storage) return null;
  const raw = storage.getItem(keyForUser(userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredIdentity;
    return {
      publicKey: await fromBase64(parsed.publicKey),
      privateKey: await fromBase64(parsed.privateKey),
    };
  } catch {
    return null;
  }
}

/** Cachea la identidad del usuario en localStorage de este device. */
async function saveUserIdentityLocal(userId: string, kp: IdentityKeypair): Promise<void> {
  const storage = safeStorage();
  if (!storage) throw new Error("localStorage no disponible");
  const stored: StoredIdentity = {
    publicKey: await toBase64(kp.publicKey),
    privateKey: await toBase64(kp.privateKey),
    cachedAt: new Date().toISOString(),
  };
  storage.setItem(keyForUser(userId), JSON.stringify(stored));
}

/** Borra la identidad cacheada (al cerrar sesión total o al revocar). */
export function clearUserIdentityLocal(userId: string): void {
  safeStorage()?.removeItem(keyForUser(userId));
}

/**
 * Genera una identidad nueva, la envuelve con la contraseña y con la pública
 * de escrow, y la enrolla en el server. Devuelve el keypair (cacheado local).
 */
async function enrollNewIdentity(userId: string, password: string): Promise<IdentityKeypair> {
  const kp = await generateIdentityKeypair();

  // Envoltura con contraseña (Argon2id → secretbox).
  const salt = randomSalt();
  const pwKey = await deriveKeyFromPassword(password, salt);
  const encPw = packSecretBox(await secretboxSeal(kp.privateKey, pwKey));

  // Envoltura con escrow (sealed box hacia la pública de la organización).
  const escrowRes = await api<{ escrowPublic: string }>("/auth/identity/escrow-pubkey", {
    method: "GET",
    auth: true,
  });
  const escrowPub = await fromBase64(escrowRes.escrowPublic);
  const encEscrow = await sealedBoxSeal(kp.privateKey, escrowPub);

  await api("/auth/identity", {
    method: "POST",
    auth: true,
    body: {
      identityPublic: await toBase64(kp.publicKey),
      identityEncPw: await toBase64(encPw),
      pwSalt: await toBase64(salt),
      identityEncEscrow: await toBase64(encEscrow),
    },
  });

  await saveUserIdentityLocal(userId, kp);
  return kp;
}

/**
 * Asegura que este device tenga la identidad del usuario disponible.
 * Requiere la contraseña (para descifrar o enrollar). Llamar en login normal.
 *
 * @returns el keypair de identidad del usuario (compartido entre devices)
 */
export async function ensureUserIdentity(
  userId: string,
  password: string,
): Promise<IdentityKeypair> {
  // 1. ¿Ya está cacheada en este device?
  const cached = await loadUserIdentityLocal(userId);
  if (cached) return cached;

  // 2. ¿El usuario ya tiene identidad en el server? → descifrar con password.
  const status = await api<IdentityStatusResponse>("/auth/identity", {
    method: "GET",
    auth: true,
  });

  if (status.hasIdentity && status.identityEncPw && status.pwSalt) {
    const salt = await fromBase64(status.pwSalt);
    const pwKey = await deriveKeyFromPassword(password, salt);
    const blob = await fromBase64(status.identityEncPw);
    let privateKey: Uint8Array;
    try {
      privateKey = await secretboxOpen(unpackSecretBox(blob), pwKey);
    } catch {
      // Contraseña no coincide con la que envolvió la identidad. Esto puede
      // pasar si el server tiene la identidad pero el usuario entró con una
      // password que aún no re-envolvió. Propagamos para que el caller decida
      // (forzar recovery por escrow).
      throw new Error("identity_password_mismatch");
    }
    const kp: IdentityKeypair = {
      publicKey: await fromBase64(status.identityPublic!),
      privateKey,
    };
    await saveUserIdentityLocal(userId, kp);
    return kp;
  }

  // 3. No tiene identidad → generar + enrollar.
  return enrollNewIdentity(userId, password);
}

/**
 * Re-envuelve la identidad con una contraseña nueva (cambio de password).
 * Requiere la identidad ya en memoria/cache y la nueva contraseña.
 */
export async function rewrapIdentityWithNewPassword(
  userId: string,
  newPassword: string,
): Promise<void> {
  const kp = await loadUserIdentityLocal(userId);
  if (!kp) throw new Error("no_local_identity");
  const salt = randomSalt();
  const pwKey = await deriveKeyFromPassword(newPassword, salt);
  const encPw = packSecretBox(await secretboxSeal(kp.privateKey, pwKey));
  await api("/auth/identity/rewrap", {
    method: "POST",
    auth: true,
    body: {
      identityEncPw: await toBase64(encPw),
      pwSalt: await toBase64(salt),
    },
  });
}
