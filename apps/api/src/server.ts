import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { pgPing } from "./db/pg.js";
import { redisPing } from "./db/redis.js";
import { registerJwt } from "./auth/jwt.js";
import { authRoutes } from "./routes/auth.js";
import { invitationRoutes } from "./routes/invitations.js";
import type { HealthResponse } from "@euromex/shared";

const API_VERSION = "0.2.0";

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport:
        config.env === "development"
          ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } }
          : undefined,
    },
    trustProxy: true,
  });

  await app.register(helmet, { global: true });
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await registerJwt(app);

  app.get("/health", async (): Promise<HealthResponse> => {
    const [postgres, redis] = await Promise.all([pgPing(), redisPing()]);
    return {
      status: "ok",
      service: "euromex-api",
      version: API_VERSION,
      timestamp: new Date().toISOString(),
      deps: {
        postgres: postgres ? "up" : "down",
        redis: redis ? "up" : "down",
      },
    };
  });

  await app.register(authRoutes);
  await app.register(invitationRoutes);

  return app;
}

async function main() {
  const app = await buildServer();
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  void main();
}
