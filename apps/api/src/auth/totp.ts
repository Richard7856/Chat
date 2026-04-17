import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";

const ISSUER = "Euromex Chat";

export interface TotpEnrollment {
  /** Secreto base32 en claro. Solo vive en memoria durante el enrollment. */
  secret: string;
  /** URL otpauth:// para apps autenticadoras. */
  uri: string;
  /** Data URL (PNG base64) con el QR listo para mostrar en la UI. */
  qrDataUrl: string;
}

export async function createTotpEnrollment(label: string): Promise<TotpEnrollment> {
  const secret = new Secret({ size: 20 });
  const totp = new TOTP({
    issuer: ISSUER,
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });
  const uri = totp.toString();
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 240 });
  return {
    secret: secret.base32,
    uri,
    qrDataUrl,
  };
}

export function verifyTotp(secretBase32: string, token: string): boolean {
  const totp = new TOTP({
    issuer: ISSUER,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  });
  // window: ±1 periodo (±30s) para tolerar desfase de reloj.
  const delta = totp.validate({ token, window: 1 });
  return delta !== null;
}
