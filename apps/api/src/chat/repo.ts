import type {
  Conversation,
  ConversationMember,
  ConversationType,
  DeviceKey,
  Message,
} from "@euromex/shared";
import { pool } from "../db/pg.js";

export interface IncomingEnvelope {
  recipientDeviceId: string;
  ciphertext: Buffer;
  nonce: Buffer;
}

export type RawConvRow = {
  id: string;
  type: "dm" | "group";
  name: string | null;
  description: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  last_read_at: Date | null;
  last_msg_id: string | null;
  last_msg_sender: string | null;
  last_msg_content: string | null;
  last_msg_created_at: Date | null;
  unread_count: string;
};

export async function isConversationMember(
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const r = await pool.query(
    "SELECT 1 FROM conversation_members WHERE user_id = $1 AND conversation_id = $2",
    [userId, conversationId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function getConversationMembers(
  conversationId: string,
): Promise<ConversationMember[]> {
  const r = await pool.query<{
    user_id: string;
    username: string;
    display_name: string;
    role: "member" | "admin";
    joined_at: Date;
  }>(
    `SELECT m.user_id, u.username, u.display_name, m.role, m.joined_at
       FROM conversation_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.conversation_id = $1
      ORDER BY u.display_name`,
    [conversationId],
  );
  return r.rows.map((row) => ({
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    joinedAt: row.joined_at.toISOString(),
  }));
}

function rowToConversation(
  row: RawConvRow,
  members: ConversationMember[],
): Conversation {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    description: row.description,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    members,
    lastMessage: row.last_msg_id
      ? {
          id: row.last_msg_id,
          senderUserId: row.last_msg_sender!,
          content: row.last_msg_content,
          createdAt: row.last_msg_created_at!.toISOString(),
        }
      : null,
    unreadCount: Number(row.unread_count),
  };
}

/**
 * Lista todas las conversaciones del usuario, con último mensaje y unread.
 */
export async function listConversationsForUser(userId: string): Promise<Conversation[]> {
  const r = await pool.query<RawConvRow>(
    `WITH my_convs AS (
       SELECT m.conversation_id, m.last_read_at
         FROM conversation_members m
        WHERE m.user_id = $1
     ),
     last_msg AS (
       SELECT DISTINCT ON (conversation_id)
              conversation_id, id, sender_user_id, content, created_at
         FROM messages
        WHERE conversation_id IN (SELECT conversation_id FROM my_convs)
        ORDER BY conversation_id, created_at DESC
     )
     SELECT c.id, c.type, c.name, c.description, c.created_by,
            c.created_at, c.updated_at,
            mc.last_read_at,
            lm.id AS last_msg_id,
            lm.sender_user_id AS last_msg_sender,
            lm.content AS last_msg_content,
            lm.created_at AS last_msg_created_at,
            COALESCE((
              SELECT COUNT(*) FROM messages msg
               WHERE msg.conversation_id = c.id
                 AND (mc.last_read_at IS NULL OR msg.created_at > mc.last_read_at)
                 AND msg.sender_user_id <> $1
            ), 0) AS unread_count
       FROM conversations c
       JOIN my_convs mc ON mc.conversation_id = c.id
       LEFT JOIN last_msg lm ON lm.conversation_id = c.id
      ORDER BY COALESCE(lm.created_at, c.created_at) DESC`,
    [userId],
  );

  const out: Conversation[] = [];
  for (const row of r.rows) {
    const members = await getConversationMembers(row.id);
    out.push(rowToConversation(row, members));
  }
  return out;
}

export async function getConversationForUser(
  userId: string,
  conversationId: string,
): Promise<Conversation | null> {
  const r = await pool.query<RawConvRow>(
    `WITH mc AS (
       SELECT last_read_at FROM conversation_members
        WHERE user_id = $1 AND conversation_id = $2
     ),
     lm AS (
       SELECT id, sender_user_id, content, created_at
         FROM messages
        WHERE conversation_id = $2
        ORDER BY created_at DESC
        LIMIT 1
     )
     SELECT c.id, c.type, c.name, c.description, c.created_by,
            c.created_at, c.updated_at,
            (SELECT last_read_at FROM mc) AS last_read_at,
            lm.id AS last_msg_id,
            lm.sender_user_id AS last_msg_sender,
            lm.content AS last_msg_content,
            lm.created_at AS last_msg_created_at,
            COALESCE((
              SELECT COUNT(*) FROM messages msg
               WHERE msg.conversation_id = c.id
                 AND (
                   (SELECT last_read_at FROM mc) IS NULL
                   OR msg.created_at > (SELECT last_read_at FROM mc)
                 )
                 AND msg.sender_user_id <> $1
            ), 0) AS unread_count
       FROM conversations c
       LEFT JOIN lm ON TRUE
      WHERE c.id = $2
        AND EXISTS (
          SELECT 1 FROM conversation_members
           WHERE conversation_id = c.id AND user_id = $1
        )`,
    [userId, conversationId],
  );
  const row = r.rows[0];
  if (!row) return null;
  const members = await getConversationMembers(row.id);
  return rowToConversation(row, members);
}

/** Devuelve el DM existente entre los dos usuarios, o null. */
export async function findDmBetween(
  userA: string,
  userB: string,
): Promise<string | null> {
  const r = await pool.query<{ id: string }>(
    `SELECT c.id
       FROM conversations c
      WHERE c.type = 'dm'
        AND EXISTS (SELECT 1 FROM conversation_members
                     WHERE conversation_id = c.id AND user_id = $1)
        AND EXISTS (SELECT 1 FROM conversation_members
                     WHERE conversation_id = c.id AND user_id = $2)
        AND (SELECT COUNT(*) FROM conversation_members
              WHERE conversation_id = c.id) = 2
      LIMIT 1`,
    [userA, userB],
  );
  return r.rows[0]?.id ?? null;
}

export async function createConversation(params: {
  type: ConversationType;
  name: string | null;
  description: string | null;
  createdBy: string;
  memberUserIds: string[];
}): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const cr = await client.query<{ id: string }>(
      `INSERT INTO conversations (type, name, description, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [params.type, params.name, params.description, params.createdBy],
    );
    const conversationId = cr.rows[0]!.id;

    const allMembers = Array.from(
      new Set([params.createdBy, ...params.memberUserIds]),
    );
    for (const userId of allMembers) {
      const role = userId === params.createdBy ? "admin" : "member";
      await client.query(
        `INSERT INTO conversation_members (conversation_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [conversationId, userId, role],
      );
    }

    await client.query("COMMIT");
    return conversationId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Inserta un mensaje E2EE: una fila en `messages` (sin content) + una fila
 * en `message_envelopes` por cada dispositivo destinatario.
 *
 * Devuelve el mensaje "personalizado" para cada dispositivo que recibirá
 * notificación: ciphertext/nonce = el sobre que le corresponde a ese
 * dispositivo. Los callers se encargan de emitirlo por el socket del
 * destinatario correcto.
 */
export async function insertEncryptedMessage(params: {
  conversationId: string;
  senderUserId: string;
  senderDeviceId: string;
  contentType: string;
  envelopes: IncomingEnvelope[];
}): Promise<{
  messageId: string;
  createdAt: Date;
  envelopes: Array<{ recipientDeviceId: string; ciphertext: Buffer; nonce: Buffer }>;
}> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const mr = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO messages (conversation_id, sender_user_id, sender_device_id, content, content_type)
       VALUES ($1, $2, $3, NULL, $4)
       RETURNING id, created_at`,
      [
        params.conversationId,
        params.senderUserId,
        params.senderDeviceId,
        params.contentType,
      ],
    );
    const messageId = mr.rows[0]!.id;
    const createdAt = mr.rows[0]!.created_at;

    for (const env of params.envelopes) {
      await client.query(
        `INSERT INTO message_envelopes (message_id, recipient_device, ciphertext, nonce)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [messageId, env.recipientDeviceId, env.ciphertext, env.nonce],
      );
    }

    await client.query(
      "UPDATE conversations SET updated_at = now() WHERE id = $1",
      [params.conversationId],
    );

    await client.query("COMMIT");
    return { messageId, createdAt, envelopes: params.envelopes };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Inserta un mensaje de sistema (aviso no-E2EE visible a todos): el JSON
 * del evento va en `content` en plaintext y `content_type` es el
 * SYSTEM_CONTENT_TYPE. No hay envelopes. Se broadcasta por socket al
 * CONV_ROOM para que todos los miembros conectados lo vean.
 */
export async function insertSystemMessage(params: {
  conversationId: string;
  senderUserId: string;
  senderDeviceId: string;
  content: string;
  contentType: string;
}): Promise<{ messageId: string; createdAt: Date }> {
  const r = await pool.query<{ id: string; created_at: Date }>(
    `INSERT INTO messages (conversation_id, sender_user_id, sender_device_id, content, content_type)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [
      params.conversationId,
      params.senderUserId,
      params.senderDeviceId,
      params.content,
      params.contentType,
    ],
  );
  await pool.query(
    "UPDATE conversations SET updated_at = now() WHERE id = $1",
    [params.conversationId],
  );
  return { messageId: r.rows[0]!.id, createdAt: r.rows[0]!.created_at };
}

/**
 * Fetch todos los dispositivos activos de los miembros de una conversación
 * (incluyendo los propios del caller). El cliente los necesita para cifrar
 * el mensaje una vez por dispositivo.
 */
export async function getConversationDeviceKeys(
  conversationId: string,
): Promise<DeviceKey[]> {
  const r = await pool.query<{
    device_id: string;
    user_id: string;
    identity_public_key: Buffer | null;
    device_name: string;
    platform: "web" | "ios" | "android" | "desktop";
  }>(
    `SELECT d.id AS device_id, d.user_id,
            d.identity_public_key, d.device_name, d.platform
       FROM devices d
       JOIN conversation_members m ON m.user_id = d.user_id
      WHERE m.conversation_id = $1 AND d.status = 'active'
      ORDER BY d.user_id, d.created_at`,
    [conversationId],
  );
  return r.rows.map((row) => ({
    deviceId: row.device_id,
    userId: row.user_id,
    identityPublicKey: row.identity_public_key
      ? row.identity_public_key.toString("base64")
      : null,
    deviceName: row.device_name,
    platform: row.platform,
  }));
}

export async function publishDeviceIdentity(
  deviceId: string,
  identityPublicKey: Buffer,
): Promise<void> {
  await pool.query(
    `UPDATE devices SET identity_public_key = $2
      WHERE id = $1`,
    [deviceId, identityPublicKey],
  );
}

/**
 * Lista mensajes y adjunta, si existe, el sobre dirigido al dispositivo del
 * caller. Los mensajes legados de Fase 3 traen `content` plano y envelope
 * null; los de Fase 4 traen content null y un envelope para el dispositivo
 * solicitante (si estaba activo y recibió su sobre).
 */
export async function listMessages(params: {
  conversationId: string;
  requesterDeviceId: string;
  limit: number;
  before?: string;
}): Promise<Message[]> {
  const { conversationId, requesterDeviceId, limit, before } = params;
  const values: unknown[] = [conversationId, requesterDeviceId, limit];
  let beforeClause = "";
  if (before) {
    values.push(before);
    beforeClause = `AND m.created_at < $${values.length}`;
  }
  const r = await pool.query<{
    id: string;
    conversation_id: string;
    sender_user_id: string;
    sender_device_id: string;
    content: string | null;
    content_type: string;
    created_at: Date;
    ciphertext: Buffer | null;
    nonce: Buffer | null;
  }>(
    `SELECT m.id, m.conversation_id, m.sender_user_id, m.sender_device_id,
            m.content, m.content_type, m.created_at,
            e.ciphertext, e.nonce
       FROM messages m
       LEFT JOIN message_envelopes e
         ON e.message_id = m.id AND e.recipient_device = $2
      WHERE m.conversation_id = $1
        ${beforeClause}
      ORDER BY m.created_at DESC
      LIMIT $3`,
    values,
  );
  return r.rows
    .map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      senderUserId: row.sender_user_id,
      senderDeviceId: row.sender_device_id,
      content: row.content,
      contentType: row.content_type,
      createdAt: row.created_at.toISOString(),
      envelope:
        row.ciphertext && row.nonce
          ? {
              ciphertext: row.ciphertext.toString("base64"),
              nonce: row.nonce.toString("base64"),
            }
          : null,
    }))
    .reverse();
}

export async function markConversationRead(
  userId: string,
  conversationId: string,
): Promise<void> {
  await pool.query(
    `UPDATE conversation_members
        SET last_read_at = now()
      WHERE user_id = $1 AND conversation_id = $2`,
    [userId, conversationId],
  );
}

export async function listUsers(
  excludeUserId: string,
  search?: string,
): Promise<Array<{ id: string; username: string; displayName: string; role: "user" | "admin" }>> {
  const params: unknown[] = [excludeUserId];
  let where = "WHERE status = 'active' AND id <> $1";
  if (search && search.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`);
    where += ` AND (LOWER(username) LIKE $${params.length} OR LOWER(display_name) LIKE $${params.length})`;
  }
  const r = await pool.query<{
    id: string;
    username: string;
    display_name: string;
    role: "user" | "admin";
  }>(
    `SELECT id, username, display_name, role
       FROM users
       ${where}
      ORDER BY display_name
      LIMIT 100`,
    params,
  );
  return r.rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
  }));
}
