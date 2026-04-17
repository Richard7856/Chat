import argon2 from "argon2";
import { randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";

// Argon2id con parámetros OWASP 2024: 19 MiB, 2 pasadas, 1 thread.
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * Genera un código de invitación legible (Crockford base32, sin caracteres
 * ambiguos). Devuelve {code, hash}: el code se entrega al invitado una sola
 * vez; en DB se guarda solo el hash.
 */
const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateInviteCode(): string {
  const buf = randomBytes(10);
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    out += BASE32[buf[i]! % 32];
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`;
}

export async function hashInviteCode(code: string): Promise<string> {
  // Usamos argon2 también aquí para resistir fuerza bruta offline si la DB
  // se filtra. El código es corto (16 chars base32 ≈ 80 bits de entropía).
  return argon2.hash(code, ARGON2_OPTIONS);
}

export async function verifyInviteCode(hash: string, code: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, code);
  } catch {
    return false;
  }
}

/**
 * Cifrado simétrico para secretos TOTP (y futuros secretos server-side).
 * Usa AES-256-GCM con una clave maestra de 32 bytes leída de env.
 * Formato: nonce(12) || ciphertext || tag(16).
 */
export function loadMasterKey(envValue: string): Buffer {
  const key = Buffer.from(envValue, "base64");
  if (key.length !== 32) {
    throw new Error(
      "MASTER_ENC_KEY debe ser 32 bytes en base64 (genera con: openssl rand -base64 32)",
    );
  }
  return key;
}

export function encryptSecret(key: Buffer, plaintext: string | Buffer): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const pt = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ct, tag]);
}

export function decryptSecret(key: Buffer, blob: Buffer): Buffer {
  if (blob.length < 12 + 16) throw new Error("ciphertext demasiado corto");
  const nonce = blob.subarray(0, 12);
  const tag = blob.subarray(blob.length - 16);
  const ct = blob.subarray(12, blob.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
