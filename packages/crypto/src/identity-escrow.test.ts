/**
 * Tests de la Capa 1 de Fase 31 — primitivas de identidad por usuario + escrow.
 * Ver docs/FASE-31-IDENTIDAD-ESCROW.md.
 *
 * Cubre: derivación de contraseña (Argon2id), secretbox simétrico, sealed box
 * para escrow, y el flujo completo simulado (enrollment → login → recovery).
 */
import { describe, it, expect } from "vitest";
import {
  deriveKeyFromPassword,
  randomSalt,
  secretboxSeal,
  secretboxOpen,
  packSecretBox,
  unpackSecretBox,
  sealedBoxSeal,
  sealedBoxOpen,
  generateIdentityKeypair,
  generateEscrowKeypair,
  encodeUtf8,
  decodeUtf8,
} from "./index.js";

describe("deriveKeyFromPassword (Argon2id)", () => {
  it("es determinista: misma contraseña + mismo salt → misma llave", async () => {
    const salt = randomSalt();
    const k1 = await deriveKeyFromPassword("contraseña-super-segura-123", salt);
    const k2 = await deriveKeyFromPassword("contraseña-super-segura-123", salt);
    expect(k1).toEqual(k2);
    expect(k1.length).toBe(32);
  });

  it("salt distinto → llave distinta (mismo password)", async () => {
    const k1 = await deriveKeyFromPassword("misma-password", randomSalt());
    const k2 = await deriveKeyFromPassword("misma-password", randomSalt());
    expect(k1).not.toEqual(k2);
  });

  it("password distinto → llave distinta (mismo salt)", async () => {
    const salt = randomSalt();
    const k1 = await deriveKeyFromPassword("password-A-larga", salt);
    const k2 = await deriveKeyFromPassword("password-B-larga", salt);
    expect(k1).not.toEqual(k2);
  });

  it("randomSalt genera 16 bytes distintos cada vez", () => {
    const s1 = randomSalt();
    const s2 = randomSalt();
    expect(s1.length).toBe(16);
    expect(s1).not.toEqual(s2);
  });
});

describe("secretbox (envolver identidad con llave de contraseña)", () => {
  it("round-trip: seal → open recupera el plaintext", async () => {
    const key = await deriveKeyFromPassword("clave-de-usuario-12chars", randomSalt());
    const secret = (await generateIdentityKeypair()).privateKey;
    const box = await secretboxSeal(secret, key);
    const recovered = await secretboxOpen(box, key);
    expect(recovered).toEqual(secret);
  });

  it("open con llave incorrecta lanza error (no devuelve basura)", async () => {
    const salt = randomSalt();
    const goodKey = await deriveKeyFromPassword("password-correcta-aqui", salt);
    const badKey = await deriveKeyFromPassword("password-incorrecta-x", salt);
    const box = await secretboxSeal(await encodeUtf8("dato sensible"), goodKey);
    await expect(secretboxOpen(box, badKey)).rejects.toThrow("secretbox_open_failed");
  });

  it("ciphertext manipulado lanza error (autenticación)", async () => {
    const key = await deriveKeyFromPassword("otra-password-larga", randomSalt());
    const box = await secretboxSeal(await encodeUtf8("integridad"), key);
    box.ciphertext[0] = box.ciphertext[0]! ^ 0xff; // flip un byte
    await expect(secretboxOpen(box, key)).rejects.toThrow();
  });

  it("pack/unpack: round-trip por blob único (nonce || ciphertext)", async () => {
    const key = await deriveKeyFromPassword("password-para-pack-test", randomSalt());
    const secret = (await generateIdentityKeypair()).privateKey;
    const box = await secretboxSeal(secret, key);
    const blob = packSecretBox(box);
    const recovered = await secretboxOpen(unpackSecretBox(blob), key);
    expect(recovered).toEqual(secret);
  });
});

describe("sealedBox (escrow: cifrar identidad hacia la llave de la organización)", () => {
  it("round-trip: sellar con escrowPub → abrir con escrowPriv recupera", async () => {
    const escrow = await generateEscrowKeypair();
    const userPriv = (await generateIdentityKeypair()).privateKey;
    const sealed = await sealedBoxSeal(userPriv, escrow.publicKey);
    const recovered = await sealedBoxOpen(sealed, escrow.privateKey);
    expect(recovered).toEqual(userPriv);
  });

  it("abrir con la privada equivocada lanza error", async () => {
    const escrow = await generateEscrowKeypair();
    const otroEscrow = await generateEscrowKeypair();
    const userPriv = (await generateIdentityKeypair()).privateKey;
    const sealed = await sealedBoxSeal(userPriv, escrow.publicKey);
    await expect(
      sealedBoxOpen(sealed, otroEscrow.privateKey),
    ).rejects.toThrow("sealed_box_open_failed");
  });

  it("blob corrupto/corto lanza error", async () => {
    const escrow = await generateEscrowKeypair();
    await expect(
      sealedBoxOpen(new Uint8Array(10), escrow.privateKey),
    ).rejects.toThrow("sealed_box_too_short");
  });

  it("cada sellado usa efímero distinto → dos blobs del mismo dato difieren", async () => {
    const escrow = await generateEscrowKeypair();
    const data = await encodeUtf8("mismo contenido");
    const a = await sealedBoxSeal(data, escrow.publicKey);
    const b = await sealedBoxSeal(data, escrow.publicKey);
    expect(a).not.toEqual(b); // efímero + nonce aleatorios
    // pero ambos descifran al mismo plaintext
    expect(await sealedBoxOpen(a, escrow.privateKey)).toEqual(data);
    expect(await sealedBoxOpen(b, escrow.privateKey)).toEqual(data);
  });
});

describe("flujo completo de identidad por usuario (simulación end-to-end)", () => {
  it("enrollment → login en otro device → recovery por escrow", async () => {
    // --- Setup organización: keypair de escrow (una sola vez) ---
    const escrow = await generateEscrowKeypair();

    // --- ENROLLMENT: el usuario genera su identidad ---
    const userIdentity = await generateIdentityKeypair();
    const password = "MiContraseña2026!";
    const salt = randomSalt();
    const pwKey = await deriveKeyFromPassword(password, salt);

    // Dos copias de la privada: con password y con escrow
    const identityEncPw = await secretboxSeal(userIdentity.privateKey, pwKey);
    const identityEncEscrow = await sealedBoxSeal(
      userIdentity.privateKey,
      escrow.publicKey,
    );
    // (el server guardaría: userIdentity.publicKey, identityEncPw, salt, identityEncEscrow)

    // --- LOGIN en un device NUEVO (solo con la password) ---
    // El device descarga identityEncPw + salt y descifra con la password.
    const pwKeyOnNewDevice = await deriveKeyFromPassword(password, salt);
    const recoveredPriv = await secretboxOpen(identityEncPw, pwKeyOnNewDevice);
    expect(recoveredPriv).toEqual(userIdentity.privateKey);
    // → compu y cel obtienen la MISMA privada → comparten historial ✓

    // --- RECOVERY: el usuario olvidó la password ---
    // El server usa la privada de escrow para recuperar la identidad.
    const privFromEscrow = await sealedBoxOpen(identityEncEscrow, escrow.privateKey);
    expect(privFromEscrow).toEqual(userIdentity.privateKey);

    // Se re-envuelve con una password nueva → historial intacto.
    const newPassword = "ContraseñaNueva2026!";
    const newSalt = randomSalt();
    const newPwKey = await deriveKeyFromPassword(newPassword, newSalt);
    const newIdentityEncPw = await secretboxSeal(privFromEscrow, newPwKey);

    // El usuario entra con la password nueva y recupera la MISMA identidad.
    const finalPriv = await secretboxOpen(
      newIdentityEncPw,
      await deriveKeyFromPassword(newPassword, newSalt),
    );
    expect(finalPriv).toEqual(userIdentity.privateKey);
  });
});
