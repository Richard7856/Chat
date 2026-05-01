/**
 * Helpers para revisar permisos granulares (Fase 24) en handlers de API.
 *
 * Cada endpoint que tenga restricción debe llamar `getUserPermissions()` y
 * verificar el flag relevante. Mantenemos esto fuera de `requireAuth` para
 * no agregar 6 columnas extra a CADA request — solo se carga donde se usa.
 */

import { pool } from "../db/pg.js";
import type { UserPermissions } from "@euromex/shared";

/** Defaults conservadores si el row desaparece (no debería pasar). */
const DEFAULTS: UserPermissions = {
  canDownloadAttachments: true,
  canShareExternally: false,
  canCreateGroups: true,
  canInviteUsers: false,
  canInitiateCalls: true,
  maxAttachmentMb: 50,
};

export async function getUserPermissions(
  userId: string,
): Promise<UserPermissions> {
  const r = await pool.query<{
    can_download_attachments: boolean;
    can_share_externally: boolean;
    can_create_groups: boolean;
    can_invite_users: boolean;
    can_initiate_calls: boolean;
    max_attachment_mb: number;
  }>(
    `SELECT can_download_attachments, can_share_externally, can_create_groups,
            can_invite_users, can_initiate_calls, max_attachment_mb
       FROM users
      WHERE id = $1`,
    [userId],
  );
  const p = r.rows[0];
  if (!p) return DEFAULTS;
  return {
    canDownloadAttachments: p.can_download_attachments,
    canShareExternally: p.can_share_externally,
    canCreateGroups: p.can_create_groups,
    canInviteUsers: p.can_invite_users,
    canInitiateCalls: p.can_initiate_calls,
    maxAttachmentMb: p.max_attachment_mb,
  };
}
