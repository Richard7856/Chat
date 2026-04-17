/**
 * Euromex chat — primitivas E2EE basadas en NaCl (tweetnacl, pure JS).
 *
 * Diseño mínimo (Fase 4):
 *   - Cada dispositivo tiene un par de claves X25519 (identity keypair).
 *   - La privada vive solo en el cliente (localStorage).
 *   - La pública se publica al servidor en `devices.identity_public_key`.
 *   - Cada mensaje se cifra con `nacl.box` una vez por cada dispositivo
 *     destinatario (incluyendo los otros dispositivos del propio emisor).
 *   - El servidor solo almacena/enruta ciphertext + nonce; nunca ve plaintext.
 *
 * Algoritmo: `nacl.box` = X25519 (intercambio de clave) + XSalsa20-Poly1305
 * (cifrado autenticado). Mismo que `crypto_box` de libsodium, mismas
 * propiedades.
 *
 * Propiedades de seguridad:
 *   ✔ Confidencialidad — solo el dispositivo destinatario puede descifrar.
 *   ✔ Autenticación   — box autentica al emisor implícitamente (Poly1305).
 *   ✔ Integridad      — MAC rechaza mensajes manipulados.
 *   ✖ Forward secrecy — si la privada se filtra, mensajes pasados se pueden
 *                        leer. Upgrade opcional a Double Ratchet en Fase 5+.
 */
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

export interface IdentityKeypair {
  /** 32 bytes — X25519 pública, publicable. */
  publicKey: Uint8Array;
  /** 32 bytes — X25519 privada. NUNCA abandona el cliente. */
  privateKey: Uint8Array;
}

export interface Envelope {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

export interface EnvelopeBase64 {
  ciphertext: string;
  nonce: string;
}

/**
 * No-op: tweetnacl es sync, no necesita warm-up. Mantenido por compatibilidad
 * con la API previa para no romper los callers.
 */
export async function ready(): Promise<void> {
  return;
}

export async function generateIdentityKeypair(): Promise<IdentityKeypair> {
  const kp = nacl.box.keyPair();
  return { publicKey: kp.publicKey, privateKey: kp.secretKey };
}

export async function encryptFor(
  plaintext: Uint8Array,
  recipientPublicKey: Uint8Array,
  senderPrivateKey: Uint8Array,
): Promise<Envelope> {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.box(plaintext, nonce, recipientPublicKey, senderPrivateKey);
  return { ciphertext, nonce };
}

export async function decryptFrom(
  envelope: Envelope,
  senderPublicKey: Uint8Array,
  recipientPrivateKey: Uint8Array,
): Promise<Uint8Array> {
  const pt = nacl.box.open(
    envelope.ciphertext,
    envelope.nonce,
    senderPublicKey,
    recipientPrivateKey,
  );
  if (!pt) throw new Error("decryption_failed");
  return pt;
}

// ---------------------------------------------------------------------------
// Helpers de texto / base64
// ---------------------------------------------------------------------------

export async function encodeUtf8(text: string): Promise<Uint8Array> {
  return naclUtil.decodeUTF8(text);
}

export async function decodeUtf8(bytes: Uint8Array): Promise<string> {
  return naclUtil.encodeUTF8(bytes);
}

export async function toBase64(bytes: Uint8Array): Promise<string> {
  return naclUtil.encodeBase64(bytes);
}

export async function fromBase64(s: string): Promise<Uint8Array> {
  return naclUtil.decodeBase64(s);
}

export async function envelopeToBase64(env: Envelope): Promise<EnvelopeBase64> {
  return {
    ciphertext: await toBase64(env.ciphertext),
    nonce: await toBase64(env.nonce),
  };
}

export async function envelopeFromBase64(env: EnvelopeBase64): Promise<Envelope> {
  return {
    ciphertext: await fromBase64(env.ciphertext),
    nonce: await fromBase64(env.nonce),
  };
}

/**
 * "Safety number" para verificación humana de identidad.
 * Hash SHA-512 truncado de ambas claves públicas (ordenadas determinísticamente),
 * formateado como 12 grupos de 5 dígitos. Análogo al "security code" de
 * WhatsApp/Signal.
 */
export async function safetyNumber(
  localIdentity: Uint8Array,
  remoteIdentity: Uint8Array,
): Promise<string> {
  const [a, b] =
    compare(localIdentity, remoteIdentity) <= 0
      ? [localIdentity, remoteIdentity]
      : [remoteIdentity, localIdentity];
  const concat = new Uint8Array(a.length + b.length);
  concat.set(a);
  concat.set(b, a.length);
  const hash = nacl.hash(concat); // SHA-512, 64 bytes
  let digits = "";
  for (let i = 0; i < hash.length && digits.length < 60; i++) {
    digits += hash[i]!.toString().padStart(3, "0");
  }
  digits = digits.slice(0, 60);
  return digits.match(/.{5}/g)!.join(" ");
}

function compare(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return a.length - b.length;
}
