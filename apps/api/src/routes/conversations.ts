import type { FastifyInstance } from "fastify";
import {
  CreateConversationRequestSchema,
  SendMessageRequestSchema,
  type Conversation,
  type Message,
  type UserListItem,
} from "@euromex/shared";
import { requireAuth } from "../auth/jwt.js";
import {
  createConversation,
  findDmBetween,
  getConversationForUser,
  insertMessage,
  isConversationMember,
  listConversationsForUser,
  listMessages,
  listUsers,
  markConversationRead,
} from "../chat/repo.js";
import { broadcastMessage, broadcastConversationUpdated } from "../chat/socket.js";

export async function conversationRoutes(app: FastifyInstance) {
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

      // Notifica a todos los miembros que tienen una nueva conversación.
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
  // Historial de mensajes (paginado hacia atrás)
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
        limit,
        before: req.query.before,
      });
      return { messages };
    },
  );

  // --------------------------------------------------------------------------
  // Enviar mensaje por REST (fallback si WebSocket falla)
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
      if (!(await isConversationMember(userId, req.params.id))) {
        return reply.code(403).send({ error: "not_a_member" });
      }
      const msg = await insertMessage({
        conversationId: req.params.id,
        senderUserId: userId,
        senderDeviceId: req.session!.did,
        content: parsed.data.content,
        contentType: parsed.data.contentType,
      });
      broadcastMessage(app, msg);
      return msg;
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
