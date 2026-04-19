"use client";

import { fromBase64, toBase64 } from "@euromex/crypto";
import { loadSession } from "./api";

/**
 * Crypto de archivos: AES-256-GCM via WebCrypto (nativo del navegador).
 * La clave simétrica se genera fresca por cada archivo y viaja DENTRO del
 * plaintext del mensaje que referencia el adjunto — o sea, cifrada con
 * NaCl box por cada dispositivo destinatario. El server nunca la ve.
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
 * Cifra un File en el navegador y lo sube como multipart a la API.
 * Devuelve {attachmentId, fileKey, fileIv} para que el caller los ponga
 * en el plaintext del mensaje que se cifrará con los envelopes.
 */
export async function encryptAndUpload(
  conversationId: string,
  file: File,
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

  // Usa un Blob neutro — el servidor no debe inferir el MIME real.
  const ciphertextBlob = new Blob([ctBuf], { type: "application/octet-stream" });

  const form = new FormData();
  form.append("blob", ciphertextBlob, "blob.enc");

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
 * Descarga el ciphertext y lo descifra en memoria. Devuelve un Blob con
 * el MIME original (que venía en el plaintext del mensaje).
 */
export async function downloadAndDecrypt(params: {
  attachmentId: string;
  fileKey: string;
  fileIv: string;
  mime: string;
}): Promise<Blob> {
  const session = loadSession();
  if (!session) throw new Error("no_session");

  const res = await fetch(
    `${API_BASE}/attachments/${params.attachmentId}/download`,
    { headers: { Authorization: `Bearer ${session.accessToken}` } },
  );
  if (!res.ok) throw new Error(`download_failed_${res.status}`);

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
}): Promise<void> {
  const blob = await downloadAndDecrypt(params);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = params.fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Deja un tick para que el browser tome el blob antes de revocarlo.
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }

  // Notifica al server (best-effort). Crea un mensaje de sistema visible
  // a todos los miembros de la conversación. Si falla, no rompe la UX.
  notifyDownload(params.attachmentId, params.fileName, params.byteSize).catch(
    () => {},
  );
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
