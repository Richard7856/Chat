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
    <div className="w-full rounded-xl border border-primary/20 bg-primary/5 p-3">
      {/* Encabezado */}
      <div className="mb-2 flex items-start gap-2">
        <Calendar className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{activity?.title ?? payload.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
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

      {/* Participantes */}
      {!loading && participants.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {participants.map((p) => (
            <span
              key={p.userId}
              className={[
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                p.rsvpStatus === "confirmed"
                  ? "bg-green-500/15 text-green-700"
                  : p.rsvpStatus === "declined"
                    ? "bg-red-500/15 text-red-700"
                    : "bg-secondary text-muted-foreground",
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
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Cargando estado…
        </div>
      )}

      {/* Estado resumido */}
      {!loading && participants.length > 0 && (
        <div className="mb-2 text-[11px] text-muted-foreground">
          {confirmedCount} de {participants.length} confirmados
        </div>
      )}

      {/* Botones RSVP */}
      {isParticipant && myRsvp === "pending" && (
        <div className="flex gap-1.5">
          <Button
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => handleRsvp("confirmed")}
            disabled={rsvping}
          >
            {rsvping ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
            Confirmar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
            onClick={() => handleRsvp("declined")}
            disabled={rsvping}
          >
            <XCircle className="size-3" />
            Declinar
          </Button>
        </div>
      )}

      {isParticipant && myRsvp === "confirmed" && (
        <div className="flex items-center gap-1 text-[11px] text-green-700">
          <CheckCircle2 className="size-3" /> Confirmado
        </div>
      )}
      {isParticipant && myRsvp === "declined" && (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <XCircle className="size-3" /> Declinado
        </div>
      )}

      {activity?.status === "cancelled" && (
        <div className="mt-1 text-[11px] font-medium text-destructive">
          Actividad cancelada
        </div>
      )}
    </div>
  );
}
