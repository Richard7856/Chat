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
import { argon2id } from "hash-wasm";

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

// ===========================================================================
// Fase 31 — primitivas para identidad por usuario con escrow
//
// Estas funciones NO se usan en el flujo actual (identidad por device). Son
// la base aislada (Capa 1) del nuevo modelo: una identidad por usuario cuya
// llave privada se guarda cifrada de dos formas (con la contraseña del
// usuario y con la llave de escrow de la organización). Ver
// docs/FASE-31-IDENTIDAD-ESCROW.md.
// ===========================================================================

/** Caja simétrica autenticada (XSalsa20-Poly1305). nonce viaja en claro. */
export interface SecretBox {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

/** Longitud de salt para la derivación de contraseña (16 bytes). */
export const PASSWORD_SALT_BYTES = 16;

/**
 * Parámetros de Argon2id para derivar una llave simétrica desde la
 * contraseña del usuario. Fijos por ahora; si se suben en el futuro, hay
 * que versionar el blob (un device con params viejos debe poder re-derivar).
 *
 * 64 MiB de memoria + 3 iteraciones: ~200-500ms en un browser moderno.
 * Balance entre resistencia a brute-force (si roban el blob cifrado) y UX
 * de login. parallelism=1 porque el browser es efectivamente single-thread
 * para esto.
 */
export const ARGON2_PARAMS = {
  parallelism: 1,
  iterations: 3,
  memorySize: 65536, // KiB = 64 MiB
  hashLength: 32, // bytes → llave para secretbox
} as const;

/** Genera un salt aleatorio para derivar la llave de contraseña. */
export function randomSalt(): Uint8Array {
  return nacl.randomBytes(PASSWORD_SALT_BYTES);
}

/**
 * Deriva una llave simétrica de 32 bytes desde una contraseña, usando
 * Argon2id (mismo algoritmo que el server usa para password_hash, vía
 * hash-wasm para que corra en el browser).
 *
 * @param password contraseña del usuario en claro (solo en memoria)
 * @param salt     salt aleatorio (`randomSalt()`), se persiste junto al blob
 * @returns        Uint8Array de 32 bytes — NO persistir; vive solo en memoria
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  return argon2id({
    password,
    salt,
    parallelism: ARGON2_PARAMS.parallelism,
    iterations: ARGON2_PARAMS.iterations,
    memorySize: ARGON2_PARAMS.memorySize,
    hashLength: ARGON2_PARAMS.hashLength,
    outputType: "binary",
  });
}

/**
 * Cifra datos con una llave simétrica de 32 bytes (XSalsa20-Poly1305).
 * Para envolver la llave privada de identidad con la llave derivada de la
 * contraseña.
 */
export async function secretboxSeal(
  plaintext: Uint8Array,
  key: Uint8Array,
): Promise<SecretBox> {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength); // 24 bytes
  const ciphertext = nacl.secretbox(plaintext, nonce, key);
  return { ciphertext, nonce };
}

/** Abre una caja simétrica. Lanza si la llave es incorrecta o hubo tampering. */
export async function secretboxOpen(
  box: SecretBox,
  key: Uint8Array,
): Promise<Uint8Array> {
  const pt = nacl.secretbox.open(box.ciphertext, box.nonce, key);
  if (!pt) throw new Error("secretbox_open_failed");
  return pt;
}

/**
 * Empaqueta un SecretBox en un solo blob (nonce || ciphertext) para
 * almacenarlo/transmitirlo como un BYTEA/base64 único. Inverso: unpackSecretBox.
 */
export function packSecretBox(box: SecretBox): Uint8Array {
  const out = new Uint8Array(box.nonce.length + box.ciphertext.length);
  out.set(box.nonce, 0);
  out.set(box.ciphertext, box.nonce.length);
  return out;
}

/** Inverso de packSecretBox: separa nonce(24) || ciphertext. */
export function unpackSecretBox(blob: Uint8Array): SecretBox {
  if (blob.length < nacl.secretbox.nonceLength) {
    throw new Error("secretbox_blob_too_short");
  }
  return {
    nonce: blob.subarray(0, nacl.secretbox.nonceLength),
    ciphertext: blob.subarray(nacl.secretbox.nonceLength),
  };
}

/**
 * "Sealed box" — cifrado anónimo hacia una llave pública (estilo
 * crypto_box_seal de libsodium, que tweetnacl no expone). Se usa para
 * cifrar la llave privada de identidad del usuario hacia la llave pública
 * de escrow de la organización: cualquiera puede sellar, solo quien tenga
 * la privada de escrow puede abrir.
 *
 * Implementación: keypair efímero + nonce aleatorio. El efímero se descarta
 * tras sellar (su privada nunca se guarda), por lo que solo el destinatario
 * puede descifrar.
 *
 * Formato del blob: ephemeralPub(32) || nonce(24) || ciphertext.
 */
export async function sealedBoxSeal(
  plaintext: Uint8Array,
  recipientPublicKey: Uint8Array,
): Promise<Uint8Array> {
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength); // 24 bytes
  const ct = nacl.box(plaintext, nonce, recipientPublicKey, eph.secretKey);
  const out = new Uint8Array(32 + 24 + ct.length);
  out.set(eph.publicKey, 0);
  out.set(nonce, 32);
  out.set(ct, 56);
  return out;
}

/**
 * Abre un sealed box con la llave privada del destinatario (la privada de
 * escrow). No requiere la pública del remitente: viaja embebida (efímera).
 * Lanza si el blob está corrupto o la privada es incorrecta.
 */
export async function sealedBoxOpen(
  sealed: Uint8Array,
  recipientPrivateKey: Uint8Array,
): Promise<Uint8Array> {
  if (sealed.length < 56) throw new Error("sealed_box_too_short");
  const ephemeralPub = sealed.subarray(0, 32);
  const nonce = sealed.subarray(32, 56);
  const ct = sealed.subarray(56);
  const pt = nacl.box.open(ct, nonce, ephemeralPub, recipientPrivateKey);
  if (!pt) throw new Error("sealed_box_open_failed");
  return pt;
}

/**
 * Genera el keypair de escrow de la organización. Se corre UNA SOLA VEZ al
 * inicializar el sistema. La pública se embebe/distribuye para sellar
 * identidades; la privada se cifra con MASTER_ENC_KEY en el server (Opción A,
 * ADR-040) y se respalda offline. Es X25519, mismo tipo que las identidades.
 */
export async function generateEscrowKeypair(): Promise<IdentityKeypair> {
  const kp = nacl.box.keyPair();
  return { publicKey: kp.publicKey, privateKey: kp.secretKey };
}
