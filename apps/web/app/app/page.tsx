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

      <section className="status">
        <h2>Mensajería</h2>
        <p>
          Chat cifrado de extremo a extremo, con adjuntos y avisos de
          seguridad.
        </p>
        <p>
          <a href="/app/chat" className="cta">
            Abrir chat →
          </a>
        </p>
      </section>

      {me.user.role === "admin" && (
        <section className="status">
          <h2>Panel admin</h2>
          <p>
            Gestiona usuarios, invitaciones y revisa el audit log del sistema.
          </p>
          <p>
            <a href="/app/admin" className="cta">
              Abrir panel admin →
            </a>
          </p>
        </section>
      )}
    </main>
  );
}
