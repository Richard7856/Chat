"use client";

import {
  generateIdentityKeypair,
  fromBase64,
  toBase64,
  type IdentityKeypair,
} from "@euromex/crypto";
import { api } from "./api";

const STORAGE_PREFIX = "euromex.key.";
const keyForDevice = (deviceId: string) => `${STORAGE_PREFIX}${deviceId}`;

interface StoredKeypair {
  publicKey: string; // base64
  privateKey: string; // base64
  createdAt: string;
}

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export async function loadKeypair(deviceId: string): Promise<IdentityKeypair | null> {
  const storage = safeStorage();
  if (!storage) return null;
  const raw = storage.getItem(keyForDevice(deviceId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredKeypair;
    return {
      publicKey: await fromBase64(parsed.publicKey),
      privateKey: await fromBase64(parsed.privateKey),
    };
  } catch {
    return null;
  }
}

async function saveKeypair(deviceId: string, kp: IdentityKeypair): Promise<void> {
  const storage = safeStorage();
  if (!storage) throw new Error("localStorage no disponible");
  const stored: StoredKeypair = {
    publicKey: await toBase64(kp.publicKey),
    privateKey: await toBase64(kp.privateKey),
    createdAt: new Date().toISOString(),
  };
  storage.setItem(keyForDevice(deviceId), JSON.stringify(stored));
}

/**
 * Asegura que este dispositivo tenga un par de claves E2EE.
 * - Si ya hay uno guardado, lo devuelve.
 * - Si no, genera uno, lo persiste localmente, publica la pública al server.
 *
 * Idempotente. Seguro llamar tras cada login.
 */
export async function ensureDeviceKeypair(deviceId: string): Promise<IdentityKeypair> {
  const existing = await loadKeypair(deviceId);
  if (existing) return existing;

  const kp = await generateIdentityKeypair();
  await saveKeypair(deviceId, kp);

  const publicKey = await toBase64(kp.publicKey);
  await api("/auth/devices/publish-identity", {
    method: "POST",
    auth: true,
    body: { identityPublicKey: publicKey },
  });

  return kp;
}

/** Elimina la clave privada local (al cerrar sesión). */
export function clearKeypair(deviceId: string): void {
  const storage = safeStorage();
  storage?.removeItem(keyForDevice(deviceId));
}
