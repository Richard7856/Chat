"use client";

import { useState } from "react";
import { Lock, Key, Users } from "lucide-react";
import type { ConversationMember } from "@euromex/shared";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface Props {
  file: File;
  members: ConversationMember[];
  currentUserId: string;
  onConfirm: (opts: { downloadPin?: string; allowedUserIds?: string[] }) => void;
  onCancel: () => void;
}

export function AttachmentOptionsModal({ file, members, currentUserId, onConfirm, onCancel }: Props) {
  const [accessMode, setAccessMode] = useState<"all" | "restricted">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pin, setPin] = useState("");
  const [usePin, setUsePin] = useState(false);

  // Miembros excepto el propio remitente
  const others = members.filter((m) => m.userId !== currentUserId);

  function toggleMember(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleConfirm() {
    const opts: { downloadPin?: string; allowedUserIds?: string[] } = {};
    if (usePin && pin.trim()) opts.downloadPin = pin.trim();
    if (accessMode === "restricted" && selectedIds.size > 0) {
      // Incluir el remitente siempre en la lista de permitidos.
      opts.allowedUserIds = [currentUserId, ...Array.from(selectedIds)];
    }
    onConfirm(opts);
  }

  const canConfirm = accessMode === "all" || selectedIds.size > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-xl">
        {/* Header */}
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold">Opciones de envío</h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {file.name}
          </p>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* Access control */}
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Users className="size-3.5" />
              ¿Quién puede descargar este archivo?
            </div>
            <div className="space-y-1.5">
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-secondary/50 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
                <input
                  type="radio"
                  name="access"
                  value="all"
                  checked={accessMode === "all"}
                  onChange={() => setAccessMode("all")}
                  className="accent-[hsl(var(--primary))]"
                />
                <span>Todos los miembros</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-secondary/50 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
                <input
                  type="radio"
                  name="access"
                  value="restricted"
                  checked={accessMode === "restricted"}
                  onChange={() => setAccessMode("restricted")}
                  className="accent-[hsl(var(--primary))]"
                />
                <span className="flex items-center gap-1.5">
                  <Lock className="size-3.5 text-amber-400" />
                  Solo personas seleccionadas
                </span>
              </label>
            </div>

            {accessMode === "restricted" && (
              <div className="mt-2 max-h-36 overflow-y-auto rounded-lg border border-border bg-background p-1">
                {others.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-muted-foreground">
                    No hay otros miembros.
                  </p>
                ) : (
                  others.map((m) => (
                    <label
                      key={m.userId}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-xs hover:bg-secondary/50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(m.userId)}
                        onChange={() => toggleMember(m.userId)}
                        className="accent-[hsl(var(--primary))]"
                      />
                      <span className="font-medium">{m.displayName}</span>
                      <span className="text-muted-foreground">@{m.username}</span>
                    </label>
                  ))
                )}
              </div>
            )}
          </div>

          {/* PIN opcional */}
          <div>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-secondary/50 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
              <input
                type="checkbox"
                checked={usePin}
                onChange={(e) => setUsePin(e.target.checked)}
                className="accent-[hsl(var(--primary))]"
              />
              <Key className="size-3.5 text-blue-400" />
              <span>Requerir PIN para descargar</span>
            </label>
            {usePin && (
              <Input
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Escribe un PIN…"
                type="password"
                className="mt-2 h-9 text-sm"
                autoFocus
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={!canConfirm}>
            Enviar
          </Button>
        </div>
      </div>
    </div>
  );
}
