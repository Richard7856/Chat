import type { FastifyInstance } from "fastify";
import {
  CreateInvitationRequestSchema,
  type CreateInvitationResponse,
} from "@euromex/shared";
import { pool } from "../db/pg.js";
import { generateInviteCode, hashInviteCode } from "../auth/crypto.js";
import { requireAuth, requireAdmin } from "../auth/jwt.js";

export async function invitationRoutes(app: FastifyInstance) {
  app.post(
    "/auth/invitations",
    { preHandler: [requireAuth, requireAdmin] },
    async (req, reply): Promise<CreateInvitationResponse> => {
      const parsed = CreateInvitationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      }
      const { intendedFor, role, ttlHours } = parsed.data;

      const code = generateInviteCode();
      const codeHash = await hashInviteCode(code);
      const expiresAt = new Date(Date.now() + ttlHours * 3600_000);

      await pool.query(
        `INSERT INTO invitations (code_hash, created_by, intended_for, role, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [codeHash, req.session!.sub, intendedFor ?? null, role, expiresAt],
      );

      await pool.query(
        `INSERT INTO audit_log (user_id, action, metadata, ip, user_agent)
         VALUES ($1, 'invitation.create', $2::jsonb, $3, $4)`,
        [
          req.session!.sub,
          JSON.stringify({ intendedFor, role, ttlHours }),
          req.ip,
          req.headers["user-agent"] ?? null,
        ],
      );

      return { code, expiresAt: expiresAt.toISOString() };
    },
  );
}
