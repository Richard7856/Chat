import type { FastifyInstance } from "fastify";
import { Server as SocketIOServer } from "socket.io";
import type {
  ClientToServerEvents,
  Conversation,
  EnvelopeInput,
  Message,
  ServerToClientEvents,
} from "@euromex/shared";
import { config } from "../config.js";
import { pool } from "../db/pg.js";
import type { SessionClaims } from "../auth/jwt.js";
import {
  insertEncryptedMessage,
  isConversationMember,
  type IncomingEnvelope,
} from "./repo.js";
import { linkAttachmentToMessage } from "./attachments-repo.js";

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
const DEVICE_ROOM = (id: string) => `device:${id}`;

function normalizeEnvelopes(raw: unknown): IncomingEnvelope[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200) return null;
  const out: IncomingEnvelope[] = [];
  for (const item of raw as EnvelopeInput[]) {
    if (
      typeof item?.recipientUserId !== "string" ||
      typeof item?.ciphertext !== "string" ||
      typeof item?.nonce !== "string"
    ) {
      return null;
    }
    try {
      out.push({
        recipientUserId: item.recipientUserId,
        ciphertext: Buffer.from(item.ciphertext, "base64"),
        nonce: Buffer.from(item.nonce, "base64"),
      });
    } catch {
      return null;
    }
  }
  return out;
}

/**
 * Fase 18 — Presencia online.
 * Mapa userId → Set<socketId> para manejar múltiples pestañas/dispositivos.
 * Solo se emite user:offline cuando el Set queda vacío (última conexión cerrada).
 */
const onlineSockets = new Map<string, Set<string>>();

/** Mapa userId → ISO timestamp del último disconnect (para "Última vez a las X"). */
const lastSeenMap = new Map<string, string>();

/** Permite a push.ts y al endpoint de presencia saber si un usuario está online. */
export function isUserOnline(userId: string): boolean {
  const sockets = onlineSockets.get(userId);
  return !!sockets && sockets.size > 0;
}

/** Devuelve el último timestamp offline de un userId (null si nunca se desconectó en esta sesión). */
export function getUserLastSeen(userId: string): string | null {
  return lastSeenMap.get(userId) ?? null;
}

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
    socket.join(DEVICE_ROOM(session.did));

    // Fase 18: registrar presencia
    if (!onlineSockets.has(session.sub)) onlineSockets.set(session.sub, new Set());
    const wasOffline = onlineSockets.get(session.sub)!.size === 0;
    onlineSockets.get(session.sub)!.add(socket.id);

    void (async () => {
      const r = await pool.query<{ conversation_id: string }>(
        "SELECT conversation_id FROM conversation_members WHERE user_id = $1",
        [session.sub],
      );
      for (const row of r.rows) socket.join(CONV_ROOM(row.conversation_id));

      // Fase 18: notificar a los miembros de cada conversación que este usuario
      // acaba de conectarse (solo si venía de offline, para evitar spam por multi-tab).
      if (wasOffline) {
        for (const row of r.rows) {
          socket.to(CONV_ROOM(row.conversation_id)).emit("user:online", { userId: session.sub });
        }
      }
    })();

    // Fase 18: manejar desconexión
    socket.on("disconnect", () => {
      const sockets = onlineSockets.get(session.sub);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          // Última conexión del usuario cerrada — marcar offline
          onlineSockets.delete(session.sub);
          const lastSeenAt = new Date().toISOString();
          lastSeenMap.set(session.sub, lastSeenAt);

          void pool.query<{ conversation_id: string }>(
            "SELECT conversation_id FROM conversation_members WHERE user_id = $1",
            [session.sub],
          ).then((r) => {
            for (const row of r.rows) {
              io.to(CONV_ROOM(row.conversation_id)).emit("user:offline", {
                userId: session.sub,
                lastSeenAt,
              });
            }
          });
        }
      }
    });

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

    socket.on("message:send", async (payload, ack) => {
      try {
        const { conversationId, clientId, contentType, envelopes, attachmentId, mentionedUserIds } = payload;
        if (typeof conversationId !== "string" || typeof clientId !== "string") {
          ack?.({ ok: false, error: "invalid_payload" });
          return;
        }
        const ct = typeof contentType === "string" ? contentType : "text/plain";

        const normalized = normalizeEnvelopes(envelopes);
        if (!normalized) {
          ack?.({ ok: false, error: "invalid_envelopes" });
          return;
        }
        if (!(await isConversationMember(session.sub, conversationId))) {
          ack?.({ ok: false, error: "not_a_member" });
          return;
        }

        const res = await insertEncryptedMessage({
          conversationId,
          senderUserId: session.sub,
          senderDeviceId: session.did,
          contentType: ct,
          envelopes: normalized,
        });

        // Fase 14: vincular attachment.message_id si el mensaje referencia uno.
        if (typeof attachmentId === "string") {
          linkAttachmentToMessage(attachmentId, res.messageId, session.sub).catch((err) => {
            app.log.warn({ err, attachmentId }, "socket: failed to link attachment to message");
          });
        }

        fanOutMessage(io, {
          messageId: res.messageId,
          createdAt: res.createdAt,
          conversationId,
          senderUserId: session.sub,
          senderDeviceId: session.did,
          contentType: ct,
          envelopes: res.envelopes,
        });

        // Fase 19: push a offline members + menciones
        // (import lazy para evitar ciclo de dependencias con lib/push.ts)
        void import("../lib/push.js").then(async ({ sendPushToOfflineMembers, sendPushToMentioned }) => {
          await sendPushToOfflineMembers(app, conversationId, session.sub).catch(() => {});
          if (Array.isArray(mentionedUserIds) && mentionedUserIds.length > 0) {
            // Verificar que todos los mencionados son miembros (seguridad)
            const members = await pool.query<{ user_id: string }>(
              "SELECT user_id FROM conversation_members WHERE conversation_id = $1",
              [conversationId],
            );
            const memberSet = new Set(members.rows.map((r) => r.user_id));
            const validMentions = mentionedUserIds.filter((id) => memberSet.has(id) && id !== session.sub);
            if (validMentions.length > 0) {
              await sendPushToMentioned(app, validMentions, conversationId).catch(() => {});
            }
          }
        }).catch(() => {});  // push es best-effort, nunca rompe el flujo del mensaje

        // ACK al emisor con la vista del mensaje. El emisor renderiza su
        // propio plaintext porque ya lo tiene; el envelope propio (cifrado a
        // su identidad de usuario) sirve para sus OTROS devices.
        const ownEnv = res.envelopes.find(
          (e) => e.recipientUserId === session.sub,
        );
        ack?.({
          ok: true,
          message: {
            id: res.messageId,
            conversationId,
            senderUserId: session.sub,
            senderDeviceId: session.did,
            content: null,
            contentType: ct,
            createdAt: res.createdAt.toISOString(),
            envelope: ownEnv
              ? {
                  ciphertext: ownEnv.ciphertext.toString("base64"),
                  nonce: ownEnv.nonce.toString("base64"),
                }
              : null,
            // Fase 25: defaults para mensajes nuevos.
            editedAt: null,
            editCount: 0,
            deletedAt: null,
            deletedByUserId: null,
          },
        });
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

function fanOutMessage(
  io: IOServer,
  params: {
    messageId: string;
    createdAt: Date;
    conversationId: string;
    senderUserId: string;
    senderDeviceId: string;
    contentType: string;
    envelopes: Array<{
      recipientUserId: string;
      ciphertext: Buffer;
      nonce: Buffer;
    }>;
  },
) {
  const base = {
    id: params.messageId,
    conversationId: params.conversationId,
    senderUserId: params.senderUserId,
    senderDeviceId: params.senderDeviceId,
    content: null,
    contentType: params.contentType,
    createdAt: params.createdAt.toISOString(),
    // Fase 25: defaults para mensajes nuevos.
    editedAt: null,
    editCount: 0,
    deletedAt: null,
    deletedByUserId: null,
  };

  // Fase 31: un envelope por usuario → emitir a su USER_ROOM (todos sus
  // devices reciben el mismo envelope y lo descifran con la identidad
  // compartida). Se emite también al usuario emisor: el device que envió
  // ya tiene el plaintext (deduplica), pero sus OTROS devices lo descifran
  // → sincronización multi-device también para el emisor.
  for (const env of params.envelopes) {
    const msg: Message = {
      ...base,
      envelope: {
        ciphertext: env.ciphertext.toString("base64"),
        nonce: env.nonce.toString("base64"),
      },
    };
    io.to(USER_ROOM(env.recipientUserId)).emit("message:new", msg);
  }
}

/**
 * Broadcasts un mensaje de sistema (aviso no-E2EE) solo a los watchers
 * (usuarios con `receives_security_alerts=true` que son miembros de la
 * conversación). Emite por USER_ROOM de cada watcher — regular users
 * NUNCA reciben estos eventos por socket.
 *
 * Para que también apareczan en historial, el filtrado por rol se hace
 * a nivel DB en `listMessages` (ver repo.ts).
 */
export function broadcastSystemMessage(
  app: FastifyInstance,
  params: {
    messageId: string;
    conversationId: string;
    actorUserId: string;
    actorDeviceId: string;
    contentJson: string;
    contentType: string;
    createdAt: Date;
    watcherUserIds: string[];
  },
) {
  const msg: Message = {
    id: params.messageId,
    conversationId: params.conversationId,
    senderUserId: params.actorUserId,
    senderDeviceId: params.actorDeviceId,
    content: params.contentJson,
    contentType: params.contentType,
    createdAt: params.createdAt.toISOString(),
    envelope: null,
    // Fase 25: defaults; los system messages no se editan ni borran.
    editedAt: null,
    editCount: 0,
    deletedAt: null,
    deletedByUserId: null,
  };
  for (const userId of params.watcherUserIds) {
    app.io?.to(USER_ROOM(userId)).emit("message:new", msg);
  }
}

export function broadcastConversationUpdated(
  app: FastifyInstance,
  conv: Conversation,
) {
  for (const m of conv.members) {
    app.io?.to(USER_ROOM(m.userId)).emit("conversation:updated", conv);
  }
}

/** Emite `activity:updated` a todos los miembros de la conversación (Fase 15). */
export function broadcastActivityUpdated(
  app: FastifyInstance,
  activityId: string,
  conversationId: string,
  memberUserIds: string[],
) {
  for (const userId of memberUserIds) {
    app.io?.to(USER_ROOM(userId)).emit("activity:updated", { activityId, conversationId });
  }
}

/** Emite `task:updated` a todos los miembros de la conversación (Fase 15). */
export function broadcastTaskUpdated(
  app: FastifyInstance,
  taskId: string,
  conversationId: string,
  memberUserIds: string[],
) {
  for (const userId of memberUserIds) {
    app.io?.to(USER_ROOM(userId)).emit("task:updated", { taskId, conversationId });
  }
}
