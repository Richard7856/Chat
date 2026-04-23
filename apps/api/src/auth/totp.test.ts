import { describe, it, expect } from "vitest";
import { TOTP, Secret } from "otpauth";
import { createTotpEnrollment, verifyTotp } from "./totp.js";

describe("TOTP enrollment + verify", () => {
  it("createTotpEnrollment produce secret base32, uri otpauth y QR PNG data URL", async () => {
    const e = await createTotpEnrollment("alice@euromex");
    expect(e.secret).toMatch(/^[A-Z2-7]+$/); // RFC 4648 base32
    expect(e.uri).toMatch(/^otpauth:\/\/totp\//);
    expect(e.uri).toContain("Euromex%20Chat");
    expect(e.qrDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("verifyTotp acepta el código actual generado por el mismo secreto", async () => {
    const e = await createTotpEnrollment("bob@euromex");
    // Generamos el código "ahora mismo" con el mismo algoritmo.
    const totp = new TOTP({
      issuer: "Euromex Chat",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(e.secret),
    });
    const code = totp.generate();
    expect(verifyTotp(e.secret, code)).toBe(true);
  });

  it("verifyTotp rechaza un código de 6 dígitos aleatorio", async () => {
    const e = await createTotpEnrollment("carol@euromex");
    // Probabilidad de falso positivo: 3 ventanas / 1e6 ≈ 3e-6. Despreciable.
    expect(verifyTotp(e.secret, "000000")).toBe(false);
    expect(verifyTotp(e.secret, "123456")).toBe(false);
  });

  it("verifyTotp rechaza entrada mal formada sin lanzar", () => {
    const secret = new Secret({ size: 20 }).base32;
    // El usuario podría pegar cualquier cosa; no debe tirar 500.
    expect(verifyTotp(secret, "abc")).toBe(false);
    expect(verifyTotp(secret, "")).toBe(false);
  });
});
