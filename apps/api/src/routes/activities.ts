import type { FastifyInstance } from "fastify";
import {
  ACTIVITY_CONTENT_TYPE,
  CreateActivityRequestSchema,
  RsvpRequestSchema,
  type Activity,
  type ActivityParticipant,
} from "@euromex/shared";
import { requireAuth } from "../auth/jwt.js";
import { pool } from "../db/pg.js";
import {
  getConversationMembers,
  insertSystemMessage,
  isConversationMember,
} from "../chat/repo.js";
import {
  broadcastActivityUpdated,
  broadcastSystemMessage,
} from "../chat/socket.js";
import { sendPushToActivityParticipants } from "../lib/push.js";

// ─── DB row shapes ──────────────────────────────────────────────────────────

interface ActivityRow {
  id: string;
  title: string;
  description: string | null;
  creator_user_id: string;
  creator_display_name: string;
  conversation_id: string | null;
  scheduled_at: Date;
  duration_minutes: number | null;
  location: string | null;
  status: "active" | "cancelled";
  created_at: Date;
}

interface ParticipantRow {
  user_id: string;
  display_name: string;
  username: string;
  rsvp_status: "pending" | "confirmed" | "declined";
  responded_at: Date | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getActivityWithParticipants(activityId: string): Promise<Activity | null> {
  const r = await pool.query<ActivityRow>(
    `SELECT a.id, a.title, a.description, a.creator_user_id,
            u.display_name AS creator_display_name,
            a.conversation_id, a.scheduled_at, a.duration_minutes,
            a.location, a.status, a.created_at
     FROM activities a
     JOIN users u ON u.id = a.creator_user_id
     WHERE a.id = $1`,
    [activityId],
  );
  const row = r.rows[0];
  if (!row) return null;

  const pr = await pool.query<ParticipantRow>(
    `SELECT ap.user_id, u.display_name, u.username, ap.rsvp_status, ap.responded_at
     FROM activity_participants ap
     JOIN users u ON u.id = ap.user_id
     WHERE ap.activity_id = $1
     ORDER BY u.display_name`,
    [activityId],
  );

  const participants: ActivityParticipant[] = pr.rows.map((p) => ({
    userId: p.user_id,
    displayName: p.display_name,
    username: p.username,
    rsvpStatus: p.rsvp_status,
    respondedAt: p.responded_at ? p.responded_at.toISOString() : null,
  }));

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    creatorUserId: row.creator_user_id,
    creatorDisplayName: row.creator_display_name,
    conversationId: row.conversation_id,
    scheduledAt: row.scheduled_at.toISOString(),
    durationMinutes: row.duration_minutes,
    location: row.location,
    status: row.status,
    participants,
    createdAt: row.created_at.toISOString(),
  };
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export async function activityRoutes(app: FastifyInstance) {
  // POST /activities — crear actividad
  app.post("/activities", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session!.sub;
    const deviceId = req.session!.did;

    const parsed = CreateActivityRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
    }
    const { title, description, scheduledAt, durationMinutes, location, participantIds, conversationId } = parsed.data;

    // Verificar membresía si se indica una conversación.
    // Nota: la firma de isConversationMember es (userId, conversationId) — orden importa.
    if (conversationId) {
      const isMember = await isConversationMember(userId, conversationId);
      if (!isMember) {
        return reply.status(403).send({ error: "not_member" });
      }
    }

    // Insertar actividad
    const ar = await pool.query<{ id: string }>(
      `INSERT INTO activities (title, description, creator_user_id, conversation_id,
                               scheduled_at, duration_minutes, location)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [title, description ?? null, userId, conversationId ?? null,
       scheduledAt, durationMinutes ?? null, location ?? null],
    );
    const activityId = ar.rows[0]!.id;

    // Insertar participantes (deduplicar, incluir siempre al creador)
    const allParticipants = [...new Set([userId, ...participantIds])];
    for (const pid of allParticipants) {
      await pool.query(
        `INSERT INTO activity_participants (activity_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [activityId, pid],
      );
    }

    // Publicar mensaje en el chat si hay conversación
    if (conversationId) {
      const contentJson = JSON.stringify({
        activityId,
        title,
        scheduledAt,
        location: location ?? null,
        creatorId: userId,
        participantIds: allParticipants,
      });
      const watchers = await getConversationMembers(conversationId);
      const { messageId, createdAt } = await insertSystemMessage({
        conversationId,
        senderUserId: userId,
        senderDeviceId: deviceId,
        content: contentJson,
        contentType: ACTIVITY_CONTENT_TYPE,
      });
      broadcastSystemMessage(app, {
        messageId,
        conversationId,
        actorUserId: userId,
        actorDeviceId: deviceId,
        contentJson,
        contentType: ACTIVITY_CONTENT_TYPE,
        createdAt,
        watcherUserIds: watchers.map((w) => w.userId),
      });
    }

    // Audit log
    await pool.query(
      `INSERT INTO audit_log (user_id, device_id, action, metadata, ip, user_agent)
       VALUES ($1, $2, 'activity.created', $3, $4, $5)`,
      [userId, deviceId, JSON.stringify({ activityId }), req.ip, req.headers["user-agent"] ?? null],
    );

    const activity = await getActivityWithParticipants(activityId);

    // Push a participantes offline (excluir al creador que ya sabe de la actividad)
    const pushTargets = allParticipants.filter((pid) => pid !== userId);
    if (pushTargets.length > 0) {
      const creatorName = activity?.creatorDisplayName ?? "Alguien";
      sendPushToActivityParticipants(app, pushTargets, title, creatorName, conversationId ?? null).catch(() => {});
    }
    return reply.status(201).send(activity);
  });

  // GET /activities — lista del usuario (como creador o participante)
  app.get("/activities", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session!.sub;
    const query = req.query as { from?: string; to?: string };

    const rows = await pool.query<ActivityRow & { creator_display_name: string }>(
      `SELECT a.id, a.title, a.description, a.creator_user_id,
              u.display_name AS creator_display_name,
              a.conversation_id, a.scheduled_at, a.duration_minutes,
              a.location, a.status, a.created_at
       FROM activities a
       JOIN users u ON u.id = a.creator_user_id
       WHERE (a.creator_user_id = $1
              OR EXISTS (SELECT 1 FROM activity_participants ap
                         WHERE ap.activity_id = a.id AND ap.user_id = $1))
         AND ($2::timestamptz IS NULL OR a.scheduled_at >= $2::timestamptz)
         AND ($3::timestamptz IS NULL OR a.scheduled_at <= $3::timestamptz)
       ORDER BY a.scheduled_at ASC`,
      [userId, query.from ?? null, query.to ?? null],
    );

    const activities = await Promise.all(
      rows.rows.map((row) => getActivityWithParticipants(row.id)),
    );
    return reply.send({ activities: activities.filter(Boolean) });
  });

  // GET /activities/:id — detalle + participantes
  app.get("/activities/:id", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session!.sub;
    const { id } = req.params as { id: string };

    const activity = await getActivityWithParticipants(id);
    if (!activity) {
      return reply.status(404).send({ error: "not_found" });
    }
    // Solo participantes o creador pueden ver
    const isInvolved =
      activity.creatorUserId === userId ||
      activity.participants.some((p) => p.userId === userId);
    if (!isInvolved) {
      return reply.status(403).send({ error: "forbidden" });
    }
    return reply.send(activity);
  });

  // POST /activities/:id/rsvp — actualizar RSVP
  app.post("/activities/:id/rsvp", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session!.sub;
    const { id } = req.params as { id: string };

    const parsed = RsvpRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_input" });
    }

    const pr = await pool.query<{ user_id: string }>(
      "SELECT user_id FROM activity_participants WHERE activity_id = $1 AND user_id = $2",
      [id, userId],
    );
    if (pr.rows.length === 0) {
      return reply.status(403).send({ error: "not_participant" });
    }

    await pool.query(
      `UPDATE activity_participants
       SET rsvp_status = $1, responded_at = now()
       WHERE activity_id = $2 AND user_id = $3`,
      [parsed.data.status, id, userId],
    );

    // Emitir actualización a miembros de la conversación
    const ar = await pool.query<{ conversation_id: string | null }>(
      "SELECT conversation_id FROM activities WHERE id = $1",
      [id],
    );
    const convId = ar.rows[0]?.conversation_id ?? null;
    if (convId) {
      const watchers = await getConversationMembers(convId);
      broadcastActivityUpdated(app, id, convId, watchers.map((w) => w.userId));
    }

    const activity = await getActivityWithParticipants(id);
    return reply.send(activity);
  });

  // PATCH /activities/:id — editar (solo creador)
  app.patch("/activities/:id", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session!.sub;
    const { id } = req.params as { id: string };

    const ar = await pool.query<{ creator_user_id: string }>(
      "SELECT creator_user_id FROM activities WHERE id = $1",
      [id],
    );
    if (!ar.rows[0]) return reply.status(404).send({ error: "not_found" });
    if (ar.rows[0].creator_user_id !== userId) {
      return reply.status(403).send({ error: "forbidden" });
    }

    const { title, scheduledAt, location, description } = req.body as {
      title?: string;
      scheduledAt?: string;
      location?: string;
      description?: string;
    };

    await pool.query(
      `UPDATE activities
       SET title = COALESCE($1, title),
           scheduled_at = COALESCE($2::timestamptz, scheduled_at),
           location = COALESCE($3, location),
           description = COALESCE($4, description)
       WHERE id = $5`,
      [title ?? null, scheduledAt ?? null, location ?? null, description ?? null, id],
    );

    const activity = await getActivityWithParticipants(id);
    return reply.send(activity);
  });

  // DELETE /activities/:id — soft cancel (solo creador)
  app.delete("/activities/:id", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session!.sub;
    const { id } = req.params as { id: string };

    const ar = await pool.query<{ creator_user_id: string }>(
      "SELECT creator_user_id FROM activities WHERE id = $1",
      [id],
    );
    if (!ar.rows[0]) return reply.status(404).send({ error: "not_found" });
    if (ar.rows[0].creator_user_id !== userId) {
      return reply.status(403).send({ error: "forbidden" });
    }

    await pool.query(
      "UPDATE activities SET status = 'cancelled' WHERE id = $1",
      [id],
    );
    return reply.status(204).send();
  });
}
