import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import {
  AdminResetPasswordRequestSchema,
  AdminUserUpdateRequestSchema,
  type AdminAuditLogItem,
  type AdminDeviceItem,
  type AdminInvitationItem,
  type AdminResetPasswordResponse,
  type AdminUserListItem,
} from "@euromex/shared";
import { requireAdmin, requireAuth } from "../auth/jwt.js";
import { pool } from "../db/pg.js";
import {
  getUserForAdmin,
  listAdminInvitations,
  listAdminUsers,
  listAuditLog,
  listUserDevices,
  revokeDeviceAsAdmin,
  revokeInvitation,
  updateUserAsAdmin,
} from "../admin/repo.js";
import { decryptSecret, hashPassword, loadMasterKey } from "../auth/crypto.js";
import { verifyTotp } from "../auth/totp.js";
import { config } from "../config.js";

/**
 * Endpoints del panel admin. Todos gated por requireAuth + requireAdmin.
 * Cada mutación se registra en `audit_log` con el actor + payload.
 */
export async function adminRoutes(app: FastifyInstance) {
  const gate = { preHandler: [requireAuth, requireAdmin] };

  async function audit(
    req: { ip: string; headers: Record<string, unknown>; session?: { sub: string; did: string } },
    action: string,
    metadata: Record<string, unknown>,
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

  // --------------------------------------------------------------------------
  // Users
  // --------------------------------------------------------------------------

  app.get("/admin/users", gate, async (): Promise<{ users: AdminUserListItem[] }> => {
    const users = await listAdminUsers();
    return { users };
  });

  app.get<{ Params: { id: string } }>(
    "/admin/users/:id",
    gate,
    async (req, reply): Promise<AdminUserListItem> => {
      const user = await getUserForAdmin(req.params.id);
      if (!user) return reply.code(404).send({ error: "not_found" });
      return user;
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/admin/users/:id",
    gate,
    async (req, reply): Promise<AdminUserListItem> => {
      const parsed = AdminUserUpdateRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      }
      const res = await updateUserAsAdmin(req.params.id, parsed.data);
      if (!res.ok) {
        return reply.code(400).send({ error: res.error });
      }
      await audit(req, "admin.user.update", {
        targetUserId: req.params.id,
        patch: parsed.data,
      });
      return res.user;
    },
  );

  // --------------------------------------------------------------------------
  // Fase 30 — Admin password reset
  //
  // Genera una temp password Argon2id, la guarda en users.password_hash,
  // marca must_change_password=true y revoca todos los devices activos del
  // user (zero-trust: cualquier sesión vieja queda inválida).
  //
  // Requiere TOTP del admin (segundo factor obligatorio para acciones
  // destructivas — sesión robada del admin no debería poder pivotar a
  // tomar cuentas de otros sin el authenticator físico).
  //
  // La temp password se devuelve UNA SOLA VEZ en la respuesta para que el
  // admin la entregue al user por canal seguro. Nunca se persiste en texto
  // plano: el hash sí, la temp NO.
  // --------------------------------------------------------------------------
  const masterKey = loadMasterKey(config.masterEncKey);

  app.post<{ Params: { id: string } }>(
    "/admin/users/:id/reset-password",
    gate,
    async (req, reply): Promise<AdminResetPasswordResponse> => {
      const parsed = AdminResetPasswordRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_body", issues: parsed.error.issues });
      }
      const targetUserId = req.params.id;
      const adminUserId = req.session!.sub;

      // 1) Validar TOTP del admin que está haciendo la acción.
      const adminRow = await pool.query<{ totp_secret_enc: Buffer }>(
        "SELECT totp_secret_enc FROM users WHERE id = $1",
        [adminUserId],
      );
      const admin = adminRow.rows[0];
      if (!admin) return reply.code(401).send({ error: "session_revoked" });

      const adminTotpSecret = decryptSecret(masterKey, admin.totp_secret_enc).toString("utf8");
      if (!verifyTotp(adminTotpSecret, parsed.data.adminTotpToken)) {
        await audit(req, "admin.password.reset_failed", {
          targetUserId,
          reason: "invalid_admin_totp",
        });
        return reply.code(401).send({ error: "invalid_totp" });
      }

      // 2) Verificar que el target user existe.
      const targetRow = await pool.query<{
        id: string;
        username: string;
        display_name: string;
        role: "user" | "admin";
        status: string;
      }>(
        "SELECT id, username, display_name, role, status FROM users WHERE id = $1",
        [targetUserId],
      );
      const target = targetRow.rows[0];
      if (!target) return reply.code(404).send({ error: "user_not_found" });

      // 3) No permitir reset de uno mismo — el admin debe usar /auth/password
      //    para cambiar su propia password (requiere current + TOTP).
      if (target.id === adminUserId) {
        return reply.code(400).send({ error: "cannot_reset_self" });
      }

      // 4) Generar temp password — 12 chars base64url para evitar / + = al
      //    copiar/pegar en clientes de correo.
      const tempPassword = randomBytes(9).toString("base64url").slice(0, 12);
      const newHash = await hashPassword(tempPassword);

      // 5) Transacción: actualizar password_hash + flag + revocar devices.
      const client = await pool.connect();
      let revokedDevices = 0;
      try {
        await client.query("BEGIN");

        await client.query(
          `UPDATE users
              SET password_hash = $1,
                  must_change_password = TRUE,
                  updated_at = now()
            WHERE id = $2`,
          [newHash, target.id],
        );

        const revokeRes = await client.query(
          `UPDATE devices
              SET status = 'revoked', revoked_at = now()
            WHERE user_id = $1 AND status = 'active'`,
          [target.id],
        );
        revokedDevices = revokeRes.rowCount ?? 0;

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        req.log.error({ err, targetUserId }, "admin password reset failed");
        return reply.code(500).send({ error: "reset_failed" });
      } finally {
        client.release();
      }

      await audit(req, "admin.password.reset", {
        targetUserId: target.id,
        targetUsername: target.username,
        revokedDevices,
      });

      return {
        tempPassword,
        user: {
          id: target.id,
          username: target.username,
          displayName: target.display_name,
        },
        revokedDevices,
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/admin/users/:id/devices",
    gate,
    async (req): Promise<{ devices: AdminDeviceItem[] }> => {
      const devices = await listUserDevices(req.params.id);
      return { devices };
    },
  );

  // --------------------------------------------------------------------------
  // Devices (revoke)
  // --------------------------------------------------------------------------

  app.post<{ Params: { id: string } }>(
    "/admin/devices/:id/revoke",
    gate,
    async (req, reply) => {
      const res = await revokeDeviceAsAdmin(req.params.id);
      if (!res.ok) {
        return reply.code(404).send({ error: "device_not_active" });
      }
      await audit(req, "admin.device.revoke", { deviceId: req.params.id });
      return reply.code(204).send();
    },
  );

  // --------------------------------------------------------------------------
  // Invitations
  // --------------------------------------------------------------------------

  app.get(
    "/admin/invitations",
    gate,
    async (): Promise<{ invitations: AdminInvitationItem[] }> => {
      const invitations = await listAdminInvitations();
      return { invitations };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/admin/invitations/:id",
    gate,
    async (req, reply) => {
      const res = await revokeInvitation(req.params.id);
      if (!res.ok) {
        return reply.code(404).send({ error: "invitation_not_revocable" });
      }
      await audit(req, "admin.invitation.revoke", { invitationId: req.params.id });
      return reply.code(204).send();
    },
  );

  // --------------------------------------------------------------------------
  // Audit log browser
  // --------------------------------------------------------------------------

  app.get<{
    Querystring: { userId?: string; action?: string; limit?: string; before?: string };
  }>(
    "/admin/audit-log",
    gate,
    async (req): Promise<{ entries: AdminAuditLogItem[] }> => {
      const limit = Math.min(Number(req.query.limit ?? "100"), 500);
      const entries = await listAuditLog({
        userId: req.query.userId,
        action: req.query.action,
        limit,
        before: req.query.before,
      });
      return { entries };
    },
  );
}
