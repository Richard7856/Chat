import type { FastifyInstance } from "fastify";
import { Server as SocketIOServer } from "socket.io";
import {
  AddEnvelopesRequestSchema,
  CreateConversationRequestSchema,
  PublishIdentityRequestSchema,
  SendMessageRequestSchema,
  SYSTEM_CONTENT_TYPE,
  type Conversation,
  type DeviceKey,
  type Message,
  type ServerToClientEvents,
  type ClientToServerEvents,
  type SystemEvent,
  type UserListItem,
} from "@euromex/shared";
import { requireAuth } from "../auth/jwt.js";
import { getUserPermissions } from "../auth/permissions.js";
import {
  addMessageEnvelopes,
  createConversation,
  deviceIsInConversation,
  findDmBetween,
  getAlertWatchersInConversation,
  getConversationDeviceKeys,
  getConversationForUser,
  getConversationMembers,
  getMessageMeta,
  getRelatedUserIds,
  insertEncryptedMessage,
  insertSystemMessage,
  isConversationMember,
  listConversationsForUser,
  listMessages,
  listUsers,
  loadSystemActor,
  markConversationRead,
  publishDeviceIdentity,
} from "../chat/repo.js";
import { linkAttachmentToMessage } from "../chat/attachments-repo.js";
import {
  broadcastConversationUpdated,
  broadcastSystemMessage,
} from "../chat/socket.js";
import { isUserOnline, getUserLastSeen } from "../chat/socket.js";
import { pool } from "../db/pg.js";

const DEVICE_ROOM = (id: string) => `device:${id}`;

export async function conversationRoutes(app: FastifyInstance) {
  // --------------------------------------------------------------------------
  // Publicar clave pública de identidad (X25519) del dispositivo actual.
  // --------------------------------------------------------------------------
  app.post(
    "/auth/devices/publish-identity",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const parsed = PublishIdentityRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      }
      let keyBuf: Buffer;
      try {
        keyBuf = Buffer.from(parsed.data.identityPublicKey, "base64");
      } catch {
        return reply.code(400).send({ error: "invalid_key" });
      }
      if (keyBuf.length !== 32) {
        return reply.code(400).send({ error: "invalid_key_length" });
      }
      await publishDeviceIdentity(req.session!.did, keyBuf);

      // Fase 23b — Multi-device backfill: notificar a todos los peers que
      // comparten conversación con este usuario que existe un device nuevo
      // con identity pública lista. Sus clientes pueden re-cifrar mensajes
      // históricos para este device (solo los que ellos mismos enviaron, ya
      // que solo el sender tiene plaintext).
      const peers = await getRelatedUserIds(req.session!.sub);
      const event = {
        userId: req.session!.sub,
        deviceId: req.session!.did,
        identityPublicKey: parsed.data.identityPublicKey,
      };
      for (const peerUserId of peers) {
        app.io?.to(`user:${peerUserId}`).emit("device:identity-published", event);
      }

      return reply.code(204).send();
    },
  );

  // --------------------------------------------------------------------------
  // Fase 23b — Agregar envelopes a un mensaje existente (multi-device backfill).
  //
  // Solo el SENDER original del mensaje puede agregar envelopes — es el único
  // device que tiene el plaintext válido. Idempotente vía ON CONFLICT en BD.
  // --------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/messages/:id/envelopes",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const parsed = AddEnvelopesRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      }
      const userId = req.session!.sub;
      const messageId = req.params.id;

      const meta = await getMessageMeta(messageId);
      if (!meta) {
        return reply.code(404).send({ error: "message_not_found" });
      }
      if (meta.senderUserId !== userId) {
        // Solo el sender puede backfill — solo él tiene plaintext.
        return reply.code(403).send({ error: "not_sender" });
      }

      // Validar que cada recipientDeviceId pertenezca a un miembro de la
      // conversación. Hacemos las validaciones en paralelo y descartamos
      // los inválidos silenciosamente (mejor que rechazar todo el batch
      // por uno malo).
      const validatedEnvelopes: Array<{
        recipientDeviceId: string;
        ciphertext: Buffer;
        nonce: Buffer;
      }> = [];
      await Promise.all(
        parsed.data.envelopes.map(async (e) => {
          const ok = await deviceIsInConversation(
            e.recipientDeviceId,
            meta.conversationId,
          );
          if (!ok) return;
          try {
            validatedEnvelopes.push({
              recipientDeviceId: e.recipientDeviceId,
              ciphertext: Buffer.from(e.ciphertext, "base64"),
              nonce: Buffer.from(e.nonce, "base64"),
            });
          } catch {
            /* base64 invalido — saltar */
          }
        }),
      );

      if (validatedEnvelopes.length === 0) {
        return reply.code(400).send({ error: "no_valid_envelopes" });
      }

      const inserted = await addMessageEnvelopes(messageId, validatedEnvelopes);

      // Notificar a cada device que recibió un envelope NUEVO (no a los que
      // ya tenían — ON CONFLICT DO NOTHING los excluyó).
      for (const env of validatedEnvelopes) {
        if (!inserted.includes(env.recipientDeviceId)) continue;
        app.io?.to(DEVICE_ROOM(env.recipientDeviceId)).emit("message:envelope-added", {
          messageId,
          conversationId: meta.conversationId,
          envelope: {
            ciphertext: env.ciphertext.toString("base64"),
            nonce: env.nonce.toString("base64"),
          },
          senderUserId: meta.senderUserId,
          senderDeviceId: meta.senderDeviceId,
          contentType: meta.contentType,
          createdAt: meta.createdAt.toISOString(),
        });
      }

      return reply.code(204).send();
    },
  );

  // --------------------------------------------------------------------------
  // Listado de usuarios para elegir miembros al crear una conversación
  // --------------------------------------------------------------------------
  app.get(
    "/users",
    { preHandler: [requireAuth] },
    async (req): Promise<{ users: UserListItem[] }> => {
      const q = (req.query as { q?: string })?.q;
      const users = await listUsers(req.session!.sub, q);
      return { users };
    },
  );

  // --------------------------------------------------------------------------
  // Listado de conversaciones del usuario
  // --------------------------------------------------------------------------
  app.get(
    "/conversations",
    { preHandler: [requireAuth] },
    async (req): Promise<{ conversations: Conversation[] }> => {
      const conversations = await listConversationsForUser(req.session!.sub);
      return { conversations };
    },
  );

  // --------------------------------------------------------------------------
  // Crear conversación (DM o grupo). Para DM, re-usa si ya existe.
  // --------------------------------------------------------------------------
  app.post(
    "/conversations",
    { preHandler: [requireAuth] },
    async (req, reply): Promise<Conversation> => {
      const parsed = CreateConversationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      }
      const { type, name, description, memberUserIds } = parsed.data;
      const userId = req.session!.sub;

      // Fase 24: el admin puede revocar la capacidad de crear grupos por
      // usuario. Los DMs siempre se permiten (es el chat 1:1 base).
      if (type === "group") {
        const perms = await getUserPermissions(userId);
        if (!perms.canCreateGroups) {
          return reply.code(403).send({ error: "groups_disabled" });
        }
      }

      if (type === "dm") {
        const other = memberUserIds[0]!;
        if (other === userId) {
          return reply.code(400).send({ error: "cannot_dm_self" });
        }
        const existing = await findDmBetween(userId, other);
        if (existing) {
          const conv = await getConversationForUser(userId, existing);
          return conv!;
        }
      }

      const id = await createConversation({
        type,
        name: name ?? null,
        description: description ?? null,
        createdBy: userId,
        memberUserIds,
      });

      const conv = await getConversationForUser(userId, id);
      if (!conv) {
        return reply.code(500).send({ error: "conversation_not_found_after_create" });
      }

      broadcastConversationUpdated(app, conv);

      // System event "conversation_created" — solo para grupos (los DMs
      // son 1-a-1, la contraparte ya sabe que existe). Solo visible a
      // watchers (super admins).
      if (type === "group") {
        const actor = await loadSystemActor(userId);
        if (actor) {
          const event: SystemEvent = {
            kind: "conversation_created",
            actor,
            conversationType: type,
            memberUserIds: conv.members.map((m) => m.userId),
          };
          const { messageId, createdAt } = await insertSystemMessage({
            conversationId: conv.id,
            senderUserId: userId,
            senderDeviceId: req.session!.did,
            content: JSON.stringify(event),
            contentType: SYSTEM_CONTENT_TYPE,
          });
          const watcherUserIds = await getAlertWatchersInConversation(conv.id);
          broadcastSystemMessage(app, {
            messageId,
            conversationId: conv.id,
            actorUserId: userId,
            actorDeviceId: req.session!.did,
            contentJson: JSON.stringify(event),
            contentType: SYSTEM_CONTENT_TYPE,
            createdAt,
            watcherUserIds,
          });
        }
      }

      return conv;
    },
  );

  // --------------------------------------------------------------------------
  // Detalle de una conversación específica
  // --------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/conversations/:id",
    { preHandler: [requireAuth] },
    async (req, reply): Promise<Conversation> => {
      const conv = await getConversationForUser(req.session!.sub, req.params.id);
      if (!conv) return reply.code(404).send({ error: "not_found" });
      return conv;
    },
  );

  // --------------------------------------------------------------------------
  // Fetch claves públicas de todos los dispositivos de la conversación.
  // El cliente las necesita para cifrar el mensaje por cada dispositivo.
  // --------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/conversations/:id/device-keys",
    { preHandler: [requireAuth] },
    async (req, reply): Promise<{ devices: DeviceKey[] }> => {
      const userId = req.session!.sub;
      if (!(await isConversationMember(userId, req.params.id))) {
        return reply.code(403).send({ error: "not_a_member" });
      }
      const devices = await getConversationDeviceKeys(req.params.id);
      return { devices };
    },
  );

  // --------------------------------------------------------------------------
  // Historial de mensajes (paginado hacia atrás). Incluye el sobre dirigido
  // a MI dispositivo, si existe.
  // --------------------------------------------------------------------------
  app.get<{
    Params: { id: string };
    Querystring: { limit?: string; before?: string };
  }>(
    "/conversations/:id/messages",
    { preHandler: [requireAuth] },
    async (req, reply): Promise<{ messages: Message[] }> => {
      const userId = req.session!.sub;
      if (!(await isConversationMember(userId, req.params.id))) {
        return reply.code(403).send({ error: "not_a_member" });
      }
      const limit = Math.min(Number(req.query.limit ?? "50"), 200);
      const messages = await listMessages({
        conversationId: req.params.id,
        requesterDeviceId: req.session!.did,
        requesterWatchesAlerts: req.session!.watchesAlerts,
        limit,
        before: req.query.before,
      });
      return { messages };
    },
  );

  // --------------------------------------------------------------------------
  // Enviar mensaje por REST (fallback si WebSocket falla). Recibe envelopes
  // ya cifrados por el cliente.
  // --------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/conversations/:id/messages",
    { preHandler: [requireAuth] },
    async (req, reply): Promise<Message> => {
      const parsed = SendMessageRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      }
      const userId = req.session!.sub;
      const deviceId = req.session!.did;
      if (!(await isConversationMember(userId, req.params.id))) {
        return reply.code(403).send({ error: "not_a_member" });
      }

      const envelopes = parsed.data.envelopes.map((e) => ({
        recipientDeviceId: e.recipientDeviceId,
        ciphertext: Buffer.from(e.ciphertext, "base64"),
        nonce: Buffer.from(e.nonce, "base64"),
      }));

      const res = await insertEncryptedMessage({
        conversationId: req.params.id,
        senderUserId: userId,
        senderDeviceId: deviceId,
        contentType: parsed.data.contentType,
        envelopes,
      });

      // Fase 14: si el mensaje referencia un adjunto, vincular message_id.
      if (parsed.data.attachmentId) {
        await linkAttachmentToMessage(
          parsed.data.attachmentId,
          res.messageId,
          userId,
        ).catch((err) => {
          // Fallo no crítico: el adjunto se sube igual, solo queda sin link.
          req.log.warn({ err, attachmentId: parsed.data.attachmentId }, "failed to link attachment to message");
        });
      }

      const io = app.io as
        | SocketIOServer<ClientToServerEvents, ServerToClientEvents>
        | undefined;
      const base = {
        id: res.messageId,
        conversationId: req.params.id,
        senderUserId: userId,
        senderDeviceId: deviceId,
        content: null,
        contentType: parsed.data.contentType,
        createdAt: res.createdAt.toISOString(),
      };
      if (io) {
        for (const env of res.envelopes) {
          if (env.recipientDeviceId === deviceId) continue;
          io.to(DEVICE_ROOM(env.recipientDeviceId)).emit("message:new", {
            ...base,
            envelope: {
              ciphertext: env.ciphertext.toString("base64"),
              nonce: env.nonce.toString("base64"),
            },
          });
        }
      }

      const ownEnv = res.envelopes.find((e) => e.recipientDeviceId === deviceId);
      return {
        ...base,
        envelope: ownEnv
          ? {
              ciphertext: ownEnv.ciphertext.toString("base64"),
              nonce: ownEnv.nonce.toString("base64"),
            }
          : null,
      };
    },
  );

  // --------------------------------------------------------------------------
  // Marcar como leído
  // --------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/conversations/:id/read",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const userId = req.session!.sub;
      const conversationId = req.params.id;
      if (!(await isConversationMember(userId, conversationId))) {
        return reply.code(403).send({ error: "not_a_member" });
      }
      const { lastReadAt } = await markConversationRead(userId, conversationId);

      // Fase 18: notificar a todos los miembros que este usuario leyó la conversación.
      // Los clientes usan este evento para actualizar los indicadores ✓✓.
      const members = await getConversationMembers(conversationId);
      for (const m of members) {
        app.io?.to(`user:${m.userId}`).emit("message:read", {
          conversationId,
          userId,
          lastReadAt: lastReadAt.toISOString(),
        });
      }

      return reply.code(204).send();
    },
  );

  // --------------------------------------------------------------------------
  // Fase 17: Mensajes guardados (starred messages)
  // --------------------------------------------------------------------------

  // POST /conversations/:id/messages/:msgId/star — guardar mensaje
  app.post<{ Params: { id: string; msgId: string } }>(
    "/conversations/:id/messages/:msgId/star",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const userId = req.session!.sub;
      if (!(await isConversationMember(userId, req.params.id))) {
        return reply.code(403).send({ error: "not_a_member" });
      }
      await pool.query(
        `INSERT INTO starred_messages (user_id, message_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, req.params.msgId],
      );
      return reply.code(204).send();
    },
  );

  // DELETE /conversations/:id/messages/:msgId/star — quitar de guardados
  app.delete<{ Params: { id: string; msgId: string } }>(
    "/conversations/:id/messages/:msgId/star",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const userId = req.session!.sub;
      await pool.query(
        "DELETE FROM starred_messages WHERE user_id = $1 AND message_id = $2",
        [userId, req.params.msgId],
      );
      return reply.code(204).send();
    },
  );

  // GET /starred-messages — lista de mensajes guardados del usuario (cross-conversation)
  app.get(
    "/starred-messages",
    { preHandler: [requireAuth] },
    async (req): Promise<{ messages: Array<{ messageId: string; conversationId: string; starredAt: string }> }> => {
      const userId = req.session!.sub;
      const r = await pool.query<{ message_id: string; conversation_id: string; created_at: Date }>(
        `SELECT sm.message_id, m.conversation_id, sm.created_at
           FROM starred_messages sm
           JOIN messages m ON m.id = sm.message_id
          WHERE sm.user_id = $1
          ORDER BY sm.created_at DESC
          LIMIT 200`,
        [userId],
      );
      return {
        messages: r.rows.map((row) => ({
          messageId: row.message_id,
          conversationId: row.conversation_id,
          starredAt: row.created_at.toISOString(),
        })),
      };
    },
  );

  // --------------------------------------------------------------------------
  // Fase 18: Presencia — GET /users/presence?ids=uuid,uuid,...
  // El cliente lo llama al abrir una conversación para saber quién está online.
  // --------------------------------------------------------------------------
  app.get(
    "/users/presence",
    { preHandler: [requireAuth] },
    async (req): Promise<{ presence: Array<{ userId: string; online: boolean; lastSeenAt: string | null }> }> => {
      const idsParam = (req.query as { ids?: string }).ids ?? "";
      const ids = idsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 100); // máx 100 por request

      const presence = ids.map((userId) => ({
        userId,
        online: isUserOnline(userId),
        lastSeenAt: isUserOnline(userId) ? null : getUserLastSeen(userId),
      }));

      return { presence };
    },
  );
}
