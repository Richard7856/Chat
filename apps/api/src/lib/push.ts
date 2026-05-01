/**
 * Web Push — envío de notificaciones a dispositivos offline.
 *
 * Usa el protocolo Web Push (RFC 8291) con VAPID (RFC 8292).
 * Los mensajes push son best-effort: si el endpoint falla, lo ignoramos
 * silenciosamente y no rompemos el flujo del mensaje/tarea/actividad.
 *
 * Reglas de negocio:
 * - Solo enviamos push a dispositivos OFFLINE (isUserOnline() = false).
 *   Si el usuario tiene socket activo ya recibe el evento en tiempo real.
 * - Para "nuevo mensaje": notificamos a todos los miembros offline salvo
 *   el propio sender.
 * - Para "@menciones": notificamos solo a los mencionados (subset de miembros).
 * - Para "tarea asignada / actividad invitada": notificamos a los asignados
 *   que estén offline.
 */

import webpush from "web-push";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { pool } from "../db/pg.js";
import { isUserOnline } from "../chat/socket.js";

// --------------------------------------------------------------------------
// Inicializar VAPID al importar el módulo.
// Si las claves no están configuradas, las llamadas a sendPush no harán nada.
// --------------------------------------------------------------------------
let vapidReady = false;

if (config.vapidPublicKey && config.vapidPrivateKey) {
  webpush.setVapidDetails(
    config.vapidSubject,
    config.vapidPublicKey,
    config.vapidPrivateKey,
  );
  vapidReady = true;
}

// --------------------------------------------------------------------------
// Tipo que coincide con la columna push_subscriptions en la BD.
// --------------------------------------------------------------------------
interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

// --------------------------------------------------------------------------
// Core: enviar a un array de suscripciones.
// --------------------------------------------------------------------------
async function sendToSubscriptions(
  app: FastifyInstance,
  subscriptions: PushSubscriptionRow[],
  payload: Record<string, unknown>,
): Promise<void> {
  if (!vapidReady || subscriptions.length === 0) return;

  const payloadStr = JSON.stringify(payload);

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payloadStr,
        );
      } catch (err: unknown) {
        // 410 Gone = la suscripción ya no es válida, limpiarla de la BD
        if (typeof err === "object" && err !== null && "statusCode" in err) {
          const status = (err as { statusCode: number }).statusCode;
          if (status === 410 || status === 404) {
            await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [sub.endpoint]).catch(() => {});
          }
        }
        app.log.warn({ err, endpoint: sub.endpoint }, "push: sendNotification failed");
      }
    }),
  );
}

// --------------------------------------------------------------------------
// Obtener todas las suscripciones activas de un conjunto de usuarios.
// --------------------------------------------------------------------------
async function getSubscriptionsForUsers(userIds: string[]): Promise<PushSubscriptionRow[]> {
  if (userIds.length === 0) return [];
  const r = await pool.query<PushSubscriptionRow>(
    `SELECT endpoint, p256dh, auth
       FROM push_subscriptions
      WHERE user_id = ANY($1::uuid[])`,
    [userIds],
  );
  return r.rows;
}

// --------------------------------------------------------------------------
// Público: enviar push a todos los miembros OFFLINE de una conversación,
// excepto el sender. Usado en socket.ts al recibir message:send.
// --------------------------------------------------------------------------
export async function sendPushToOfflineMembers(
  app: FastifyInstance,
  conversationId: string,
  senderUserId: string,
): Promise<void> {
  // Obtener info de la conversación para el título de la notificación
  const convR = await pool.query<{ name: string | null; type: string }>(
    "SELECT name, type FROM conversations WHERE id = $1",
    [conversationId],
  );
  const conv = convR.rows[0];
  if (!conv) return;

  // Nombre del sender
  const senderR = await pool.query<{ display_name: string }>(
    "SELECT display_name FROM users WHERE id = $1",
    [senderUserId],
  );
  const senderName = senderR.rows[0]?.display_name ?? "Alguien";

  // Miembros offline de la conversación (excluir sender)
  const membersR = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM conversation_members
      WHERE conversation_id = $1 AND user_id <> $2`,
    [conversationId, senderUserId],
  );

  const offlineUserIds = membersR.rows
    .map((r) => r.user_id)
    .filter((uid) => !isUserOnline(uid));

  if (offlineUserIds.length === 0) return;

  const subs = await getSubscriptionsForUsers(offlineUserIds);

  const convName = conv.type === "dm" ? senderName : (conv.name ?? "Grupo");
  await sendToSubscriptions(app, subs, {
    type: "message",
    title: convName,
    body: `${conv.type === "group" ? senderName + ": " : ""}Nuevo mensaje`,
    conversationId,
  });
}

// --------------------------------------------------------------------------
// Público: enviar push solo a usuarios mencionados (@mention) que estén offline.
// Los IDs ya vienen validados como miembros desde socket.ts.
// --------------------------------------------------------------------------
export async function sendPushToMentioned(
  app: FastifyInstance,
  mentionedUserIds: string[],
  conversationId: string,
): Promise<void> {
  const offlineIds = mentionedUserIds.filter((uid) => !isUserOnline(uid));
  if (offlineIds.length === 0) return;

  const subs = await getSubscriptionsForUsers(offlineIds);
  await sendToSubscriptions(app, subs, {
    type: "mention",
    title: "Te mencionaron",
    body: "Alguien te mencionó en un mensaje",
    conversationId,
  });
}

// --------------------------------------------------------------------------
// Público: push para tarea asignada. Llamado desde routes/tasks.ts.
// --------------------------------------------------------------------------
export async function sendPushToTaskAssignees(
  app: FastifyInstance,
  assigneeIds: string[],
  taskTitle: string,
  assignerDisplayName: string,
  conversationId: string | null,
): Promise<void> {
  const offlineIds = assigneeIds.filter((uid) => !isUserOnline(uid));
  if (offlineIds.length === 0) return;

  const subs = await getSubscriptionsForUsers(offlineIds);
  await sendToSubscriptions(app, subs, {
    type: "task_assigned",
    title: "Nueva tarea asignada",
    body: `${assignerDisplayName} te asignó: ${taskTitle}`,
    conversationId,
  });
}

// --------------------------------------------------------------------------
// Público: push para actividad (evento con RSVP) donde el usuario es invitado.
// Llamado desde routes/activities.ts.
// --------------------------------------------------------------------------
export async function sendPushToActivityParticipants(
  app: FastifyInstance,
  participantIds: string[],
  activityTitle: string,
  creatorDisplayName: string,
  conversationId: string | null,
): Promise<void> {
  const offlineIds = participantIds.filter((uid) => !isUserOnline(uid));
  if (offlineIds.length === 0) return;

  const subs = await getSubscriptionsForUsers(offlineIds);
  await sendToSubscriptions(app, subs, {
    type: "activity_invited",
    title: "Invitación a actividad",
    body: `${creatorDisplayName} te invitó a: ${activityTitle}`,
    conversationId,
  });
}
