import type { FastifyInstance } from "fastify";
import {
  AdminUserUpdateRequestSchema,
  type AdminAuditLogItem,
  type AdminDeviceItem,
  type AdminInvitationItem,
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
