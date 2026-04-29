"use client";

import { fromBase64, toBase64 } from "@euromex/crypto";
import { loadSession } from "./api";

/**
 * Crypto de archivos: AES-256-GCM via WebCrypto (nativo del navegador).
 * La clave simétrica se genera fresca por cada archivo y viaja DENTRO del
 * plaintext del mensaje que referencia el adjunto — cifrada con NaCl box
 * por cada dispositivo destinatario. El server nunca la ve.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

export interface EncryptedUpload {
  attachmentId: string;
  byteSize: number;
  fileKey: string; // base64, 32 bytes
  fileIv: string;  // base64, 12 bytes
}

export interface FileMeta {
  fileName: string;
  mime: string;
  byteSize: number;
}

async function importAesKey(raw: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, [usage]);
}

/**
 * Cifra un File y lo sube a la API.
 * Opciones de Fase 14:
 *   downloadPin     — PIN de descarga (el servidor guarda el hash)
 *   allowedUserIds  — Si se pasan, el acceso queda restringido a esos usuarios
 */
export async function encryptAndUpload(
  conversationId: string,
  file: File,
  opts: { downloadPin?: string; allowedUserIds?: string[] } = {},
): Promise<EncryptedUpload & FileMeta> {
  const session = loadSession();
  if (!session) throw new Error("no_session");

  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const plaintext = new Uint8Array(await file.arrayBuffer());
  const aesKey = await importAesKey(rawKey, "encrypt");
  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    aesKey,
    plaintext as BufferSource,
  );

  // El campo se llama "file" para que el parser multipart del server lo detecte.
  const ciphertextBlob = new Blob([ctBuf], { type: "application/octet-stream" });
  const form = new FormData();
  form.append("file", ciphertextBlob, "blob.enc");

  if (opts.downloadPin) {
    form.append("downloadPin", opts.downloadPin);
  }
  if (opts.allowedUserIds && opts.allowedUserIds.length > 0) {
    form.append("allowedUserIds", JSON.stringify(opts.allowedUserIds));
  }

  const res = await fetch(
    `${API_BASE}/conversations/${conversationId}/attachments`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessToken}` },
      body: form,
    },
  );

  if (!res.ok) {
    let err = `${res.status}`;
    try {
      const payload = (await res.json()) as { error?: string };
      if (payload.error) err = payload.error;
    } catch {}
    throw new Error(err);
  }

  const body = (await res.json()) as { attachmentId: string; byteSize: number };

  return {
    attachmentId: body.attachmentId,
    byteSize: body.byteSize,
    fileKey: await toBase64(rawKey),
    fileIv: await toBase64(iv),
    fileName: file.name,
    mime: file.type || "application/octet-stream",
  };
}

/**
 * Descarga el ciphertext y lo descifra en memoria.
 * Si el adjunto tiene PIN, se pasa en el header X-Download-Pin.
 */
export async function downloadAndDecrypt(params: {
  attachmentId: string;
  fileKey: string;
  fileIv: string;
  mime: string;
  downloadPin?: string;
}): Promise<Blob> {
  const session = loadSession();
  if (!session) throw new Error("no_session");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.accessToken}`,
  };
  if (params.downloadPin) {
    headers["X-Download-Pin"] = params.downloadPin;
  }

  const res = await fetch(
    `${API_BASE}/attachments/${params.attachmentId}/download`,
    { headers },
  );
  if (!res.ok) {
    let code = `download_failed_${res.status}`;
    try {
      const payload = (await res.json()) as { error?: string };
      if (payload.error) code = payload.error;
    } catch {}
    throw new Error(code);
  }

  const ciphertext = new Uint8Array(await res.arrayBuffer());
  const rawKey = await fromBase64(params.fileKey);
  const iv = await fromBase64(params.fileIv);
  const aesKey = await importAesKey(rawKey, "decrypt");
  const ptBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    aesKey,
    ciphertext as BufferSource,
  );

  return new Blob([ptBuf], { type: params.mime || "application/octet-stream" });
}

/** Descarga + descifrado + save-as en el navegador. */
export async function downloadFileToUser(params: {
  attachmentId: string;
  fileKey: string;
  fileIv: string;
  fileName: string;
  mime: string;
  byteSize: number;
  downloadPin?: string;
}): Promise<void> {
  const blob = await downloadAndDecrypt(params);
  triggerFileSave(blob, params.fileName);
  notifyDownload(params.attachmentId, params.fileName, params.byteSize).catch(() => {});
}

function triggerFileSave(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }
}

async function notifyDownload(
  attachmentId: string,
  fileName: string,
  byteSize: number,
): Promise<void> {
  const session = loadSession();
  if (!session) return;
  await fetch(`${API_BASE}/attachments/${attachmentId}/downloaded`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({ fileName, byteSize }),
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
