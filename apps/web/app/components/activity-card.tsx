"use client";

import { useCallback, useEffect, useState } from "react";
import { Calendar, CheckCircle2, XCircle, Clock, MapPin, Loader2, User } from "lucide-react";
import type { Activity } from "@euromex/shared";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { getSocket } from "../lib/socket";

interface ActivityMessagePayload {
  activityId: string;
  title: string;
  scheduledAt: string;
  location?: string;
  creatorId: string;
  participantIds: string[];
}

interface Props {
  payload: ActivityMessagePayload;
  currentUserId: string;
}

export function ActivityCard({ payload, currentUserId }: Props) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [rsvping, setRsvping] = useState(false);

  const fetchActivity = useCallback(async () => {
    try {
      const data = await api<Activity>(`/activities/${payload.activityId}`, {
        method: "GET",
        auth: true,
      });
      setActivity(data);
    } catch {
      // Mantiene el payload del mensaje como fallback
    } finally {
      setLoading(false);
    }
  }, [payload.activityId]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  // Escucha actualizaciones de RSVP por socket
  useEffect(() => {
    const socket = getSocket();
    const handler = (p: { activityId: string }) => {
      if (p.activityId === payload.activityId) fetchActivity();
    };
    socket.on("activity:updated", handler);
    return () => { socket.off("activity:updated", handler); };
  }, [payload.activityId, fetchActivity]);

  async function handleRsvp(status: "confirmed" | "declined") {
    setRsvping(true);
    try {
      await api(`/activities/${payload.activityId}/rsvp`, {
        method: "POST",
        auth: true,
        body: { status },
      });
      await fetchActivity();
    } catch {
      // silenciar; el estado se actualiza con el refetch
    } finally {
      setRsvping(false);
    }
  }

  const scheduledDate = new Date(payload.scheduledAt);
  const dateStr = scheduledDate.toLocaleDateString("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const timeStr = scheduledDate.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const participants = activity?.participants ?? [];
  const myParticipant = participants.find((p) => p.userId === currentUserId);
  const isParticipant = payload.participantIds.includes(currentUserId);
  const myRsvp = myParticipant?.rsvpStatus ?? (isParticipant ? "pending" : null);

  const confirmedCount = participants.filter((p) => p.rsvpStatus === "confirmed").length;

  return (
    // Card standalone con acento morado (categoría "actividad").
    // Diseño paralelo al TaskCard para coherencia visual.
    <div className="card-elevated w-full max-w-sm overflow-hidden border-l-4 border-l-[hsl(var(--accent-activity))]">
      {/* Encabezado */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--accent-activity-soft))]">
            <Calendar className="size-3.5 text-[hsl(var(--accent-activity))]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--accent-activity))]">
              Actividad
            </div>
            <div className="mt-0.5 text-sm font-semibold text-card-foreground">
              {activity?.title ?? payload.title}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {dateStr} · {timeStr}
              </span>
              {(activity?.location ?? payload.location) && (
                <span className="flex items-center gap-1">
                  <MapPin className="size-3" />
                  {activity?.location ?? payload.location}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Participantes */}
      {!loading && participants.length > 0 && (
        <div className="px-3 pb-2 flex flex-wrap gap-1">
          {participants.map((p) => (
            <span
              key={p.userId}
              className={[
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                p.rsvpStatus === "confirmed"
                  ? "bg-[hsl(var(--accent-task-soft))] text-[hsl(var(--accent-task))]"
                  : p.rsvpStatus === "declined"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground",
              ].join(" ")}
            >
              {p.rsvpStatus === "confirmed" ? (
                <CheckCircle2 className="size-2.5" />
              ) : p.rsvpStatus === "declined" ? (
                <XCircle className="size-2.5" />
              ) : (
                <User className="size-2.5" />
              )}
              {p.displayName}
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

      {/* Footer — resumen + acciones RSVP */}
      {!loading && participants.length > 0 && (
        <div className="border-t border-border bg-muted/40 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">
              {confirmedCount} de {participants.length} confirmados
            </span>

            {isParticipant && myRsvp === "pending" && activity?.status !== "cancelled" && (
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  className="h-7 gap-1 bg-[hsl(var(--accent-activity))] text-xs text-white hover:bg-[hsl(var(--accent-activity))]/90"
                  onClick={() => handleRsvp("confirmed")}
                  disabled={rsvping}
                >
                  {rsvping ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
                  Confirmar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => handleRsvp("declined")}
                  disabled={rsvping}
                >
                  <XCircle className="size-3" />
                  Declinar
                </Button>
              </div>
            )}

            {isParticipant && myRsvp === "confirmed" && (
              <span className="flex items-center gap-1 text-[11px] font-medium text-[hsl(var(--accent-task))]">
                <CheckCircle2 className="size-3" /> Confirmado
              </span>
            )}
            {isParticipant && myRsvp === "declined" && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <XCircle className="size-3" /> Declinado
              </span>
            )}
          </div>
        </div>
      )}

      {activity?.status === "cancelled" && (
        <div className="border-t border-border bg-destructive/5 px-3 py-1.5 text-[11px] font-medium text-destructive">
          Actividad cancelada
        </div>
      )}
    </div>
  );
}
