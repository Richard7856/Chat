"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, saveSession } from "../lib/api";

interface AuthSuccess {
  accessToken: string;
  expiresInSec: number;
  user: { id: string; username: string; displayName: string; role: "user" | "admin" };
  device: {
    id: string;
    deviceName: string;
    platform: "web" | "ios" | "android" | "desktop";
  };
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpToken, setTotpToken] = useState("");
  const [deviceName, setDeviceName] = useState(defaultDeviceName());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api<AuthSuccess>("/auth/login", {
        body: { username, password, totpToken, deviceName, platform: "web" },
      });
      saveSession(res);
      router.push("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="shell">
      <header className="brand">
        <h1>Iniciar sesión</h1>
        <p className="tagline">Euromex Chat — acceso restringido.</p>
      </header>

      <form onSubmit={onSubmit} className="form">
        <label>
          <span>Usuario</span>
          <input
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label>
          <span>Contraseña</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <label>
          <span>Código TOTP (6 dígitos)</span>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            value={totpToken}
            onChange={(e) => setTotpToken(e.target.value)}
            required
          />
        </label>
        <label>
          <span>Nombre de este dispositivo</span>
          <input
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            required
          />
        </label>

        {error && <p className="error">Error: {error}</p>}

        <button type="submit" disabled={submitting}>
          {submitting ? "Entrando..." : "Entrar"}
        </button>
      </form>

      <p className="hint">
        ¿Primera vez? Necesitas un código de invitación del admin y entrar por{" "}
        <a href="/enroll">/enroll</a>.
      </p>
    </main>
  );
}

function defaultDeviceName(): string {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone — Safari";
  if (/Android/.test(ua)) return "Android — navegador";
  if (/Mac/.test(ua)) return "Mac — navegador";
  if (/Windows/.test(ua)) return "Windows — navegador";
  return "Dispositivo web";
}
