import { pool } from "../db/pg.js";
import type { AttachmentListItem } from "@euromex/shared";

export interface AttachmentRow {
  id: string;
  conversation_id: string;
  uploader_user_id: string;
  uploader_device_id: string;
  storage_key: string;
  byte_size: string; // BIGINT llega como string desde pg
  created_at: Date;
  access_type: string;
  download_pin_hash: string | null;
  message_id: string | null;
}

export async function insertAttachment(params: {
  conversationId: string;
  uploaderUserId: string;
  uploaderDeviceId: string;
  storageKey: string;
  byteSize: number;
  downloadPinHash?: string;
  accessType?: "all" | "restricted";
}): Promise<{ id: string }> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO attachments
       (conversation_id, uploader_user_id, uploader_device_id, storage_key,
        byte_size, download_pin_hash, access_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      params.conversationId,
      params.uploaderUserId,
      params.uploaderDeviceId,
      params.storageKey,
      params.byteSize,
      params.downloadPinHash ?? null,
      params.accessType ?? "all",
    ],
  );
  return { id: r.rows[0]!.id };
}

/** Inserta la lista de usuarios con acceso cuando access_type = 'restricted'. */
export async function insertAttachmentAllowedUsers(
  attachmentId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  const values = userIds
    .map((_, i) => `($1, $${i + 2})`)
    .join(", ");
  await pool.query(
    `INSERT INTO attachment_allowed_users (attachment_id, user_id) VALUES ${values}
     ON CONFLICT DO NOTHING`,
    [attachmentId, ...userIds],
  );
}

/**
 * Devuelve el adjunto si el usuario pertenece a la conversación donde vive.
 * Para access_type = 'restricted', el llamador debe verificar la lista blanca
 * por separado (el download endpoint lo hace).
 */
export async function getAttachmentForUser(
  attachmentId: string,
  userId: string,
): Promise<AttachmentRow | null> {
  const r = await pool.query<AttachmentRow>(
    `SELECT a.id, a.conversation_id, a.uploader_user_id, a.uploader_device_id,
            a.storage_key, a.byte_size, a.created_at,
            a.access_type, a.download_pin_hash, a.message_id
       FROM attachments a
      WHERE a.id = $1
        AND EXISTS (
          SELECT 1 FROM conversation_members cm
           WHERE cm.conversation_id = a.conversation_id AND cm.user_id = $2
        )`,
    [attachmentId, userId],
  );
  return r.rows[0] ?? null;
}

/** Verifica si un usuario está en la lista blanca de acceso del adjunto. */
export async function isAttachmentAllowed(
  attachmentId: string,
  userId: string,
): Promise<boolean> {
  const r = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM attachment_allowed_users
        WHERE attachment_id = $1 AND user_id = $2
     ) AS exists`,
    [attachmentId, userId],
  );
  return r.rows[0]?.exists ?? false;
}

/** Vincula el attachment al mensaje que lo referencia (tiene la clave AES). */
export async function linkAttachmentToMessage(
  attachmentId: string,
  messageId: string,
  uploaderUserId: string,
): Promise<void> {
  await pool.query(
    `UPDATE attachments SET message_id = $1
      WHERE id = $2 AND uploader_user_id = $3 AND message_id IS NULL`,
    [messageId, attachmentId, uploaderUserId],
  );
}

/** Lista todos los adjuntos de una conversación con metadatos de acceso. */
export async function getAttachmentsForConversation(
  conversationId: string,
): Promise<AttachmentListItem[]> {
  // Query principal: attachments + uploader name
  const r = await pool.query<{
    id: string;
    uploader_user_id: string;
    uploader_display_name: string;
    byte_size: string;
    created_at: Date;
    access_type: string;
    has_pin: boolean;
    message_id: string | null;
  }>(
    `SELECT a.id,
            a.uploader_user_id,
            u.display_name AS uploader_display_name,
            a.byte_size,
            a.created_at,
            a.access_type,
            (a.download_pin_hash IS NOT NULL) AS has_pin,
            a.message_id
       FROM attachments a
       JOIN users u ON u.id = a.uploader_user_id
      WHERE a.conversation_id = $1
      ORDER BY a.created_at DESC`,
    [conversationId],
  );

  if (r.rows.length === 0) return [];

  // Query secundaria: lista blanca de acceso para todos los attachments
  const ids = r.rows.map((row) => row.id);
  const allowedRows = await pool.query<{
    attachment_id: string;
    user_id: string;
  }>(
    `SELECT attachment_id, user_id
       FROM attachment_allowed_users
      WHERE attachment_id = ANY($1)`,
    [ids],
  );

  // Agrupa los allowed users por attachment_id
  const allowedMap = new Map<string, string[]>();
  for (const row of allowedRows.rows) {
    if (!allowedMap.has(row.attachment_id)) {
      allowedMap.set(row.attachment_id, []);
    }
    allowedMap.get(row.attachment_id)!.push(row.user_id);
  }

  return r.rows.map((row) => ({
    id: row.id,
    uploaderUserId: row.uploader_user_id,
    uploaderDisplayName: row.uploader_display_name,
    byteSize: Number(row.byte_size),
    createdAt: row.created_at.toISOString(),
    accessType: row.access_type as "all" | "restricted",
    allowedUserIds: allowedMap.get(row.id) ?? [],
    hasPin: row.has_pin,
    messageId: row.message_id,
  }));
}
