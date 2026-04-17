import type { FastifyInstance } from "fastify";
import { Server as SocketIOServer } from "socket.io";
import type {
  ClientToServerEvents,
  Conversation,
  Message,
  ServerToClientEvents,
} from "@euromex/shared";
import { config } from "../config.js";
import { pool } from "../db/pg.js";
import type { SessionClaims } from "../auth/jwt.js";
import { insertMessage, isConversationMember } from "./repo.js";

type IOServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  { session: SessionClaims }
>;

declare module "fastify" {
  interface FastifyInstance {
    io?: IOServer;
  }
}

const CONV_ROOM = (id: string) => `conv:${id}`;
const USER_ROOM = (id: string) => `user:${id}`;

export function registerSocketIO(app: FastifyInstance): IOServer {
  const io: IOServer = new SocketIOServer(app.server, {
    cors: { origin: config.corsOrigins, credentials: true },
    path: "/socket.io",
  });

  // Autenticación: cada conexión debe traer un JWT en auth.token.
  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (typeof socket.handshake.headers.authorization === "string"
          ? socket.handshake.headers.authorization.replace(/^Bearer\s+/i, "")
          : undefined);
      if (!token) return next(new Error("no_token"));
      const claims = app.jwt.verify<SessionClaims>(token);

      // Verifica que user + device sigan activos (revocación en vivo).
      const row = await pool.query<{ u: string; d: string }>(
        `SELECT u.status AS u, d.status AS d
           FROM users u JOIN devices d ON d.user_id = u.id
          WHERE u.id = $1 AND d.id = $2`,
        [claims.sub, claims.did],
      );
      const r = row.rows[0];
      if (!r || r.u !== "active" || r.d !== "active") {
        return next(new Error("session_revoked"));
      }

      socket.data.session = claims;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const session = socket.data.session;
    socket.join(USER_ROOM(session.sub));

    // Auto-join: al conectar, mete al socket en la room de cada conversación
    // en la que participa. Así recibe "message:new" sin tener que hacer
    // "conversation:join" uno por uno.
    void (async () => {
      const r = await pool.query<{ conversation_id: string }>(
        "SELECT conversation_id FROM conversation_members WHERE user_id = $1",
        [session.sub],
      );
      for (const row of r.rows) socket.join(CONV_ROOM(row.conversation_id));
    })();

    socket.on("conversation:join", async (conversationId, ack) => {
      try {
        if (!(await isConversationMember(session.sub, conversationId))) {
          ack?.(false);
          return;
        }
        socket.join(CONV_ROOM(conversationId));
        ack?.(true);
      } catch {
        ack?.(false);
      }
    });

    socket.on("conversation:leave", (conversationId) => {
      socket.leave(CONV_ROOM(conversationId));
    });

    socket.on("message:send", async ({ conversationId, content, clientId }, ack) => {
      try {
        if (typeof content !== "string" || content.length === 0 || content.length > 4000) {
          ack?.({ ok: false, error: "invalid_content" });
          return;
        }
        if (typeof clientId !== "string" || clientId.length < 8) {
          ack?.({ ok: false, error: "invalid_client_id" });
          return;
        }
        if (!(await isConversationMember(session.sub, conversationId))) {
          ack?.({ ok: false, error: "not_a_member" });
          return;
        }
        const msg = await insertMessage({
          conversationId,
          senderUserId: session.sub,
          senderDeviceId: session.did,
          content,
        });
        io.to(CONV_ROOM(conversationId)).emit("message:new", msg);
        ack?.({ ok: true, message: msg });
      } catch (err) {
        app.log.error({ err }, "socket.message:send failed");
        ack?.({ ok: false, error: "internal" });
      }
    });

    socket.on("typing:set", async ({ conversationId, typing }) => {
      if (!(await isConversationMember(session.sub, conversationId))) return;
      socket.to(CONV_ROOM(conversationId)).emit("typing:update", {
        conversationId,
        userId: session.sub,
        typing,
      });
    });
  });

  app.decorate("io", io);
  return io;
}

export function broadcastMessage(app: FastifyInstance, msg: Message) {
  app.io?.to(CONV_ROOM(msg.conversationId)).emit("message:new", msg);
}

export function broadcastConversationUpdated(
  app: FastifyInstance,
  conv: Conversation,
) {
  for (const m of conv.members) {
    app.io?.to(USER_ROOM(m.userId)).emit("conversation:updated", conv);
  }
}
