"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AdminAuditLogItem,
  AdminInvitationItem,
  AdminUserListItem,
  AdminUserUpdateRequest,
  CreateInvitationResponse,
} from "@euromex/shared";
import { api, clearSession, loadSession } from "../../lib/api";

type Tab = "users" | "invitations" | "audit";

interface MeResponse {
  user: {
    id: string;
    username: string;
    displayName: string;
    role: "user" | "admin";
  };
}

export default function AdminPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tab, setTab] = useState<Tab>("users");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!loadSession()) {
      router.replace("/login");
      return;
    }
    api<MeResponse>("/auth/me", { method: "GET", auth: true })
      .then((res) => {
        if (res.user.role !== "admin") {
          router.replace("/app");
          return;
        }
        setMe(res);
      })
      .catch(() => {
        clearSession();
        router.replace("/login");
      })
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <main className="shell">
        <p className="tagline">Cargando panel admin…</p>
      </main>
    );
  }
  if (!me) return null;

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <h1>Panel admin</h1>
          <p className="muted">
            Sesión: <strong>{me.user.displayName}</strong> · @{me.user.username} · {me.user.role}
          </p>
        </div>
        <nav className="admin-tabs">
          <button
            type="button"
            className={tab === "users" ? "active" : ""}
            onClick={() => setTab("users")}
          >
            Usuarios
          </button>
          <button
            type="button"
            className={tab === "invitations" ? "active" : ""}
            onClick={() => setTab("invitations")}
          >
            Invitaciones
          </button>
          <button
            type="button"
            className={tab === "audit" ? "active" : ""}
            onClick={() => setTab("audit")}
          >
            Audit log
          </button>
          <a className="admin-back" href="/app/chat">
            ← Chat
          </a>
        </nav>
      </header>

      {error && <p className="error">Error: {error}</p>}

      <section className="admin-main">
        {tab === "users" && <UsersTab meId={me.user.id} onError={setError} />}
        {tab === "invitations" && <InvitationsTab onError={setError} />}
        {tab === "audit" && <AuditTab onError={setError} />}
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Users tab
// ---------------------------------------------------------------------------

function UsersTab({
  meId,
  onError,
}: {
  meId: string;
  onError: (e: string | null) => void;
}) {
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null); // userId siendo editado

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ users: AdminUserListItem[] }>("/admin/users", {
        method: "GET",
        auth: true,
      });
      setUsers(r.users);
    } catch (err) {
      onError(err instanceof Error ? err.message : "load_failed");
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

  function formatWhen(iso: string | null): string {
    if (!iso) return "—";
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const h = Math.floor(diffMs / 3_600_000);
    if (h < 1) return "recién";
    if (h < 24) return `hace ${h}h`;
    const days = Math.floor(h / 24);
    if (days < 30) return `hace ${days}d`;
    return d.toLocaleDateString();
  }

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Usuario</th>
            <th>Rol</th>
            <th title="Recibe avisos de seguridad (descargas, etc.)">Alertas</th>
            <th>Estado</th>
            <th>Dispositivos</th>
            <th>Último acceso</th>
            <th>Alta</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const isMe = u.id === meId;
            const saving = busy === u.id;
            return (
              <tr key={u.id} className={saving ? "saving" : ""}>
                <td>
                  <strong>{u.displayName}</strong>
                  <br />
                  <span className="muted">@{u.username}</span>
                  {u.email && (
                    <>
                      <br />
                      <span className="muted">{u.email}</span>
                    </>
                  )}
                </td>
                <td>
                  <select
                    value={u.role}
                    disabled={saving || isMe}
                    onChange={(e) =>
                      patch(u.id, { role: e.target.value as "user" | "admin" })
                    }
                    title={isMe ? "No puedes cambiar tu propio rol" : undefined}
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td className="center">
                  <input
                    type="checkbox"
                    checked={u.receivesSecurityAlerts}
                    disabled={saving}
                    onChange={(e) =>
                      patch(u.id, { receivesSecurityAlerts: e.target.checked })
                    }
                  />
                </td>
                <td>
                  <select
                    value={u.status}
                    disabled={saving || isMe}
                    onChange={(e) =>
                      patch(u.id, {
                        status: e.target.value as "active" | "disabled",
                      })
                    }
                    title={isMe ? "No puedes deshabilitarte" : undefined}
                  >
                    <option value="active">active</option>
                    <option value="disabled">disabled</option>
                  </select>
                </td>
                <td className="center">{u.activeDevicesCount}</td>
                <td>{formatWhen(u.lastSeenAt)}</td>
                <td className="muted">
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invitations tab
// ---------------------------------------------------------------------------

function InvitationsTab({ onError }: { onError: (e: string | null) => void }) {
  const [items, setItems] = useState<AdminInvitationItem[]>([]);
  const [intendedFor, setIntendedFor] = useState("");
  const [newRole, setNewRole] = useState<"user" | "admin">("user");
  const [ttl, setTtl] = useState(24);
  const [busy, setBusy] = useState(false);
  const [lastCode, setLastCode] = useState<CreateInvitationResponse | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ invitations: AdminInvitationItem[] }>(
        "/admin/invitations",
        { method: "GET", auth: true },
      );
      setItems(r.invitations);
    } catch (err) {
      onError(err instanceof Error ? err.message : "load_failed");
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
    if (!confirm("¿Revocar esta invitación? El código deja de funcionar.")) return;
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

  function statusOf(inv: AdminInvitationItem): string {
    if (inv.usedAt) return `✅ usada por @${inv.usedByUsername ?? "?"}`;
    if (new Date(inv.expiresAt) < new Date()) return "⏰ expirada";
    return "🔓 activa";
  }

  return (
    <>
      <div className="admin-form-row">
        <label>
          <span>Etiqueta (opcional)</span>
          <input
            value={intendedFor}
            onChange={(e) => setIntendedFor(e.target.value)}
            placeholder="ej. contabilidad-maria"
          />
        </label>
        <label>
          <span>Rol</span>
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as "user" | "admin")}
          >
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <label>
          <span>Expira en (hrs)</span>
          <input
            type="number"
            min={1}
            max={168}
            value={ttl}
            onChange={(e) => setTtl(Number(e.target.value))}
          />
        </label>
        <button type="button" onClick={create} disabled={busy}>
          {busy ? "Creando…" : "Crear invitación"}
        </button>
      </div>

      {lastCode && (
        <div className="invite-card">
          <p>Código nuevo (cópialo ahora, solo lo ves una vez):</p>
          <code className="code-big">{lastCode.code}</code>
          <p className="hint">
            Link: <code>/enroll?code={lastCode.code}</code>
            <br />
            Expira: {new Date(lastCode.expiresAt).toLocaleString()}
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => setLastCode(null)}
          >
            Ocultar
          </button>
        </div>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Etiqueta</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Expira</th>
              <th>Creada por</th>
              <th>Creada</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((inv) => {
              const canRevoke = !inv.usedAt && new Date(inv.expiresAt) > new Date();
              return (
                <tr key={inv.id}>
                  <td>{inv.intendedFor ?? "—"}</td>
                  <td>{inv.role}</td>
                  <td>{statusOf(inv)}</td>
                  <td className="muted">
                    {new Date(inv.expiresAt).toLocaleString()}
                  </td>
                  <td>@{inv.createdByUsername}</td>
                  <td className="muted">
                    {new Date(inv.createdAt).toLocaleString()}
                  </td>
                  <td>
                    {canRevoke && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => revoke(inv.id)}
                      >
                        Revocar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Audit log tab
// ---------------------------------------------------------------------------

function AuditTab({ onError }: { onError: (e: string | null) => void }) {
  const [entries, setEntries] = useState<AdminAuditLogItem[]>([]);
  const [actionFilter, setActionFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: "200" });
      if (actionFilter) qs.set("action", actionFilter);
      const r = await api<{ entries: AdminAuditLogItem[] }>(
        `/admin/audit-log?${qs.toString()}`,
        { method: "GET", auth: true },
      );
      setEntries(r.entries);
    } catch (err) {
      onError(err instanceof Error ? err.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [actionFilter, onError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const commonActions = [
    "",
    "login.success",
    "login.failed",
    "login.totp_failed",
    "enroll.complete",
    "invitation.create",
    "admin.user.update",
    "admin.device.revoke",
    "admin.invitation.revoke",
    "attachment.downloaded",
    "password.reset",
    "logout",
  ];

  return (
    <>
      <div className="admin-form-row">
        <label>
          <span>Filtrar por acción</span>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          >
            {commonActions.map((a) => (
              <option key={a} value={a}>
                {a || "(todas)"}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={refresh} disabled={loading}>
          {loading ? "Cargando…" : "Refrescar"}
        </button>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table audit-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Usuario</th>
              <th>Acción</th>
              <th>Metadata</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="muted" title={e.createdAt}>
                  {new Date(e.createdAt).toLocaleString()}
                </td>
                <td>{e.username ? `@${e.username}` : "—"}</td>
                <td>
                  <code>{e.action}</code>
                </td>
                <td className="audit-meta">
                  <code>{JSON.stringify(e.metadata)}</code>
                </td>
                <td className="muted">{e.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
