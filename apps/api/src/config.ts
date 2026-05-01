import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  env: optional("NODE_ENV", "development"),
  host: optional("API_HOST", "0.0.0.0"),
  port: Number(optional("API_PORT", "4000")),
  logLevel: optional("API_LOG_LEVEL", "info"),
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),
  jwtSecret: required("JWT_SECRET"),
  masterEncKey: required("MASTER_ENC_KEY"),
  /** TTL del access token. 8h es razonable: corto pero no molesta al usuario. */
  jwtTtlSec: Number(optional("JWT_TTL_SEC", String(60 * 60 * 8))),
  /** Orígenes web permitidos (CORS). Lista separada por coma. */
  corsOrigins: optional("CORS_ORIGINS", "http://localhost:3000").split(","),
  /** Dónde persistir los blobs cifrados de los adjuntos. */
  storageDir: optional("STORAGE_DIR", "/opt/euromex/storage"),
  /** Máximo tamaño por archivo subido (bytes). Default 50 MiB. */
  maxAttachmentBytes: Number(optional("MAX_ATTACHMENT_BYTES", String(50 * 1024 * 1024))),
  /** Fase 19: Web Push VAPID. Generar con `pnpm --filter @euromex/api run generate-vapid`. */
  vapidPublicKey: optional("VAPID_PUBLIC_KEY", ""),
  vapidPrivateKey: optional("VAPID_PRIVATE_KEY", ""),
  /** Email o URL del emisor para el header VAPID subject. */
  vapidSubject: optional("VAPID_SUBJECT", "mailto:admin@euromex.com.mx"),
} as const;

export type Config = typeof config;
