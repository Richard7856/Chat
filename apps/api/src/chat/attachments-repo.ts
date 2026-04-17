import { pool } from "../db/pg.js";

export interface AttachmentRow {
  id: string;
  conversation_id: string;
  uploader_user_id: string;
  uploader_device_id: string;
  storage_key: string;
  byte_size: string; // BIGINT llega como string desde pg
  created_at: Date;
}

export async function insertAttachment(params: {
  conversationId: string;
  uploaderUserId: string;
  uploaderDeviceId: string;
  storageKey: string;
  byteSize: number;
}): Promise<{ id: string }> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO attachments
       (conversation_id, uploader_user_id, uploader_device_id, storage_key, byte_size)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      params.conversationId,
      params.uploaderUserId,
      params.uploaderDeviceId,
      params.storageKey,
      params.byteSize,
    ],
  );
  return { id: r.rows[0]!.id };
}

/**
 * Devuelve el adjunto si el usuario pertenece a la conversación donde vive.
 * Combina la validación de membresía con la query en una sola ida a DB.
 */
export async function getAttachmentForUser(
  attachmentId: string,
  userId: string,
): Promise<AttachmentRow | null> {
  const r = await pool.query<AttachmentRow>(
    `SELECT a.id, a.conversation_id, a.uploader_user_id, a.uploader_device_id,
            a.storage_key, a.byte_size, a.created_at
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
