import type { FastifyInstance } from "fastify";
import {
  TASK_CONTENT_TYPE,
  CreateTaskRequestSchema,
  type Task,
  type TaskAssignee,
} from "@euromex/shared";
import { requireAuth } from "../auth/jwt.js";
import { pool } from "../db/pg.js";
import {
  getConversationMembers,
  insertSystemMessage,
  isConversationMember,
} from "../chat/repo.js";
import {
  broadcastSystemMessage,
  broadcastTaskUpdated,
} from "../chat/socket.js";
import { sendPushToTaskAssignees } from "../lib/push.js";

// ─── DB row shapes ──────────────────────────────────────────────────────────

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  creator_user_id: string;
  creator_display_name: string;
  conversation_id: string | null;
  due_date: string | null;
  status: "open" | "cancelled";
  created_at: Date;
}

interface AssigneeRow {
  user_id: string;
  display_name: string;
  username: string;
  status: "pending" | "in_progress" | "completed";
  completed_at: Date | null;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

async function getTaskWithAssignees(taskId: string): Promise<Task | null> {
  const r = await pool.query<TaskRow>(
    `SELECT t.id, t.title, t.description, t.creator_user_id,
            u.display_name AS creator_display_name,
            t.conversation_id,
            to_char(t.due_date, 'YYYY-MM-DD') AS due_date,
            t.status, t.created_at
     FROM tasks t
     JOIN users u ON u.id = t.creator_user_id
     WHERE t.id = $1`,
    [taskId],
  );
  const row = r.rows[0];
  if (!row) return null;

  const ar = await pool.query<AssigneeRow>(
    `SELECT ta.user_id, u.display_name, u.username, ta.status, ta.completed_at
     FROM task_assignees ta
     JOIN users u ON u.id = ta.user_id
     WHERE ta.task_id = $1
     ORDER BY u.display_name`,
    [taskId],
  );

  const assignees: TaskAssignee[] = ar.rows.map((a) => ({
    userId: a.user_id,
    displayName: a.display_name,
    username: a.username,
    status: a.status,
    completedAt: a.completed_at ? a.completed_at.toISOString() : null,
  }));

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    creatorUserId: row.creator_user_id,
    creatorDisplayName: row.creator_display_name,
    conversationId: row.conversation_id,
    dueDate: row.due_date,
    status: row.status,
    assignees,
    createdAt: row.created_at.toISOString(),
  };
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export async function taskRoutes(app: FastifyInstance) {
  // POST /tasks — crear tarea
  app.post("/tasks", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session!.sub;
    const deviceId = req.session!.did;

    const parsed = CreateTaskRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_input", issues: parsed.error.issues });
    }
    const { title, description, dueDate, assigneeIds, conversationId } = parsed.data;

    // Nota: la firma de isConversationMember es (userId, conversationId) — orden importa.
    if (conversationId) {
      const isMember = await isConversationMember(userId, conversationId);
      if (!isMember) {
        return reply.status(403).send({ error: "not_member" });
      }
    }

    // Insertar tarea
    const tr = await pool.query<{ id: string }>(
      `INSERT INTO tasks (title, description, creator_user_id, conversation_id, due_date)
       VALUES ($1, $2, $3, $4, $5::date)
       RETURNING id`,
      [title, description ?? null, userId, conversationId ?? null, dueDate ?? null],
    );
    const taskId = tr.rows[0]!.id;

    // Insertar asignados (deduplicar)
    const allAssignees = [...new Set(assigneeIds)];
    for (const aid of allAssignees) {
      await pool.query(
        `INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [taskId, aid],
      );
    }

    // Publicar mensaje en el chat si hay conversación
    if (conversationId) {
      const contentJson = JSON.stringify({
        taskId,
        title,
        dueDate: dueDate ?? null,
        creatorId: userId,
        assigneeIds: allAssignees,
      });
      const watchers = await getConversationMembers(conversationId);
      const { messageId, createdAt } = await insertSystemMessage({
        conversationId,
        senderUserId: userId,
        senderDeviceId: deviceId,
        content: contentJson,
        contentType: TASK_CONTENT_TYPE,
      });
      broadcastSystemMessage(app, {
        messageId,
        conversationId,
        actorUserId: userId,
        actorDeviceId: deviceId,
        contentJson,
        contentType: TASK_CONTENT_TYPE,
        createdAt,
        watcherUserIds: watchers.map((w) => w.userId),
      });
    }

    // Audit log
    await pool.query(
      `INSERT INTO audit_log (user_id, device_id, action, metadata, ip, user_agent)
       VALUES ($1, $2, 'task.created', $3, $4, $5)`,
      [userId, deviceId, JSON.stringify({ taskId }), req.ip, req.headers["user-agent"] ?? null],
    );

    const task = await getTaskWithAssignees(taskId);

    // Push a asignados offline (puede incluir al creador si se asignó a sí mismo)
    const creatorName = task?.creatorDisplayName ?? "Alguien";
    sendPushToTaskAssignees(app, allAssignees, title, creatorName, conversationId ?? null).catch(() => {});

    return reply.status(201).send(task);
  });

  // GET /tasks — lista del usuario (como creador o asignado)
  app.get("/tasks", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session!.sub;
    const query = req.query as { from?: string; to?: string };

    const rows = await pool.query<{ id: string }>(
      `SELECT t.id
       FROM tasks t
       WHERE (t.creator_user_id = $1
              OR EXISTS (SELECT 1 FROM task_assignees ta
                         WHERE ta.task_id = t.id AND ta.user_id = $1))
         AND ($2::date IS NULL OR t.due_date IS NULL OR t.due_date >= $2::date)
         AND ($3::date IS NULL OR t.due_date IS NULL OR t.due_date <= $3::date)
       ORDER BY t.due_date ASC NULLS LAST, t.created_at ASC`,
      [userId, query.from ?? null, query.to ?? null],
    );

    const tasks = await Promise.all(rows.rows.map((r) => getTaskWithAssignees(r.id)));
    return reply.send({ tasks: tasks.filter(Boolean) });
  });

  // GET /tasks/:id — detalle + asignados
  app.get("/tasks/:id", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session!.sub;
    const { id } = req.params as { id: string };

    const task = await getTaskWithAssignees(id);
    if (!task) return reply.status(404).send({ error: "not_found" });

    const isInvolved =
      task.creatorUserId === userId ||
      task.assignees.some((a) => a.userId === userId);
    if (!isInvolved) return reply.status(403).send({ error: "forbidden" });

    return reply.send(task);
  });

  // POST /tasks/:id/complete — marcar al requester como completado
  app.post("/tasks/:id/complete", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session!.sub;
    const { id } = req.params as { id: string };

    const ar = await pool.query<{ user_id: string; status: string }>(
      "SELECT user_id, status FROM task_assignees WHERE task_id = $1 AND user_id = $2",
      [id, userId],
    );
    if (ar.rows.length === 0) {
      return reply.status(403).send({ error: "not_assignee" });
    }
    if (ar.rows[0]!.status === "completed") {
      return reply.status(409).send({ error: "already_completed" });
    }

    await pool.query(
      `UPDATE task_assignees
       SET status = 'completed', completed_at = now()
       WHERE task_id = $1 AND user_id = $2`,
      [id, userId],
    );

    // Emitir actualización a miembros de la conversación
    const tr = await pool.query<{ conversation_id: string | null }>(
      "SELECT conversation_id FROM tasks WHERE id = $1",
      [id],
    );
    const convId = tr.rows[0]?.conversation_id ?? null;
    if (convId) {
      const watchers = await getConversationMembers(convId);
      broadcastTaskUpdated(app, id, convId, watchers.map((w) => w.userId));
    }

    const task = await getTaskWithAssignees(id);
    return reply.send(task);
  });

  // PATCH /tasks/:id — editar (solo creador)
  app.patch("/tasks/:id", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session!.sub;
    const { id } = req.params as { id: string };

    const tr = await pool.query<{ creator_user_id: string }>(
      "SELECT creator_user_id FROM tasks WHERE id = $1",
      [id],
    );
    if (!tr.rows[0]) return reply.status(404).send({ error: "not_found" });
    if (tr.rows[0].creator_user_id !== userId) {
      return reply.status(403).send({ error: "forbidden" });
    }

    const { title, description, dueDate } = req.body as {
      title?: string;
      description?: string;
      dueDate?: string;
    };

    await pool.query(
      `UPDATE tasks
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           due_date = COALESCE($3::date, due_date)
       WHERE id = $4`,
      [title ?? null, description ?? null, dueDate ?? null, id],
    );

    const task = await getTaskWithAssignees(id);
    return reply.send(task);
  });

  // DELETE /tasks/:id — soft cancel (solo creador)
  app.delete("/tasks/:id", { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.session!.sub;
    const { id } = req.params as { id: string };

    const tr = await pool.query<{ creator_user_id: string }>(
      "SELECT creator_user_id FROM tasks WHERE id = $1",
      [id],
    );
    if (!tr.rows[0]) return reply.status(404).send({ error: "not_found" });
    if (tr.rows[0].creator_user_id !== userId) {
      return reply.status(403).send({ error: "forbidden" });
    }

    await pool.query("UPDATE tasks SET status = 'cancelled' WHERE id = $1", [id]);
    return reply.status(204).send();
  });
}
