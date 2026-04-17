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
} as const;

export type Config = typeof config;
