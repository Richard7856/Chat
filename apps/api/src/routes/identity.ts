/**
 * Rutas de identidad por usuario — Fase 31 (Capa 3).
 *
 * El cliente:
 *   1. GET /auth/identity → ¿ya tengo identidad? Si sí, recibe el blob para
 *      descifrar con la contraseña. Si no, debe enrollar.
 *   2. GET /auth/identity/escrow-pubkey → pública de escrow para sellar.
 *   3. POST /auth/identity → sube la identidad recién generada.
 *   4. POST /auth/identity/rewrap → re-envuelve con contraseña nueva.
 *
 * El server nunca ve la privada del usuario en claro (solo blobs opacos).
 */
import type { FastifyInstance } from "fastify";
import {
  EnrollIdentityRequestSchema,
  RewrapIdentityRequestSchema,
  type EscrowPubkeyResponse,
  type IdentityRecoverResponse,
  type IdentityStatusResponse,
} from "@euromex/shared";
import { sealedBoxOpen, toBase64 } from "@euromex/crypto";
import { requireAuth } from "../auth/jwt.js";
import { pool } from "../db/pg.js";
import { decryptSecret, loadMasterKey } from "../auth/crypto.js";
import { config } from "../config.js";
import {
  createUserIdentity,
  getEscrowPrivateEnc,
  getEscrowPublicKey,
  getUserIdentity,
  rewrapUserIdentity,
} from "../identity/repo.js";

/** Decodifica base64 a Buffer, validando longitud mínima. Lanza si inválido. */
function b64ToBuf(s: string, label: string): Buffer {
  const buf = Buffer.from(s, "base64");
  if (buf.length === 0) throw new Error(`empty_${label}`);
  return buf;
}

async function audit(
  req: { ip: string; headers: Record<string, unknown>; session?: { sub: string; did: string } },
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await pool.query(
    `INSERT INTO audit_log (user_id, device_id, action, metadata, ip, user_agent)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [
      req.session?.sub ?? null,
      req.session?.did ?? null,
      action,
      JSON.stringify(metadata),
      req.ip,
      req.headers["user-agent"] ?? null,
    ],
  );
}

export async function identityRoutes(app: FastifyInstance) {
  const masterKey = loadMasterKey(config.masterEncKey);

  // GET /auth/identity — estado + blob para descifrar con la contraseña.
  app.get(
    "/auth/identity",
    { preHandler: [requireAuth] },
    async (req): Promise<IdentityStatusResponse> => {
      const identity = await getUserIdentity(req.session!.sub);
      if (!identity) {
        return { hasIdentity: false, identityPublic: null, identityEncPw: null, pwSalt: null };
      }
      return {
        hasIdentity: true,
        identityPublic: identity.identityPublic.toString("base64"),
        identityEncPw: identity.identityEncPw.toString("base64"),
        pwSalt: identity.pwSalt.toString("base64"),
      };
    },
  );

  // GET /auth/identity/escrow-pubkey — pública de escrow para sellar identidad.
  app.get(
    "/auth/identity/escrow-pubkey",
    { preHandler: [requireAuth] },
    async (_req, reply): Promise<EscrowPubkeyResponse> => {
      const pub = await getEscrowPublicKey();
      if (!pub) {
        // Bootstrap de escrow no corrido aún → no se puede enrollar identidad.
        return reply.code(503).send({ error: "escrow_not_initialized" });
      }
      return { escrowPublic: pub.toString("base64") };
    },
  );

  // POST /auth/identity — enrollar la identidad recién generada.
  app.post(
    "/auth/identity",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const parsed = EnrollIdentityRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      }
      let identityPublic: Buffer;
      let identityEncPw: Buffer;
      let pwSalt: Buffer;
      let identityEncEscrow: Buffer;
      try {
        identityPublic = b64ToBuf(parsed.data.identityPublic, "identity_public");
        identityEncPw = b64ToBuf(parsed.data.identityEncPw, "identity_enc_pw");
        pwSalt = b64ToBuf(parsed.data.pwSalt, "pw_salt");
        identityEncEscrow = b64ToBuf(parsed.data.identityEncEscrow, "identity_enc_escrow");
      } catch {
        return reply.code(400).send({ error: "invalid_base64" });
      }
      // Validación de longitud de la pública (X25519 = 32 bytes).
      if (identityPublic.length !== 32) {
        return reply.code(400).send({ error: "invalid_public_key_length" });
      }

      const res = await createUserIdentity(req.session!.sub, {
        identityPublic,
        identityEncPw,
        pwSalt,
        identityEncEscrow,
      });
      if (!res.ok) {
        // Ya existe — no se sobrescribe. El cliente debe usar el blob existente.
        return reply.code(409).send({ error: res.reason ?? "identity_exists" });
      }

      await audit(req, "identity.enrolled");
      return reply.code(204).send();
    },
  );

  // POST /auth/identity/recover — recuperación vía escrow.
  //
  // El usuario está autenticado (sesión válida) pero no pudo descifrar su
  // identidad con la contraseña (la olvidó / fue reseteada). El server usa la
  // llave de escrow de la organización para descifrar la privada del usuario
  // y se la devuelve (vía TLS) para que el cliente la re-envuelva con su
  // contraseña actual.
  //
  // Trade-off aceptado (ADR-040, Opción A): el server toca la privada en
  // claro durante el recovery. CADA uso se audita.
  app.post(
    "/auth/identity/recover",
    { preHandler: [requireAuth] },
    async (req, reply): Promise<IdentityRecoverResponse> => {
      const userId = req.session!.sub;

      const identity = await getUserIdentity(userId);
      if (!identity) {
        return reply.code(404).send({ error: "no_identity" });
      }

      const escrowPrivEnc = await getEscrowPrivateEnc();
      if (!escrowPrivEnc) {
        return reply.code(503).send({ error: "escrow_not_initialized" });
      }

      let userPriv: Uint8Array;
      try {
        // Descifrar la privada de escrow con MASTER_ENC_KEY, luego abrir el
        // sealed box de la identidad del usuario.
        const escrowPriv = decryptSecret(masterKey, escrowPrivEnc);
        userPriv = await sealedBoxOpen(
          new Uint8Array(identity.identityEncEscrow),
          new Uint8Array(escrowPriv),
        );
      } catch (err) {
        req.log.error({ err, userId }, "escrow recovery failed");
        return reply.code(500).send({ error: "escrow_recovery_failed" });
      }

      // Auditoría CRÍTICA: cada uso del escrow queda registrado.
      await audit(req, "identity.escrow_recovery", {
        recoveredUserId: userId,
      });

      return {
        privateKey: await toBase64(userPriv),
        publicKey: identity.identityPublic.toString("base64"),
      };
    },
  );

  // POST /auth/identity/rewrap — re-envolver con contraseña nueva (no cambia
  // la identidad, solo su envoltura con password). Para el cambio de password.
  app.post(
    "/auth/identity/rewrap",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const parsed = RewrapIdentityRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      }
      let identityEncPw: Buffer;
      let pwSalt: Buffer;
      try {
        identityEncPw = b64ToBuf(parsed.data.identityEncPw, "identity_enc_pw");
        pwSalt = b64ToBuf(parsed.data.pwSalt, "pw_salt");
      } catch {
        return reply.code(400).send({ error: "invalid_base64" });
      }

      const res = await rewrapUserIdentity(req.session!.sub, { identityEncPw, pwSalt });
      if (!res.ok) {
        return reply.code(404).send({ error: "no_identity_to_rewrap" });
      }

      await audit(req, "identity.rewrapped");
      return reply.code(204).send();
    },
  );
}
