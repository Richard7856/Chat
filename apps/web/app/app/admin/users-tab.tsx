"use client";

import { useCallback, useEffect, useState } from "react";
import {
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type {
  AdminUserListItem,
  AdminUserUpdateRequest,
} from "@euromex/shared";
import { api } from "../../lib/api";
import { isBiometricAvailable, verifyBiometric } from "../../lib/biometric";
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
import { ResetPasswordModal } from "./reset-password-modal";
import { UserDevicesModal } from "./user-devices-modal";
import { UserPermissionsModal } from "./user-permissions-modal";

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

  // --- estado del modal de dispositivos (revocar por sospecha de robo, etc.) ---
  const [devicesTarget, setDevicesTarget] = useState<AdminUserListItem | null>(null);
  // --- estado del modal de permisos granulares (Fase 24) ---
  const [permsTarget, setPermsTarget] = useState<AdminUserListItem | null>(null);
  // --- estado del modal de reset de password (Fase 30) ---
  const [resetTarget, setResetTarget] = useState<AdminUserListItem | null>(null);

  // --- estado del modal de edición de perfil ---
  const [editTarget, setEditTarget] = useState<AdminUserListItem | null>(null);
  const [editDraft, setEditDraft] = useState({
    displayName: "",
    email: "",
    jobTitle: "",
    department: "",
    managerUserId: "" as string, // "" = sin manager (null en DB)
  });
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
   *  No se usa para displayName/email — esos van por saveEdit().
   *
   *  Fase 27: cambios de rol o de status (active ↔ disabled) son acciones
   *  destructivas → step-up biométrico en mobile antes de pegar al server.
   *  El check de admin role lo sigue haciendo el server. */
  async function patch(userId: string, payload: AdminUserUpdateRequest) {
    onError(null);
    const sensitive =
      "role" in payload || "status" in payload;
    if (sensitive && (await isBiometricAvailable())) {
      const target = users.find((u) => u.id === userId);
      const reason =
        "status" in payload
          ? `${payload.status === "disabled" ? "Deshabilitar" : "Activar"} a ${target?.displayName ?? "usuario"}`
          : `Cambiar rol de ${target?.displayName ?? "usuario"}`;
      const ok = await verifyBiometric(reason);
      if (!ok) {
        onError("Confirmación biométrica cancelada.");
        return;
      }
    }
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
    setEditDraft({
      displayName: user.displayName,
      email: user.email ?? "",
      jobTitle: user.jobTitle ?? "",
      department: user.department ?? "",
      managerUserId: user.managerUserId ?? "",
    });
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

    const newJobTitle = editDraft.jobTitle.trim() || null;
    const newDepartment = editDraft.department.trim() || null;
    const newManagerId = editDraft.managerUserId || null;

    if (newJobTitle !== editTarget.jobTitle) p.jobTitle = newJobTitle;
    if (newDepartment !== editTarget.department) p.department = newDepartment;
    if (newManagerId !== editTarget.managerUserId) p.managerUserId = newManagerId;

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
      const code = err instanceof Error ? err.message : "update_failed";
      const humanized: Record<string, string> = {
        self_manager: "Un usuario no puede ser su propio jefe.",
        last_active_admin: "No es posible: quedaría el sistema sin administradores.",
      };
      setEditError(humanized[code] ?? `Error: ${code}`);
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
      {/* Modal de gestión de dispositivos (revocar por seguridad)            */}
      {/* ------------------------------------------------------------------ */}
      <UserDevicesModal
        user={
          devicesTarget
            ? {
                id: devicesTarget.id,
                displayName: devicesTarget.displayName,
                username: devicesTarget.username,
              }
            : null
        }
        onClose={() => setDevicesTarget(null)}
        onRevoked={() => void refresh()}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Modal de permisos granulares (Fase 24)                              */}
      {/* ------------------------------------------------------------------ */}
      <UserPermissionsModal
        user={permsTarget}
        onClose={() => setPermsTarget(null)}
        onSaved={() => void refresh()}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Modal de reset de password (Fase 30)                                */}
      {/* ------------------------------------------------------------------ */}
      <ResetPasswordModal
        user={resetTarget}
        onClose={() => {
          setResetTarget(null);
          // Refresh para que se vea el reflejo del revoked devices count
          void refresh();
        }}
      />

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

            <div className="grid gap-1.5">
              <Label htmlFor="edit-job-title">
                Cargo{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  (opcional)
                </span>
              </Label>
              <Input
                id="edit-job-title"
                value={editDraft.jobTitle}
                onChange={(e) =>
                  setEditDraft((d) => ({ ...d, jobTitle: e.target.value }))
                }
                placeholder="Gerente de Ventas"
                maxLength={80}
                autoComplete="off"
                disabled={editSaving}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="edit-department">
                Departamento{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  (opcional)
                </span>
              </Label>
              <Input
                id="edit-department"
                value={editDraft.department}
                onChange={(e) =>
                  setEditDraft((d) => ({ ...d, department: e.target.value }))
                }
                placeholder="Ventas"
                maxLength={80}
                autoComplete="off"
                disabled={editSaving}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="edit-manager">Jefe directo</Label>
              <select
                id="edit-manager"
                value={editDraft.managerUserId}
                onChange={(e) =>
                  setEditDraft((d) => ({ ...d, managerUserId: e.target.value }))
                }
                disabled={editSaving}
                className="flex h-10 w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">— Sin jefe directo —</option>
                {users
                  .filter((u) => u.id !== editTarget?.id && u.status === "active")
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName} (@{u.username})
                    </option>
                  ))}
              </select>
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
                          {(u.jobTitle || u.department) && (
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              {u.department && (
                                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                  {u.department}
                                </span>
                              )}
                              {u.jobTitle && (
                                <span className="text-[10px] text-muted-foreground/70">
                                  {u.jobTitle}
                                </span>
                              )}
                            </div>
                          )}
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

                    {/* --- Dispositivos activos (clickable: abre modal de gestión) --- */}
                    <td className="px-4 py-3 text-center tabular-nums">
                      <button
                        type="button"
                        onClick={() => setDevicesTarget(u)}
                        title="Ver y revocar dispositivos"
                        className={[
                          "inline-flex min-w-[2rem] items-center justify-center rounded-md px-2 py-0.5 text-sm font-medium transition-colors",
                          u.activeDevicesCount > 0
                            ? "text-foreground hover:bg-muted hover:text-primary"
                            : "text-muted-foreground hover:bg-muted",
                        ].join(" ")}
                      >
                        {u.activeDevicesCount}
                      </button>
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

                    {/* --- Botones de acción (perfil + permisos + reset) --- */}
                    <td className="px-2 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setPermsTarget(u)}
                          disabled={saving}
                          title="Permisos granulares (descarga, screenshots, etc.)"
                          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-primary disabled:opacity-50"
                        >
                          <Lock className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setResetTarget(u)}
                          disabled={saving || isMe}
                          title={
                            isMe
                              ? "Usa Settings → Cambiar contraseña para resetear la tuya"
                              : "Restablecer contraseña (revoca sesiones del usuario)"
                          }
                          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-amber-600 disabled:opacity-50"
                        >
                          <KeyRound className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(u)}
                          disabled={saving}
                          title="Editar nombre y email"
                          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                      </div>
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
