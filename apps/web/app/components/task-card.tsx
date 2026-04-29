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
    <div className="w-full rounded-xl border border-green-500/20 bg-green-500/5 p-3">
      {/* Encabezado */}
      <div className="mb-2 flex items-start gap-2">
        <CheckSquare className="mt-0.5 size-4 shrink-0 text-green-400" />
        <div className="min-w-0 flex-1">
          <div
            className={[
              "text-sm font-semibold",
              allDone ? "line-through opacity-60" : "",
            ].join(" ")}
          >
            {task?.title ?? payload.title}
          </div>
          {(task?.description) && (
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {task.description}
            </div>
          )}
          {dueDateStr && (
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              <Calendar className="size-3" />
              Vence: {dueDateStr}
            </div>
          )}
        </div>
      </div>

      {/* Asignados */}
      {!loading && assignees.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {assignees.map((a) => (
            <span
              key={a.userId}
              className={[
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                a.status === "completed"
                  ? "bg-green-500/15 text-green-400"
                  : a.status === "in_progress"
                    ? "bg-blue-500/15 text-blue-400"
                    : "bg-secondary text-muted-foreground",
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
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Cargando estado…
        </div>
      )}

      {!loading && assignees.length > 0 && (
        <div className="mb-2 text-[11px] text-muted-foreground">
          {completedCount} de {assignees.length} completados
        </div>
      )}

      {/* Botón completar */}
      {isAssignee && myStatus !== "completed" && (
        <Button
          size="sm"
          className="h-7 gap-1 bg-green-600 text-xs hover:bg-green-700"
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
        <div className="flex items-center gap-1 text-[11px] text-green-400">
          <Check className="size-3" /> Tu parte está completada
        </div>
      )}

      {task?.status === "cancelled" && (
        <div className="mt-1 text-[11px] font-medium text-destructive">
          Tarea cancelada
        </div>
      )}
    </div>
  );
}
