import fp from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { UserRole } from "@euromex/shared";
import { config } from "../config.js";
import { pool } from "../db/pg.js";

export interface SessionClaims {
  sub: string;    // user id
  did: string;    // device id
  role: UserRole;
}

/** Sesión enriquecida: JWT claims + datos frescos de DB (runtime). */
export interface SessionContext extends SessionClaims {
  /** Si true, este usuario recibe avisos de seguridad (system messages). */
  watchesAlerts: boolean;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: SessionClaims;
    user: SessionClaims;
  }
}

declare module "fastify" {
  interface FastifyRequest {
    session?: SessionContext;
  }
}

export async function registerJwt(app: FastifyInstance) {
  await app.register(fp, {
    secret: config.jwtSecret,
    sign: { expiresIn: config.jwtTtlSec },
  });
}

/**
 * Middleware: valida JWT, verifica que user y device estén activos en DB.
 * Cada request paga una query a DB — simple y seguro; cache vendrá después.
 */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify();
  } catch {
    await reply.code(401).send({ error: "unauthorized" });
    return;
  }

  const claims = req.user as SessionClaims;
  const result = await pool.query<{
    user_status: string;
    device_status: string;
    watches_alerts: boolean;
  }>(
    `SELECT u.status AS user_status, d.status AS device_status,
            u.receives_security_alerts AS watches_alerts
       FROM users u
       JOIN devices d ON d.user_id = u.id
      WHERE u.id = $1 AND d.id = $2`,
    [claims.sub, claims.did],
  );

  const row = result.rows[0];
  if (!row || row.user_status !== "active" || row.device_status !== "active") {
    await reply.code(401).send({ error: "session_revoked" });
    return;
  }

  req.session = { ...claims, watchesAlerts: row.watches_alerts };

  // Actualización best-effort de last_seen (sin bloquear la request).
  pool
    .query("UPDATE devices SET last_seen_at = now() WHERE id = $1", [claims.did])
    .catch(() => {});
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (req.session?.role !== "admin") {
    await reply.code(403).send({ error: "forbidden" });
  }
}
