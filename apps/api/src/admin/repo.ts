import type {
  AdminAuditLogItem,
  AdminDeviceItem,
  AdminInvitationItem,
  AdminUserListItem,
  AdminUserUpdateRequest,
} from "@euromex/shared";
import { pool } from "../db/pg.js";

/**
 * Queries del panel admin. Todas asumen que el caller ya pasó requireAdmin.
 *
 * Invariante operativo: nunca permitimos que quede CERO admins activos en
 * el sistema (sería un lockout). Las operaciones que bajan de rango o
 * deshabilitan admins deben validar esto primero con `countActiveAdmins`.
 */

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/**
 * Tipo de las columnas crudas que devuelven las queries de users (lista
 * y detalle). Aislado para no duplicar la definición y poder reusar el
 * mismo rowToAdminUser.
 */
type RawAdminUserRow = {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  role: "user" | "admin";
  receives_security_alerts: boolean;
  status: "active" | "disabled";
  active_devices_count: string;
  last_seen_at: Date | null;
  created_at: Date;
  job_title: string | null;
  department: string | null;
  manager_user_id: string | null;
  manager_display_name: string | null;
  // Fase 24
  can_download_attachments: boolean;
  can_share_externally: boolean;
  can_create_groups: boolean;
  can_invite_users: boolean;
  can_initiate_calls: boolean;
  max_attachment_mb: number;
};

function rowToAdminUser(row: RawAdminUserRow): AdminUserListItem {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    receivesSecurityAlerts: row.receives_security_alerts,
    status: row.status,
    activeDevicesCount: Number(row.active_devices_count),
    lastSeenAt: row.last_seen_at ? row.last_seen_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    jobTitle: row.job_title,
    department: row.department,
    managerUserId: row.manager_user_id,
    managerDisplayName: row.manager_display_name,
    permissions: {
      canDownloadAttachments: row.can_download_attachments,
      canShareExternally: row.can_share_externally,
      canCreateGroups: row.can_create_groups,
      canInviteUsers: row.can_invite_users,
      canInitiateCalls: row.can_initiate_calls,
      maxAttachmentMb: row.max_attachment_mb,
    },
  };
}

/** Columnas SELECT compartidas por la lista y el detalle de admin. */
const ADMIN_USER_SELECT = `
  u.id, u.username, u.display_name, u.email, u.role,
  u.receives_security_alerts, u.status, u.created_at,
  u.job_title, u.department, u.manager_user_id,
  u.can_download_attachments, u.can_share_externally,
  u.can_create_groups, u.can_invite_users, u.can_initiate_calls,
  u.max_attachment_mb,
  m.display_name AS manager_display_name,
  COALESCE((
    SELECT COUNT(*) FROM devices d
     WHERE d.user_id = u.id AND d.status = 'active'
  ), 0) AS active_devices_count,
  (SELECT MAX(d.last_seen_at) FROM devices d WHERE d.user_id = u.id) AS last_seen_at
`;

export async function listAdminUsers(): Promise<AdminUserListItem[]> {
  const r = await pool.query<RawAdminUserRow>(
    `SELECT ${ADMIN_USER_SELECT}
       FROM users u
       LEFT JOIN users m ON m.id = u.manager_user_id
      ORDER BY u.created_at DESC`,
  );
  return r.rows.map(rowToAdminUser);
}

export async function countActiveAdmins(): Promise<number> {
  const r = await pool.query<{ n: string }>(
    "SELECT COUNT(*)::text AS n FROM users WHERE role = 'admin' AND status = 'active'",
  );
  return Number(r.rows[0]?.n ?? "0");
}

export async function getUserForAdmin(
  id: string,
): Promise<AdminUserListItem | null> {
  const list = await pool.query<RawAdminUserRow>(
    `SELECT ${ADMIN_USER_SELECT}
       FROM users u
       LEFT JOIN users m ON m.id = u.manager_user_id
      WHERE u.id = $1`,
    [id],
  );
  const row = list.rows[0];
  if (!row) return null;
  return rowToAdminUser(row);
}

/**
 * Aplica los campos presentes en `patch`. Valida que no dejemos el sistema
 * sin admins activos. Devuelve el usuario actualizado.
 */
export async function updateUserAsAdmin(
  id: string,
  patch: AdminUserUpdateRequest,
): Promise<{ ok: true; user: AdminUserListItem } | { ok: false; error: string }> {
  const current = await getUserForAdmin(id);
  if (!current) return { ok: false, error: "user_not_found" };

  // Si el cambio implica que este usuario deja de ser admin activo, asegurar
  // que quede al menos uno más.
  const willBeAdmin = patch.role ?? current.role;
  const willBeActive = patch.status ?? current.status;
  const wasAdminActive =
    current.role === "admin" && current.status === "active";
  const stillAdminActive = willBeAdmin === "admin" && willBeActive === "active";

  if (wasAdminActive && !stillAdminActive) {
    const remaining = await countActiveAdmins();
    if (remaining <= 1) {
      return { ok: false, error: "last_active_admin" };
    }
  }

  // Validar que nadie sea su propio jefe — evita ciclos triviales
  if (patch.managerUserId !== undefined && patch.managerUserId === id) {
    return { ok: false, error: "self_manager" };
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (patch.role !== undefined) {
    sets.push(`role = $${i++}`);
    values.push(patch.role);
  }
  if (patch.receivesSecurityAlerts !== undefined) {
    sets.push(`receives_security_alerts = $${i++}`);
    values.push(patch.receivesSecurityAlerts);
  }
  if (patch.displayName !== undefined) {
    sets.push(`display_name = $${i++}`);
    values.push(patch.displayName);
  }
  if (patch.email !== undefined) {
    sets.push(`email = $${i++}`);
    values.push(patch.email);
  }
  if (patch.status !== undefined) {
    sets.push(`status = $${i++}`);
    values.push(patch.status);
  }
  if (patch.jobTitle !== undefined) {
    sets.push(`job_title = $${i++}`);
    values.push(patch.jobTitle);
  }
  if (patch.department !== undefined) {
    sets.push(`department = $${i++}`);
    values.push(patch.department);
  }
  if (patch.managerUserId !== undefined) {
    sets.push(`manager_user_id = $${i++}`);
    values.push(patch.managerUserId);
  }
  // Fase 24 — permisos granulares
  if (patch.canDownloadAttachments !== undefined) {
    sets.push(`can_download_attachments = $${i++}`);
    values.push(patch.canDownloadAttachments);
  }
  if (patch.canShareExternally !== undefined) {
    sets.push(`can_share_externally = $${i++}`);
    values.push(patch.canShareExternally);
  }
  if (patch.canCreateGroups !== undefined) {
    sets.push(`can_create_groups = $${i++}`);
    values.push(patch.canCreateGroups);
  }
  if (patch.canInviteUsers !== undefined) {
    sets.push(`can_invite_users = $${i++}`);
    values.push(patch.canInviteUsers);
  }
  if (patch.canInitiateCalls !== undefined) {
    sets.push(`can_initiate_calls = $${i++}`);
    values.push(patch.canInitiateCalls);
  }
  if (patch.maxAttachmentMb !== undefined) {
    sets.push(`max_attachment_mb = $${i++}`);
    values.push(patch.maxAttachmentMb);
  }
  sets.push(`updated_at = now()`);
  values.push(id);

  await pool.query(
    `UPDATE users SET ${sets.join(", ")} WHERE id = $${i}`,
    values,
  );

  // Si se deshabilita al usuario, revocamos todos sus dispositivos activos
  // para cerrar sesiones abiertas.
  if (patch.status === "disabled") {
    await pool.query(
      `UPDATE devices SET status = 'revoked', revoked_at = now()
        WHERE user_id = $1 AND status = 'active'`,
      [id],
    );
  }

  const updated = await getUserForAdmin(id);
  return { ok: true, user: updated! };
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export async function listUserDevices(userId: string): Promise<AdminDeviceItem[]> {
  const r = await pool.query<{
    id: string;
    device_name: string;
    platform: "web" | "ios" | "android" | "desktop";
    status: "pending" | "active" | "revoked";
    user_agent: string | null;
    last_seen_at: Date | null;
    created_at: Date;
    revoked_at: Date | null;
  }>(
    `SELECT id, device_name, platform, status, user_agent,
            last_seen_at, created_at, revoked_at
       FROM devices WHERE user_id = $1
      ORDER BY created_at DESC`,
    [userId],
  );
  return r.rows.map((row) => ({
    id: row.id,
    deviceName: row.device_name,
    platform: row.platform,
    status: row.status,
    userAgent: row.user_agent,
    lastSeenAt: row.last_seen_at ? row.last_seen_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
  }));
}

export async function revokeDeviceAsAdmin(
  deviceId: string,
): Promise<{ ok: boolean }> {
  const r = await pool.query(
    `UPDATE devices SET status = 'revoked', revoked_at = now()
      WHERE id = $1 AND status = 'active'`,
    [deviceId],
  );
  return { ok: (r.rowCount ?? 0) > 0 };
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export async function listAdminInvitations(): Promise<AdminInvitationItem[]> {
  const r = await pool.query<{
    id: string;
    intended_for: string | null;
    role: "user" | "admin";
    expires_at: Date;
    used_at: Date | null;
    used_by_username: string | null;
    created_at: Date;
    created_by_username: string;
  }>(
    `SELECT i.id, i.intended_for, i.role, i.expires_at, i.used_at,
            u2.username AS used_by_username,
            i.created_at,
            u1.username AS created_by_username
       FROM invitations i
       JOIN users u1 ON u1.id = i.created_by
       LEFT JOIN users u2 ON u2.id = i.used_by
      ORDER BY i.created_at DESC
      LIMIT 200`,
  );
  return r.rows.map((row) => ({
    id: row.id,
    intendedFor: row.intended_for,
    role: row.role,
    expiresAt: row.expires_at.toISOString(),
    usedAt: row.used_at ? row.used_at.toISOString() : null,
    usedByUsername: row.used_by_username,
    createdAt: row.created_at.toISOString(),
    createdByUsername: row.created_by_username,
  }));
}

/** Marca una invitación como expirada inmediatamente (la "revoca"). */
export async function revokeInvitation(id: string): Promise<{ ok: boolean }> {
  const r = await pool.query(
    `UPDATE invitations SET expires_at = now()
      WHERE id = $1 AND used_at IS NULL AND expires_at > now()`,
    [id],
  );
  return { ok: (r.rowCount ?? 0) > 0 };
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export async function listAuditLog(params: {
  userId?: string;
  action?: string;
  limit: number;
  before?: string;
}): Promise<AdminAuditLogItem[]> {
  const conds: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (params.userId) {
    conds.push(`al.user_id = $${i++}`);
    vals.push(params.userId);
  }
  if (params.action) {
    conds.push(`al.action = $${i++}`);
    vals.push(params.action);
  }
  if (params.before) {
    conds.push(`al.created_at < $${i++}`);
    vals.push(params.before);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  vals.push(params.limit);

  const r = await pool.query<{
    id: string;
    user_id: string | null;
    username: string | null;
    action: string;
    metadata: unknown;
    ip: string | null;
    user_agent: string | null;
    created_at: Date;
  }>(
    `SELECT al.id, al.user_id, u.username, al.action, al.metadata,
            al.ip::text AS ip, al.user_agent, al.created_at
       FROM audit_log al
       LEFT JOIN users u ON u.id = al.user_id
       ${where}
      ORDER BY al.created_at DESC
      LIMIT $${i}`,
    vals,
  );
  return r.rows.map((row) => ({
    id: Number(row.id),
    userId: row.user_id,
    username: row.username,
    action: row.action,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    ip: row.ip,
    userAgent: row.user_agent,
    createdAt: row.created_at.toISOString(),
  }));
}
