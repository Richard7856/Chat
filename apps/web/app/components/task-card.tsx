"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckSquare, Check, User, Loader2, Calendar } from "lucide-react";
import type { Task } from "@euromex/shared";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { getSocket } from "../lib/socket";

interface TaskMessagePayload {
  taskId: string;
  title: string;
  dueDate?: string;
  creatorId: string;
  assigneeIds: string[];
}

interface Props {
  payload: TaskMessagePayload;
  currentUserId: string;
}

export function TaskCard({ payload, currentUserId }: Props) {
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);

  const fetchTask = useCallback(async () => {
    try {
      const data = await api<Task>(`/tasks/${payload.taskId}`, {
        method: "GET",
        auth: true,
      });
      setTask(data);
    } catch {
      // usa el payload del mensaje como fallback
    } finally {
      setLoading(false);
    }
  }, [payload.taskId]);

  useEffect(() => {
    fetchTask();
  }, [fetchTask]);

  useEffect(() => {
    const socket = getSocket();
    const handler = (p: { taskId: string }) => {
      if (p.taskId === payload.taskId) fetchTask();
    };
    socket.on("task:updated", handler);
    return () => { socket.off("task:updated", handler); };
  }, [payload.taskId, fetchTask]);

  async function handleComplete() {
    setCompleting(true);
    try {
      await api(`/tasks/${payload.taskId}/complete`, {
        method: "POST",
        auth: true,
        body: {},
      });
      await fetchTask();
    } catch {
      // silenciar
    } finally {
      setCompleting(false);
    }
  }

  const assignees = task?.assignees ?? [];
  const myAssignee = assignees.find((a) => a.userId === currentUserId);
  const isAssignee = payload.assigneeIds.includes(currentUserId);
  const myStatus = myAssignee?.status ?? (isAssignee ? "pending" : null);

  const completedCount = assignees.filter((a) => a.status === "completed").length;
  const allDone = assignees.length > 0 && completedCount === assignees.length;

  const dueDateStr = (task?.dueDate ?? payload.dueDate)
    ? new Date((task?.dueDate ?? payload.dueDate) + "T00:00:00").toLocaleDateString("es-MX", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    // Card standalone — usa bg-card (blanco puro) + acento verde a la
    // izquierda. Funciona dentro de cualquier contenedor (sender bubble
    // azul, receiver bubble gris, calendario, etc.) sin perder contraste.
    <div className="card-elevated w-full max-w-sm overflow-hidden border-l-4 border-l-[hsl(var(--accent-task))]">
      {/* Encabezado */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--accent-task-soft))]">
            <CheckSquare className="size-3.5 text-[hsl(var(--accent-task))]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--accent-task))]">
              Tarea
            </div>
            <div
              className={[
                "mt-0.5 text-sm font-semibold text-card-foreground",
                allDone ? "line-through opacity-60" : "",
              ].join(" ")}
            >
              {task?.title ?? payload.title}
            </div>
            {task?.description && (
              <div className="mt-1 text-xs text-muted-foreground line-clamp-3">
                {task.description}
              </div>
            )}
            {dueDateStr && (
              <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                <Calendar className="size-3" />
                Vence: {dueDateStr}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Asignados */}
      {!loading && assignees.length > 0 && (
        <div className="px-3 pb-2 flex flex-wrap gap-1">
          {assignees.map((a) => (
            <span
              key={a.userId}
              className={[
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                a.status === "completed"
                  ? "bg-[hsl(var(--accent-task-soft))] text-[hsl(var(--accent-task))]"
                  : a.status === "in_progress"
                    ? "bg-blue-50 text-blue-700"
                    : "bg-muted text-muted-foreground",
              ].join(" ")}
            >
              {a.status === "completed" ? (
                <Check className="size-2.5" />
              ) : (
                <User className="size-2.5" />
              )}
              {a.displayName}
            </span>
          ))}
        </div>
      )}

      {loading && (
        <div className="px-3 pb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Cargando estado…
        </div>
      )}

      {/* Footer — barra de progreso + acción */}
      {!loading && assignees.length > 0 && (
        <div className="border-t border-border bg-muted/40 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">
              {completedCount} de {assignees.length} completados
            </span>

            {isAssignee && myStatus !== "completed" && task?.status !== "cancelled" && (
              <Button
                size="sm"
                className="h-7 gap-1 bg-[hsl(var(--accent-task))] text-xs text-white hover:bg-[hsl(var(--accent-task))]/90"
                onClick={handleComplete}
                disabled={completing}
              >
                {completing ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Check className="size-3" />
                )}
                Completar mi parte
              </Button>
            )}

            {isAssignee && myStatus === "completed" && (
              <span className="flex items-center gap-1 text-[11px] font-medium text-[hsl(var(--accent-task))]">
                <Check className="size-3" /> Hecho
              </span>
            )}
          </div>
        </div>
      )}

      {task?.status === "cancelled" && (
        <div className="border-t border-border bg-destructive/5 px-3 py-1.5 text-[11px] font-medium text-destructive">
          Tarea cancelada
        </div>
      )}
    </div>
  );
}
