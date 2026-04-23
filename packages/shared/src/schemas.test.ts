import { describe, it, expect } from "vitest";
import {
  InviteCodeSchema,
  EnrollBeginResponseSchema,
  EnrollCompleteRequestSchema,
} from "./schemas.js";

describe("InviteCodeSchema", () => {
  it("acepta el formato canónico ABCD-EFGH-IJKL-MNOP", () => {
    expect(InviteCodeSchema.safeParse("ABCD-EFGH-IJKL-MNOP").success).toBe(true);
    expect(InviteCodeSchema.safeParse("0000-1111-2222-3333").success).toBe(true);
  });

  it("rechaza formatos cortos (atrapa el bug histórico de randomBytes(10))", () => {
    // Antes de Fase 10 generateInviteCode emitía "XXXX-XXXX-XX-" que pasaba
    // este schema con success=false → invitaciones nunca canjeables.
    expect(InviteCodeSchema.safeParse("ABCD-EFGH-IJ-").success).toBe(false);
    expect(InviteCodeSchema.safeParse("ABCD-EFGH").success).toBe(false);
    expect(InviteCodeSchema.safeParse("").success).toBe(false);
  });

  it("rechaza minúsculas y caracteres ambiguos fuera del alfabeto", () => {
    expect(InviteCodeSchema.safeParse("abcd-efgh-ijkl-mnop").success).toBe(false);
    expect(InviteCodeSchema.safeParse("ABCD EFGH IJKL MNOP").success).toBe(false);
  });
});

describe("EnrollBeginResponseSchema / EnrollCompleteRequestSchema — enrollmentId", () => {
  // Regresión: el enrollmentId es un JWT opaco firmado por el server, NO un
  // UUID. Antes de Fase 10 ambos schemas decían .uuid() → cualquier intento
  // de completar un enrollment respondía 400 invalid_body antes incluso de
  // verificar el JWT. Resultado: enrollment nunca pudo funcionar end-to-end.

  const fakeJwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
    ".eyJ0IjoiZW5yb2xsIiwiaW52aXRlSWQiOiJhYmMifQ" +
    ".sig";

  it("EnrollBeginResponseSchema acepta un JWT como enrollmentId", () => {
    const r = EnrollBeginResponseSchema.safeParse({
      enrollmentId: fakeJwt,
      totpUri: "otpauth://totp/x",
      totpQrDataUrl: "data:image/png;base64,xxx",
    });
    expect(r.success).toBe(true);
  });

  it("EnrollCompleteRequestSchema acepta un JWT como enrollmentId", () => {
    const r = EnrollCompleteRequestSchema.safeParse({
      enrollmentId: fakeJwt,
      password: "correcto-horse-battery-staple",
      totpToken: "123456",
      deviceName: "Mi dispositivo",
      platform: "web",
    });
    expect(r.success).toBe(true);
  });

  it("rechaza enrollmentId vacío (mínimo invariante)", () => {
    const r = EnrollCompleteRequestSchema.safeParse({
      enrollmentId: "",
      password: "correcto-horse-battery-staple",
      totpToken: "123456",
      deviceName: "Mi dispositivo",
      platform: "web",
    });
    expect(r.success).toBe(false);
  });

  it("valida campos asociados (totpToken 6 dígitos, password >= 12, platform enum)", () => {
    const base = {
      enrollmentId: fakeJwt,
      password: "correcto-horse-battery-staple",
      totpToken: "123456",
      deviceName: "Mi dispositivo",
      platform: "web" as const,
    };
    expect(EnrollCompleteRequestSchema.safeParse(base).success).toBe(true);

    expect(
      EnrollCompleteRequestSchema.safeParse({ ...base, totpToken: "12345" }).success,
    ).toBe(false);
    expect(
      EnrollCompleteRequestSchema.safeParse({ ...base, password: "corta" }).success,
    ).toBe(false);
    expect(
      EnrollCompleteRequestSchema.safeParse({ ...base, platform: "blackberry" })
        .success,
    ).toBe(false);
  });
});
