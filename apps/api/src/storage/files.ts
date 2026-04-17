import { createWriteStream } from "node:fs";
import { access, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { config } from "../config.js";

/**
 * Almacenamiento en disco para blobs cifrados. El server nunca ve plaintext —
 * el cliente los cifra antes de subir. Sustituible por MinIO/S3 sin cambiar
 * los callers (misma API pública).
 */

let initialized = false;

async function ensureStorageDir(): Promise<void> {
  if (initialized) return;
  await mkdir(config.storageDir, { recursive: true });
  initialized = true;
}

/**
 * Genera una clave de almacenamiento aleatoria. Usamos 2 niveles de prefijo
 * (ab/cd/full-uuid) para no acumular miles de archivos en el mismo directorio
 * inode — mejor para `ls` y para filesystems tipo ext4.
 */
export function generateStorageKey(): string {
  const id = randomUUID().replace(/-/g, "");
  return `${id.slice(0, 2)}/${id.slice(2, 4)}/${id}.bin`;
}

function resolveStoragePath(storageKey: string): string {
  // Protección básica anti path traversal.
  if (storageKey.includes("..") || storageKey.startsWith("/")) {
    throw new Error("invalid_storage_key");
  }
  return join(config.storageDir, storageKey);
}

/**
 * Guarda un stream como blob y devuelve el tamaño final escrito.
 */
export async function writeBlob(storageKey: string, input: Readable): Promise<number> {
  await ensureStorageDir();
  const fullPath = resolveStoragePath(storageKey);
  await mkdir(join(fullPath, ".."), { recursive: true });

  let written = 0;
  const sink = createWriteStream(fullPath, { flags: "wx" });
  // Cuenta bytes mientras pasan.
  input.on("data", (chunk: Buffer) => {
    written += chunk.length;
  });
  await pipeline(input, sink);
  return written;
}

export function streamBlob(storageKey: string): {
  path: string;
} {
  return { path: resolveStoragePath(storageKey) };
}

export async function deleteBlob(storageKey: string): Promise<void> {
  try {
    await rm(resolveStoragePath(storageKey), { force: true });
  } catch {
    // no-op
  }
}

export async function blobSize(storageKey: string): Promise<number | null> {
  try {
    const s = await stat(resolveStoragePath(storageKey));
    return s.size;
  } catch {
    return null;
  }
}

export async function blobExists(storageKey: string): Promise<boolean> {
  try {
    await access(resolveStoragePath(storageKey));
    return true;
  } catch {
    return false;
  }
}
