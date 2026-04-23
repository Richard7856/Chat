import { describe, it, expect } from "vitest";
import {
  generateIdentityKeypair,
  encryptFor,
  decryptFrom,
  encodeUtf8,
  decodeUtf8,
  envelopeToBase64,
  envelopeFromBase64,
  safetyNumber,
} from "./index.js";

describe("E2EE primitivas (NaCl box)", () => {
  it("roundtrip: Alice cifra → Bob descifra el mismo texto", async () => {
    const alice = await generateIdentityKeypair();
    const bob = await generateIdentityKeypair();
    const plaintext = await encodeUtf8("hola Bob, prueba roundtrip");

    const env = await encryptFor(plaintext, bob.publicKey, alice.privateKey);
    const decrypted = await decryptFrom(env, alice.publicKey, bob.privateKey);

    expect(await decodeUtf8(decrypted)).toBe("hola Bob, prueba roundtrip");
  });

  it("nonce único: 1000 cifrados del mismo mensaje con la misma llave dan 1000 nonces distintos", async () => {
    // CRÍTICO: reutilizar un nonce con la misma llave rompe el cifrado
    // (XSalsa20 es un stream cipher — mismo nonce+llave = mismo keystream).
    const alice = await generateIdentityKeypair();
    const bob = await generateIdentityKeypair();
    const msg = await encodeUtf8("mismo mensaje");

    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const env = await encryptFor(msg, bob.publicKey, alice.privateKey);
      const nonceB64 = Buffer.from(env.nonce).toString("base64");
      expect(seen.has(nonceB64)).toBe(false);
      seen.add(nonceB64);
    }
    expect(seen.size).toBe(1000);
  });

  it("tamper detection: cambiar un byte del ciphertext hace fallar el descifrado", async () => {
    // Poly1305 MAC debe rechazar cualquier ciphertext modificado.
    const alice = await generateIdentityKeypair();
    const bob = await generateIdentityKeypair();
    const pt = await encodeUtf8("mensaje íntegro");

    const env = await encryptFor(pt, bob.publicKey, alice.privateKey);
    // Flip un bit del primer byte del ciphertext.
    const tampered = new Uint8Array(env.ciphertext);
    tampered[0] = tampered[0]! ^ 0x01;

    await expect(
      decryptFrom(
        { ciphertext: tampered, nonce: env.nonce },
        alice.publicKey,
        bob.privateKey,
      ),
    ).rejects.toThrow("decryption_failed");
  });

  it("key separation: llave incorrecta no descifra", async () => {
    // Confirma que sólo el destinatario legítimo puede leer.
    const alice = await generateIdentityKeypair();
    const bob = await generateIdentityKeypair();
    const mallory = await generateIdentityKeypair();
    const env = await encryptFor(
      await encodeUtf8("secreto"),
      bob.publicKey,
      alice.privateKey,
    );

    await expect(
      decryptFrom(env, alice.publicKey, mallory.privateKey),
    ).rejects.toThrow("decryption_failed");
  });

  it("emisor erróneo: si la clave pública del supuesto emisor no cuadra, falla", async () => {
    // El receptor debe autenticar al emisor — si el atacante envía ciphertext
    // firmándose como otro, el MAC debe rechazarlo.
    const alice = await generateIdentityKeypair();
    const bob = await generateIdentityKeypair();
    const mallory = await generateIdentityKeypair();
    const env = await encryptFor(
      await encodeUtf8("de Alice"),
      bob.publicKey,
      mallory.privateKey, // Mallory firma como sí misma
    );

    // Bob intenta verificar como si viniera de Alice → falla.
    await expect(
      decryptFrom(env, alice.publicKey, bob.privateKey),
    ).rejects.toThrow("decryption_failed");
  });

  it("envelope base64 roundtrip no muta los bytes", async () => {
    const alice = await generateIdentityKeypair();
    const bob = await generateIdentityKeypair();
    const env = await encryptFor(
      await encodeUtf8("payload"),
      bob.publicKey,
      alice.privateKey,
    );

    const b64 = await envelopeToBase64(env);
    const back = await envelopeFromBase64(b64);

    expect(Array.from(back.ciphertext)).toEqual(Array.from(env.ciphertext));
    expect(Array.from(back.nonce)).toEqual(Array.from(env.nonce));
  });
});

describe("safety number (verificación humana)", () => {
  it("es determinístico y simétrico entre ambos lados", async () => {
    // A+B y B+A deben producir el mismo número — si no, los usuarios verían
    // cadenas distintas y nunca podrían confirmar identidad.
    const a = await generateIdentityKeypair();
    const b = await generateIdentityKeypair();
    const snAB = await safetyNumber(a.publicKey, b.publicKey);
    const snBA = await safetyNumber(b.publicKey, a.publicKey);
    expect(snAB).toBe(snBA);
  });

  it("cambia si cualquiera de las identidades cambia", async () => {
    // Bandera roja para MITM: si la clave del otro lado cambia, el número
    // debe cambiar para alertar al usuario.
    const a = await generateIdentityKeypair();
    const b = await generateIdentityKeypair();
    const bPrime = await generateIdentityKeypair();
    const snAB = await safetyNumber(a.publicKey, b.publicKey);
    const snABp = await safetyNumber(a.publicKey, bPrime.publicKey);
    expect(snAB).not.toBe(snABp);
  });

  it("formato: 12 grupos de 5 dígitos separados por espacio (60 dígitos)", async () => {
    const a = await generateIdentityKeypair();
    const b = await generateIdentityKeypair();
    const sn = await safetyNumber(a.publicKey, b.publicKey);
    expect(sn).toMatch(/^(\d{5} ){11}\d{5}$/);
  });
});
