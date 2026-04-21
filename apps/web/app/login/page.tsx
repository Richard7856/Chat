"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Loader2, Lock, ShieldCheck } from "lucide-react";
import { api, saveSession } from "../lib/api";
import { ensureDeviceKeypair } from "../lib/keys";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Alert, AlertDescription } from "../components/ui/alert";

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
      await ensureDeviceKeypair(res.device.id);
      router.push("/app/chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative min-h-screen bg-hero">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground glow-primary">
            <Lock className="size-6" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Euromex Chat</h1>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <ShieldCheck className="size-4 text-primary" />
            Chat interno cifrado de extremo a extremo
          </p>
        </div>

        {/* Form card */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-xl shadow-black/20 animate-slide-up">
          <h2 className="mb-1 text-lg font-semibold">Iniciar sesión</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            Acceso restringido a miembros de Grupo Euromex.
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">Usuario</Label>
              <Input
                id="username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                placeholder="richard"
                required
                disabled={submitting}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={submitting}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="totp">Código 2FA (6 dígitos)</Label>
              <Input
                id="totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={totpToken}
                onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                required
                disabled={submitting}
                className="tracking-[0.3em] text-center font-mono text-base"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="device">Nombre de este dispositivo</Label>
              <Input
                id="device"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                required
                disabled={submitting}
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" />
                <AlertDescription>{humanizeError(error)}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              disabled={submitting}
              className="w-full"
              size="lg"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Entrando…
                </>
              ) : (
                <>
                  Entrar
                  <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          ¿Primera vez?{" "}
          <Link
            href="/enroll"
            className="font-medium text-primary hover:underline"
          >
            Usa tu código de invitación
          </Link>
        </p>
      </div>
    </main>
  );
}

function defaultDeviceName(): string {
  if (typeof navigator === "undefined") return "Navegador web";
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone — Safari";
  if (/iPad/.test(ua)) return "iPad — Safari";
  if (/Android/.test(ua)) return "Android — navegador";
  if (/Mac OS X/.test(ua)) return "Mac — navegador";
  if (/Windows/.test(ua)) return "Windows — navegador";
  if (/Linux/.test(ua)) return "Linux — navegador";
  return "Dispositivo web";
}

function humanizeError(code: string): string {
  const map: Record<string, string> = {
    invalid_credentials: "Usuario o contraseña incorrectos.",
    invalid_totp: "El código 2FA no coincide. Verifica tu app autenticadora.",
    session_revoked: "Tu sesión fue revocada. Inicia sesión de nuevo.",
    invalid_body: "Revisa los datos — alguno no es válido.",
  };
  return map[code] ?? `Error: ${code}`;
}
