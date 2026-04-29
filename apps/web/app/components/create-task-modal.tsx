"use client";

import { useState } from "react";
import { ClipboardList, Loader2 } from "lucide-react";
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

export function CreateTaskModal({ conversationId, members, currentUserId, onCreated, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Todos los miembros pueden ser asignados, incluyendo el creador
  const allMembers = members;

  function toggleAssignee(id: string) {
    setAssigneeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (assigneeIds.size === 0) {
      setError("Selecciona al menos un responsable.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api("/tasks", {
        method: "POST",
        auth: true,
        body: {
          title: title.trim(),
          description: description.trim() || undefined,
          dueDate: dueDate || undefined,
          assigneeIds: Array.from(assigneeIds),
          conversationId,
        },
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al crear tarea");
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
            <ClipboardList className="size-4 text-green-400" />
            <h2 className="text-sm font-semibold">Nueva tarea</h2>
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
              placeholder="Ej. Revisar contrato Euromex"
              className="h-9 text-sm"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Descripción
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalles de la tarea…"
              rows={2}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Fecha límite
            </label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-9 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Responsables <span className="text-destructive">*</span>
            </label>
            <div className="max-h-36 overflow-y-auto rounded-lg border border-border bg-background p-1">
              {allMembers.map((m) => (
                <label
                  key={m.userId}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-xs hover:bg-secondary/50"
                >
                  <input
                    type="checkbox"
                    checked={assigneeIds.has(m.userId)}
                    onChange={() => toggleAssignee(m.userId)}
                    className="accent-[hsl(var(--primary))]"
                  />
                  <span className="font-medium">{m.displayName}</span>
                  <span className="text-muted-foreground">
                    {m.userId === currentUserId ? "(yo)" : `@${m.username}`}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" size="sm" disabled={saving || !title.trim()}>
            {saving && <Loader2 className="mr-1 size-3 animate-spin" />}
            Crear tarea
          </Button>
        </div>
      </form>
    </div>
  );
}
