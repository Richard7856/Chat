"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, clearSession, loadSession } from "../lib/api";

interface MeResponse {
  user: {
    id: string;
    username: string;
    displayName: string;
    email: string | null;
    role: "user" | "admin";
  };
  device: {
    id: string;
    deviceName: string;
    platform: "web" | "ios" | "android" | "desktop";
    lastSeenAt: string | null;
  };
}

interface CreatedInvitation {
  code: string;
  expiresAt: string;
}

export default function AppHome() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loadSession()) {
      router.replace("/login");
      return;
    }
    api<MeResponse>("/auth/me", { method: "GET", auth: true })
      .then(setMe)
      .catch((err) => {
        setError(err instanceof Error ? err.message : "error");
        clearSession();
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function onLogout() {
    try {
      await api("/auth/logout", { method: "POST", auth: true });
    } catch {}
    clearSession();
    router.replace("/login");
  }

  if (loading) {
    return (
      <main className="shell">
        <p className="tagline">Cargando sesión…</p>
      </main>
    );
  }

  if (error || !me) {
    return (
      <main className="shell">
        <h1>Sesión inválida</h1>
        <p className="error">{error ?? "no autenticado"}</p>
        <a href="/login">Volver a iniciar sesión</a>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="brand" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <h1>Hola, {me.user.displayName}</h1>
          <p className="tagline">
            @{me.user.username} · {me.user.role}
          </p>
        </div>
        <button type="button" onClick={onLogout} className="secondary">
          Cerrar sesión
        </button>
      </header>

      <section className="status">
        <h2>Sesión activa</h2>
        <p>
          Dispositivo: <strong>{me.device.deviceName}</strong> ({me.device.platform})
        </p>
        <p>
          Último acceso:{" "}
          {me.device.lastSeenAt
            ? new Date(me.device.lastSeenAt).toLocaleString()
            : "ahora"}
        </p>
      </section>

      {me.user.role === "admin" && <AdminPanel />}

      <section className="status">
        <h2>Mensajería</h2>
        <p>
          Mensajería en tiempo real disponible (Fase 3 — texto plano sobre
          WebSockets). El cifrado E2EE con Signal Protocol llega en Fase 4.
        </p>
        <p>
          <a href="/app/chat" className="cta">
            Abrir chat →
          </a>
        </p>
      </section>
    </main>
  );
}

function AdminPanel() {
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [intendedFor, setIntendedFor] = useState("");

  async function createInvitation() {
    setErr(null);
    setBusy(true);
    try {
      const res = await api<CreatedInvitation>("/auth/invitations", {
        auth: true,
        body: {
          intendedFor: intendedFor || undefined,
          role: "user",
          ttlHours: 24,
        },
      });
      setCreated(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="status">
      <h2>Panel admin</h2>
      <p>Emite una invitación para dar de alta a un miembro del equipo.</p>
      <label className="inline">
        <span>Para (etiqueta):</span>
        <input
          value={intendedFor}
          onChange={(e) => setIntendedFor(e.target.value)}
          placeholder="p. ej. contabilidad-maria"
        />
      </label>
      <button type="button" onClick={createInvitation} disabled={busy}>
        {busy ? "Creando..." : "Crear código de invitación"}
      </button>
      {err && <p className="error">Error: {err}</p>}
      {created && (
        <div className="invite-card">
          <p>Código (válido una sola vez, expira el {new Date(created.expiresAt).toLocaleString()}):</p>
          <code className="code-big">{created.code}</code>
          <p className="hint">
            Link directo: <code>/enroll?code={created.code}</code>
          </p>
        </div>
      )}
    </section>
  );
}
