import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import {
  hashPassword,
  verifyPassword,
  generateInviteCode,
  hashInviteCode,
  verifyInviteCode,
  loadMasterKey,
  encryptSecret,
  decryptSecret,
  constantTimeEqual,
} from "./crypto.js";

describe("password hashing (Argon2id)", () => {
  it("verifica la contraseña correcta", async () => {
    const hash = await hashPassword("correcto-horse-battery-staple");
    expect(await verifyPassword(hash, "correcto-horse-battery-staple")).toBe(true);
  });

  it("rechaza contraseña incorrecta", async () => {
    const hash = await hashPassword("abc123");
    expect(await verifyPassword(hash, "abc124")).toBe(false);
  });

  it("produce hashes distintos para la misma contraseña (salt aleatorio)", async () => {
    // Argon2id genera un salt fresco cada vez — dos hashes del mismo plaintext
    // NO deben coincidir. Previene rainbow tables.
    const h1 = await hashPassword("mismo");
    const h2 = await hashPassword("mismo");
    expect(h1).not.toBe(h2);
    // Pero ambos verifican:
    expect(await verifyPassword(h1, "mismo")).toBe(true);
    expect(await verifyPassword(h2, "mismo")).toBe(true);
  });

  it("verifyPassword devuelve false ante hash corrupto en vez de lanzar", async () => {
    // Debe ser resiliente: DB corrupta o formato legacy no deben tirar 500.
    expect(await verifyPassword("no-es-un-hash", "x")).toBe(false);
  });
});

describe("códigos de invitación", () => {
  it("formato esperado: 4 grupos de 4 chars base32 separados por guión", async () => {
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode();
      expect(code).toMatch(/^[0-9A-HJKMNPQRSTVWXYZ]{4}-[0-9A-HJKMNPQRSTVWXYZ]{4}-[0-9A-HJKMNPQRSTVWXYZ]{4}-[0-9A-HJKMNPQRSTVWXYZ]{4}$/);
    }
  });

  it("cada código generado es único (aleatoriedad suficiente)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const code = generateInviteCode();
      expect(seen.has(code)).toBe(false);
      seen.add(code);
    }
  });

  it("hash + verify roundtrip, y rechaza código distinto", async () => {
    const code = generateInviteCode();
    const hash = await hashInviteCode(code);
    expect(await verifyInviteCode(hash, code)).toBe(true);
    expect(await verifyInviteCode(hash, generateInviteCode())).toBe(false);
  });
});

describe("cifrado simétrico de secretos (AES-256-GCM)", () => {
  // Usado para cifrar secretos TOTP en DB con la MASTER_ENC_KEY.
  const key = loadMasterKey(randomBytes(32).toString("base64"));

  it("roundtrip: plaintext → cifra → descifra == plaintext", () => {
    const plaintext = "secret-totp-seed-xyz";
    const blob = encryptSecret(key, plaintext);
    const recovered = decryptSecret(key, blob).toString("utf8");
    expect(recovered).toBe(plaintext);
  });

  it("nonce único por cifrado (mismo plaintext + misma llave = blobs distintos)", () => {
    // GCM requiere nonce único por llave; reutilizarlo rompe confidencialidad
    // E integridad. Confirmamos que cada llamada genera un nonce fresco.
    const a = encryptSecret(key, "igual");
    const b = encryptSecret(key, "igual");
    expect(Buffer.compare(a, b)).not.toBe(0);
    // Nonce son los primeros 12 bytes.
    expect(Buffer.compare(a.subarray(0, 12), b.subarray(0, 12))).not.toBe(0);
  });

  it("auth tag detecta ciphertext modificado", () => {
    // AES-GCM rechaza cualquier tamper — confidencialidad + autenticidad.
    const blob = encryptSecret(key, "íntegro");
    const tampered = Buffer.from(blob);
    // Flip un bit del ciphertext (después de los 12 bytes de nonce).
    tampered[12] = tampered[12]! ^ 0x01;
    expect(() => decryptSecret(key, tampered)).toThrow();
  });

  it("llave distinta no descifra", () => {
    const otherKey = loadMasterKey(randomBytes(32).toString("base64"));
    const blob = encryptSecret(key, "bajo llave");
    expect(() => decryptSecret(otherKey, blob)).toThrow();
  });

  it("loadMasterKey rechaza llaves que no midan 32 bytes", () => {
    const short = Buffer.alloc(16).toString("base64");
    expect(() => loadMasterKey(short)).toThrow(/32 bytes/);
  });
});

describe("constantTimeEqual", () => {
  it("true para iguales, false para distintos de igual largo", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
  });

  it("false si los largos difieren (sin leak de timing por short-circuit)", () => {
    // Es seguro devolver false antes de comparar bytes cuando los largos
    // difieren — el atacante ya sabe el largo por otros medios, no gana info.
    expect(constantTimeEqual("a", "ab")).toBe(false);
    expect(constantTimeEqual("", "x")).toBe(false);
  });
});
