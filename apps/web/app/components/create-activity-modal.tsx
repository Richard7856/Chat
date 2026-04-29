"use client";

import { useState } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import type { ConversationMember } from "@euromex/shared";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface Props {
  conversationId: string;
  members: ConversationMember[];
  currentUserId: string;
  onCreated: () => void;
  onClose: () => void;
}

export function CreateActivityModal({ conversationId, members, currentUserId, onCreated, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [participantIds, setParticipantIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const others = members.filter((m) => m.userId !== currentUserId);

  function toggleParticipant(id: string) {
    setParticipantIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !date || !time) return;
    if (participantIds.size === 0) {
      setError("Selecciona al menos un participante.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const scheduledAt = new Date(`${date}T${time}`).toISOString();
      await api("/activities", {
        method: "POST",
        auth: true,
        body: {
          title: title.trim(),
          description: description.trim() || undefined,
          scheduledAt,
          durationMinutes: duration ? Number(duration) : undefined,
          location: location.trim() || undefined,
          participantIds: Array.from(participantIds),
          conversationId,
        },
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al crear actividad");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-xl"
      >
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <CalendarPlus className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">Nueva actividad</h2>
          </div>
        </div>

        <div className="space-y-3 px-5 py-4">
          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Título <span className="text-destructive">*</span>
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej. Junta semanal"
              className="h-9 text-sm"
              required
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Fecha <span className="text-destructive">*</span>
              </label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-9 text-sm"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Hora <span className="text-destructive">*</span>
              </label>
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="h-9 text-sm"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Duración (min)
              </label>
              <Input
                type="number"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="60"
                min="1"
                className="h-9 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Lugar
              </label>
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Sala A"
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Descripción
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Agenda o notas…"
              rows={2}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Participantes <span className="text-destructive">*</span>
            </label>
            <div className="max-h-32 overflow-y-auto rounded-lg border border-border bg-background p-1">
              {others.map((m) => (
                <label
                  key={m.userId}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-xs hover:bg-secondary/50"
                >
                  <input
                    type="checkbox"
                    checked={participantIds.has(m.userId)}
                    onChange={() => toggleParticipant(m.userId)}
                    className="accent-[hsl(var(--primary))]"
                  />
                  <span className="font-medium">{m.displayName}</span>
                  <span className="text-muted-foreground">@{m.username}</span>
                </label>
              ))}
              {others.length === 0 && (
                <p className="px-2 py-2 text-xs text-muted-foreground">No hay otros miembros.</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" size="sm" disabled={saving || !title.trim() || !date || !time}>
            {saving && <Loader2 className="mr-1 size-3 animate-spin" />}
            Crear actividad
          </Button>
        </div>
      </form>
    </div>
  );
}
