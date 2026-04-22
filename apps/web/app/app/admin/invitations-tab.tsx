"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, Plus, X } from "lucide-react";
import type {
  AdminInvitationItem,
  CreateInvitationResponse,
} from "@euromex/shared";
import { api } from "../../lib/api";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { formatFull, formatRelative } from "./admin-utils";

export function InvitationsTab({
  onError,
}: {
  onError: (e: string | null) => void;
}) {
  const [items, setItems] = useState<AdminInvitationItem[]>([]);
  const [intendedFor, setIntendedFor] = useState("");
  const [newRole, setNewRole] = useState<"user" | "admin">("user");
  const [ttl, setTtl] = useState(24);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastCode, setLastCode] = useState<CreateInvitationResponse | null>(
    null,
  );
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ invitations: AdminInvitationItem[] }>(
        "/admin/invitations",
        { method: "GET", auth: true },
      );
      setItems(r.invitations);
    } catch (err) {
      onError(err instanceof Error ? err.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function create() {
    onError(null);
    setBusy(true);
    try {
      const res = await api<CreateInvitationResponse>("/auth/invitations", {
        auth: true,
        body: {
          intendedFor: intendedFor || undefined,
          role: newRole,
          ttlHours: ttl,
        },
      });
      setLastCode(res);
      setIntendedFor("");
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "create_failed");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("¿Revocar esta invitación? El código deja de funcionar."))
      return;
    onError(null);
    try {
      await api(`/admin/invitations/${id}`, {
        method: "DELETE",
        auth: true,
      });
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "revoke_failed");
    }
  }

  function copy(text: string, which: "code" | "link") {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  function statusBadge(inv: AdminInvitationItem) {
    if (inv.usedAt) {
      return (
        <Badge variant="success">usada por @{inv.usedByUsername ?? "?"}</Badge>
      );
    }
    if (new Date(inv.expiresAt) < new Date()) {
      return <Badge variant="secondary">expirada</Badge>;
    }
    return <Badge>activa</Badge>;
  }

  const enrollOrigin =
    typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="space-y-6">
      {/* Form crear invitación */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Plus className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Nueva invitación</h2>
            <p className="text-xs text-muted-foreground">
              Genera un código de un solo uso para dar de alta a un colega.
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_120px_140px_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="inv-intended">Etiqueta (opcional)</Label>
            <Input
              id="inv-intended"
              value={intendedFor}
              onChange={(e) => setIntendedFor(e.target.value)}
              placeholder="ej. contabilidad-maria"
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-role">Rol</Label>
            <select
              id="inv-role"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "user" | "admin")}
              disabled={busy}
              className="flex h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-ttl">Expira (hrs)</Label>
            <Input
              id="inv-ttl"
              type="number"
              min={1}
              max={168}
              value={ttl}
              onChange={(e) => setTtl(Number(e.target.value))}
              disabled={busy}
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              onClick={create}
              disabled={busy}
              className="w-full md:w-auto"
            >
              {busy ? (
                <>
                  <Loader2 className="animate-spin" />
                  Creando…
                </>
              ) : (
                <>
                  <Plus />
                  Crear
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Código recién creado */}
      {lastCode && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 shadow-sm">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Código generado — cópialo ahora
              </p>
              <p className="text-xs text-muted-foreground">
                Por seguridad, solo se muestra una vez. Expira{" "}
                {formatFull(lastCode.expiresAt)}.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setLastCode(null)}
            >
              <X />
            </Button>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-border bg-background px-3 py-2 font-mono text-lg tracking-wider">
                {lastCode.code}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copy(lastCode.code, "code")}
              >
                {copied === "code" ? <Check /> : <Copy />}
                {copied === "code" ? "Copiado" : "Copiar"}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-muted-foreground">
                {enrollOrigin}/enroll?code={lastCode.code}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  copy(`${enrollOrigin}/enroll?code=${lastCode.code}`, "link")
                }
              >
                {copied === "link" ? <Check /> : <Link2 />}
                {copied === "link" ? "Copiado" : "Link"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Tabla de invitaciones */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Etiqueta</th>
                <th className="px-4 py-3 text-left font-semibold">Rol</th>
                <th className="px-4 py-3 text-left font-semibold">Estado</th>
                <th className="px-4 py-3 text-left font-semibold">Expira</th>
                <th className="px-4 py-3 text-left font-semibold">
                  Creada por
                </th>
                <th className="px-4 py-3 text-left font-semibold">Creada</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    <Loader2 className="mx-auto size-4 animate-spin" />
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-sm text-muted-foreground"
                  >
                    Aún no has emitido invitaciones.
                  </td>
                </tr>
              ) : (
                items.map((inv) => {
                  const canRevoke =
                    !inv.usedAt && new Date(inv.expiresAt) > new Date();
                  return (
                    <tr
                      key={inv.id}
                      className="transition-colors hover:bg-muted/30"
                    >
                      <td className="px-4 py-3 font-medium">
                        {inv.intendedFor ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            inv.role === "admin" ? "default" : "outline"
                          }
                        >
                          {inv.role}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">{statusBadge(inv)}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatRelative(inv.expiresAt)}
                      </td>
                      <td className="px-4 py-3">@{inv.createdByUsername}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatRelative(inv.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canRevoke && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => revoke(inv.id)}
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          >
                            Revocar
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
