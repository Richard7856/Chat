"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import type {
  AdminUserListItem,
  AdminUserUpdateRequest,
} from "@euromex/shared";
import { api } from "../../lib/api";
import { Avatar } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span className="ml-2 text-sm">Cargando usuarios…</span>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-sm">
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
              <th className="px-4 py-3 text-center font-semibold">Dispos.</th>
              <th className="px-4 py-3 text-left font-semibold">Último acceso</th>
              <th className="px-4 py-3 text-left font-semibold">Alta</th>
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
                            <Badge variant="outline" className="text-[10px]">
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
                  <td className="px-4 py-3">
                    <select
                      value={u.status}
                      disabled={saving || isMe}
                      onChange={(e) =>
                        patch(u.id, {
                          status: e.target.value as "active" | "disabled",
                        })
                      }
                      title={isMe ? "No puedes deshabilitarte" : undefined}
                      className="h-8 rounded-md border border-border bg-background px-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                    >
                      <option value="active">active</option>
                      <option value="disabled">disabled</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {u.activeDevicesCount}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatRelative(u.lastSeenAt)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(u.createdAt).toLocaleDateString("es-MX", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr>
                <td
                  colSpan={7}
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
  );
}
