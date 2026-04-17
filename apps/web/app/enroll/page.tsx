"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, saveSession } from "../lib/api";
import { ensureDeviceKeypair } from "../lib/keys";

interface BeginResponse {
  enrollmentId: string;
  totpUri: string;
  totpQrDataUrl: string;
}

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

export default function EnrollPage() {
  return (
    <Suspense fallback={<main className="shell"><p className="tagline">Cargando…</p></main>}>
      <EnrollContent />
    </Suspense>
  );
}

function EnrollContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<"begin" | "complete">("begin");
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [begin, setBegin] = useState<BeginResponse | null>(null);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [totpToken, setTotpToken] = useState("");
  const [deviceName, setDeviceName] = useState("Mi primer dispositivo");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const preset = params.get("code");
    if (preset) setCode(preset);
  }, [params]);

  async function onBegin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api<BeginResponse>("/auth/enroll/begin", {
        body: { code, username, displayName, email: email || undefined },
      });
      setBegin(res);
      setStep("complete");
    } catch (err) {
      setError(err instanceof Error ? err.message : "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function onComplete(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError("La contraseña debe tener al menos 12 caracteres.");
      return;
    }
    if (password !== password2) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (!begin) return;

    setSubmitting(true);
    try {
      const res = await api<AuthSuccess>("/auth/enroll/complete", {
        body: {
          enrollmentId: begin.enrollmentId,
          password,
          totpToken,
          deviceName,
          platform: "web",
        },
      });
      saveSession(res);
      await ensureDeviceKeypair(res.device.id);
      router.push("/app/chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : "error");
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "begin") {
    return (
      <main className="shell">
        <header className="brand">
          <h1>Crear cuenta</h1>
          <p className="tagline">
            Necesitas un código de invitación emitido por un admin.
          </p>
        </header>

        <form onSubmit={onBegin} className="form">
          <label>
            <span>Código de invitación</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD-EFGH-JKLM-NPQR"
              required
            />
          </label>
          <label>
            <span>Usuario (sin espacios)</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              pattern="[a-z0-9._-]{3,32}"
              required
            />
          </label>
          <label>
            <span>Nombre para mostrar</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </label>
          <label>
            <span>Email (opcional)</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          {error && <p className="error">Error: {error}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? "Validando..." : "Siguiente"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="brand">
        <h1>Configura tu segundo factor</h1>
        <p className="tagline">
          Escanea este QR con Google Authenticator, Aegis o 1Password.
        </p>
      </header>

      {begin && (
        <div className="qr-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={begin.totpQrDataUrl} alt="QR TOTP" width={240} height={240} />
          <details>
            <summary>¿No puedes escanear? Copia la URI</summary>
            <code className="uri">{begin.totpUri}</code>
          </details>
        </div>
      )}

      <form onSubmit={onComplete} className="form">
        <label>
          <span>Código TOTP (para confirmar)</span>
          <input
            inputMode="numeric"
            pattern="\d{6}"
            value={totpToken}
            onChange={(e) => setTotpToken(e.target.value)}
            required
          />
        </label>
        <label>
          <span>Contraseña (mínimo 12 caracteres)</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <label>
          <span>Repite la contraseña</span>
          <input
            type="password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
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
          {submitting ? "Creando cuenta..." : "Crear cuenta"}
        </button>
      </form>
    </main>
  );
}
