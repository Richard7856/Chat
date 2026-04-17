import type { FastifyInstance } from "fastify";
import { Server as SocketIOServer } from "socket.io";
import {
  CreateConversationRequestSchema,
  PublishIdentityRequestSchema,
  SendMessageRequestSchema,
  type Conversation,
  type DeviceKey,
  type Message,
  type ServerToClientEvents,
  type ClientToServerEvents,
  type UserListItem,
} from "@euromex/shared";
import { requireAuth } from "../auth/jwt.js";
import {
  createConversation,
  findDmBetween,
  getConversationDeviceKeys,
  getConversationForUser,
  insertEncryptedMessage,
  isConversationMember,
  listConversationsForUser,
  listMessages,
  listUsers,
  markConversationRead,
  publishDeviceIdentity,
} from "../chat/repo.js";
import { broadcastConversationUpdated } from "../chat/socket.js";

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
      if (!(await isConversationMember(userId, req.params.id))) {
        return reply.code(403).send({ error: "not_a_member" });
      }
      await markConversationRead(userId, req.params.id);
      return reply.code(204).send();
    },
  );
}
