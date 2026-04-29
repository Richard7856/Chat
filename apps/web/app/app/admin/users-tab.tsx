"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, ShieldAlert, ShieldCheck } from "lucide-react";
import type {
  AdminUserListItem,
  AdminUserUpdateRequest,
} from "@euromex/shared";
import { api } from "../../lib/api";
import { Avatar } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { formatRelative } from "./admin-utils";

export function UsersTab({
  meId,
  onError,
}: {
  meId: string;
  onError: (e: string | null) => void;
}) {
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // --- estado del modal de edición de perfil ---
  const [editTarget, setEditTarget] = useState<AdminUserListItem | null>(null);
  const [editDraft, setEditDraft] = useState({ displayName: "", email: "" });
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ users: AdminUserListItem[] }>("/admin/users", {
        method: "GET",
        auth: true,
      });
      setUsers(r.users);
    } catch (err) {
      onError(err instanceof Error ? err.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Aplica un patch parcial a un usuario (rol, status, alertas, etc.).
   *  No se usa para displayName/email — esos van por saveEdit(). */
  async function patch(userId: string, payload: AdminUserUpdateRequest) {
    onError(null);
    setBusy(userId);
    try {
      const updated = await api<AdminUserListItem>(`/admin/users/${userId}`, {
        method: "PATCH",
        auth: true,
        body: payload,
      });
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
    } catch (err) {
      onError(err instanceof Error ? err.message : "update_failed");
    } finally {
      setBusy(null);
    }
  }

  /** Abre el modal precargado con los datos actuales del usuario. */
  function openEdit(user: AdminUserListItem) {
    setEditTarget(user);
    setEditDraft({ displayName: user.displayName, email: user.email ?? "" });
    setEditError(null);
  }

  /** Guarda solo los campos que realmente cambiaron.
   *  Si nada cambió, cierra sin llamar al servidor. */
  async function saveEdit() {
    if (!editTarget) return;

    const trimmedName = editDraft.displayName.trim();
    // Email vacío se convierte en null (borrar email del usuario)
    const newEmail: string | null = editDraft.email.trim() || null;

    // Validación en cliente — refleja las restricciones del schema Zod del server
    if (trimmedName.length === 0) {
      setEditError("El nombre no puede estar vacío.");
      return;
    }
    if (trimmedName.length > 64) {
      setEditError("El nombre no puede superar 64 caracteres.");
      return;
    }
    if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      setEditError("Dirección de email inválida.");
      return;
    }

    // Construir patch con solo los campos que cambiaron
    const p: AdminUserUpdateRequest = {};
    if (trimmedName !== editTarget.displayName) p.displayName = trimmedName;
    if (newEmail !== editTarget.email) p.email = newEmail;

    if (Object.keys(p).length === 0) {
      // Nada cambió — cerrar sin llamar al servidor
      setEditTarget(null);
      return;
    }

    setEditError(null);
    setEditSaving(true);
    try {
      const updated = await api<AdminUserListItem>(
        `/admin/users/${editTarget.id}`,
        { method: "PATCH", auth: true, body: p },
      );
      setUsers((prev) =>
        prev.map((u) => (u.id === editTarget.id ? updated : u)),
      );
      setEditTarget(null);
    } catch (err) {
      // Error queda visible dentro del modal para que el admin pueda corregir
      setEditError(err instanceof Error ? err.message : "update_failed");
    } finally {
      setEditSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span className="ml-2 text-sm">Cargando usuarios…</span>
      </div>
    );
  }

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Modal de edición de displayName + email                             */}
      {/* ------------------------------------------------------------------ */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          // Evitar cerrar mientras se guarda; si se abre, no hacer nada extra
          if (!open && !editSaving) setEditTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Editar perfil —{" "}
              <span className="font-normal text-muted-foreground">
                @{editTarget?.username}
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-display-name">Nombre visible</Label>
              <Input
                id="edit-display-name"
                value={editDraft.displayName}
                onChange={(e) =>
                  setEditDraft((d) => ({ ...d, displayName: e.target.value }))
                }
                maxLength={64}
                autoComplete="off"
                aria-invalid={
                  editError?.toLowerCase().includes("nombre") ? true : undefined
                }
                disabled={editSaving}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="edit-email">
                Email{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  (opcional)
                </span>
              </Label>
              <Input
                id="edit-email"
                type="email"
                value={editDraft.email}
                onChange={(e) =>
                  setEditDraft((d) => ({ ...d, email: e.target.value }))
                }
                placeholder="correo@empresa.com"
                autoComplete="off"
                aria-invalid={
                  editError?.toLowerCase().includes("email") ? true : undefined
                }
                disabled={editSaving}
              />
              <p className="text-xs text-muted-foreground">
                Deja vacío para eliminar el email del usuario.
              </p>
            </div>

            {editError && (
              <p className="text-sm text-destructive">{editError}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setEditTarget(null)}
              disabled={editSaving}
            >
              Cancelar
            </Button>
            <Button onClick={saveEdit} disabled={editSaving}>
              {editSaving && <Loader2 className="animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* Tabla de usuarios                                                   */}
      {/* ------------------------------------------------------------------ */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Usuario</th>
                <th className="px-4 py-3 text-left font-semibold">Rol</th>
                <th
                  className="px-4 py-3 text-center font-semibold"
                  title="Recibe avisos de seguridad"
                >
                  Alertas
                </th>
                <th className="px-4 py-3 text-left font-semibold">Estado</th>
                <th className="px-4 py-3 text-center font-semibold">
                  Dispos.
                </th>
                <th className="px-4 py-3 text-left font-semibold">
                  Último acceso
                </th>
                <th className="px-4 py-3 text-left font-semibold">Alta</th>
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => {
                const isMe = u.id === meId;
                const saving = busy === u.id;
                return (
                  <tr
                    key={u.id}
                    className={[
                      "transition-colors",
                      saving ? "opacity-60" : "hover:bg-muted/30",
                    ].join(" ")}
                  >
                    {/* --- Usuario --- */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar
                          size="sm"
                          username={u.username}
                          displayName={u.displayName}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{u.displayName}</span>
                            {isMe && (
                              <Badge
                                variant="outline"
                                className="text-[10px]"
                              >
                                tú
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            @{u.username}
                            {u.email ? ` · ${u.email}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* --- Rol --- */}
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        disabled={saving || isMe}
                        onChange={(e) =>
                          patch(u.id, {
                            role: e.target.value as "user" | "admin",
                          })
                        }
                        title={
                          isMe ? "No puedes cambiar tu propio rol" : undefined
                        }
                        className="h-8 rounded-md border border-border bg-background px-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                      >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>

                    {/* --- Alertas de seguridad --- */}
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() =>
                          patch(u.id, {
                            receivesSecurityAlerts: !u.receivesSecurityAlerts,
                          })
                        }
                        disabled={saving}
                        title={
                          u.receivesSecurityAlerts
                            ? "Recibe alertas (click para desactivar)"
                            : "No recibe alertas (click para activar)"
                        }
                        className={[
                          "inline-flex size-7 items-center justify-center rounded-md transition-colors",
                          u.receivesSecurityAlerts
                            ? "bg-primary/15 text-primary hover:bg-primary/25"
                            : "bg-muted text-muted-foreground hover:bg-muted/80",
                          saving ? "opacity-50" : "",
                        ].join(" ")}
                      >
                        {u.receivesSecurityAlerts ? (
                          <ShieldCheck className="size-4" />
                        ) : (
                          <ShieldAlert className="size-4" />
                        )}
                      </button>
                    </td>

                    {/* --- Estado --- */}
                    <td className="px-4 py-3">
                      <select
                        value={u.status}
                        disabled={saving || isMe}
                        onChange={(e) =>
                          patch(u.id, {
                            status: e.target.value as "active" | "disabled",
                          })
                        }
                        title={
                          isMe ? "No puedes deshabilitarte" : undefined
                        }
                        className="h-8 rounded-md border border-border bg-background px-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                      >
                        <option value="active">active</option>
                        <option value="disabled">disabled</option>
                      </select>
                    </td>

                    {/* --- Dispositivos activos --- */}
                    <td className="px-4 py-3 text-center tabular-nums">
                      {u.activeDevicesCount}
                    </td>

                    {/* --- Último acceso --- */}
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatRelative(u.lastSeenAt)}
                    </td>

                    {/* --- Fecha de alta --- */}
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(u.createdAt).toLocaleDateString("es-MX", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>

                    {/* --- Botón editar perfil --- */}
                    <td className="px-2 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(u)}
                        disabled={saving}
                        title="Editar nombre y email"
                        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}

              {users.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-10 text-center text-sm text-muted-foreground"
                  >
                    No hay usuarios registrados aún.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
