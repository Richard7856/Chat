"use client";

import { useEffect, useState } from "react";
import { Loader2, MessageSquare, Search, Users } from "lucide-react";
import type { Conversation, UserListItem } from "@euromex/shared";
import { api } from "../../lib/api";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Avatar } from "../../components/ui/avatar";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";

type ConvType = "dm" | "group";

export function NewConversationDialog({
  open,
  onOpenChange,
  currentUserId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentUserId: string;
  onCreated: (convId: string) => void;
}) {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [type, setType] = useState<ConvType>("dm");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset al abrir/cerrar
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setQuery("");
    setSelected(new Set());
    setType("dm");
    setName("");
    api<{ users: UserListItem[] }>("/users", { method: "GET", auth: true })
      .then((r) => setUsers(r.users))
      .catch((e) => setErr(e instanceof Error ? e.message : "error"));
  }, [open]);

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) {
        n.delete(id);
      } else {
        if (type === "dm") n.clear();
        n.add(id);
      }
      return n;
    });
  }

  async function onCreate() {
    setErr(null);
    setBusy(true);
    try {
      if (type === "dm" && selected.size !== 1) {
        throw new Error("Selecciona un usuario para iniciar el DM");
      }
      if (type === "group" && !name.trim()) {
        throw new Error("El grupo necesita un nombre");
      }
      if (selected.size === 0) {
        throw new Error("Selecciona al menos un miembro");
      }
      const res = await api<Conversation>("/conversations", {
        auth: true,
        body: {
          type,
          name: type === "group" ? name.trim() : undefined,
          memberUserIds: Array.from(selected),
        },
      });
      onCreated(res.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  const filtered = users
    .filter((u) => u.id !== currentUserId)
    .filter((u) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        u.username.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q)
      );
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva conversación</DialogTitle>
          <DialogDescription>
            Inicia un chat directo con un colega o crea un grupo por tema.
          </DialogDescription>
        </DialogHeader>

        {/* Tabs tipo pill */}
        <div className="flex rounded-lg border border-border bg-background p-1">
          <TabBtn
            active={type === "dm"}
            onClick={() => {
              setType("dm");
              setSelected(new Set());
            }}
            icon={<MessageSquare className="size-4" />}
            label="Directo"
          />
          <TabBtn
            active={type === "group"}
            onClick={() => setType("group")}
            icon={<Users className="size-4" />}
            label="Grupo"
          />
        </div>

        {type === "group" && (
          <div className="space-y-1.5">
            <Label htmlFor="group-name">Nombre del grupo</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contabilidad, Proyectos Q2…"
              maxLength={80}
              disabled={busy}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="user-search">
            {type === "dm" ? "Con quién quieres hablar" : "Miembros"}
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="user-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre o @usuario…"
              disabled={busy}
              className="pl-9"
            />
          </div>
        </div>

        <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-border bg-background/50 p-1">
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {users.length === 0
                ? "Aún no hay otros usuarios. Emite invitaciones desde /app/admin."
                : "Ningún usuario coincide con tu búsqueda."}
            </p>
          )}
          {filtered.map((u) => {
            const isSelected = selected.has(u.id);
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => toggle(u.id)}
                className={[
                  "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors",
                  isSelected
                    ? "bg-primary/15 ring-1 ring-primary/30"
                    : "hover:bg-secondary",
                ].join(" ")}
              >
                <Avatar
                  size="sm"
                  username={u.username}
                  displayName={u.displayName}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {u.displayName}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    @{u.username}
                  </div>
                </div>
                {isSelected && (
                  <span className="shrink-0 text-xs font-semibold text-primary">
                    {type === "dm" ? "✓" : "añadido"}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {err && (
          <Alert variant="destructive">
            <AlertDescription>{err}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={onCreate} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Creando…
              </>
            ) : (
              "Crear"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}
