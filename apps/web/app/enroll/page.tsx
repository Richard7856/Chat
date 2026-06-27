"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  KeyRound,
  Loader2,
  QrCode,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { api, saveSession } from "../lib/api";
import { ensureUserIdentity } from "../lib/identity";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Alert, AlertDescription } from "../components/ui/alert";

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
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-hero">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </main>
      }
    >
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
  const [copiedUri, setCopiedUri] = useState(false);

  useEffect(() => {
    const preset = params.get("code");
    if (preset) setCode(preset.toUpperCase());
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
      // Fase 31: genera la identidad de usuario y la enrolla (envuelta con la
      // contraseña + con la llave de escrow).
      await ensureUserIdentity(res.user.id, password);
      router.push("/app/chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyUri() {
    if (!begin) return;
    try {
      await navigator.clipboard.writeText(begin.totpUri);
      setCopiedUri(true);
      setTimeout(() => setCopiedUri(false), 2000);
    } catch {}
  }

  return (
    <main className="relative min-h-screen bg-hero">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground glow-primary">
            {step === "begin" ? (
              <UserPlus className="size-6" />
            ) : (
              <QrCode className="size-6" />
            )}
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            {step === "begin" ? "Crear cuenta" : "Configura tu 2FA"}
          </h1>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <ShieldCheck className="size-4 text-primary" />
            {step === "begin"
              ? "Requiere código de invitación"
              : "Último paso — escanea el QR"}
          </p>
        </div>

        {/* Stepper visual */}
        <div className="mb-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <span
            className={
              step === "begin" ? "text-primary font-medium" : "text-muted-foreground"
            }
          >
            1. Datos
          </span>
          <div className="h-px w-8 bg-border" />
          <span
            className={
              step === "complete" ? "text-primary font-medium" : "text-muted-foreground"
            }
          >
            2. 2FA + contraseña
          </span>
        </div>

        {step === "begin" && (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-xl shadow-black/20 animate-slide-up">
            <form onSubmit={onBegin} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="code">Código de invitación</Label>
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="ABCD-EFGH-JKLM-NPQR"
                  required
                  className="font-mono tracking-wider uppercase"
                  disabled={submitting}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="username">Usuario (sin espacios)</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  pattern="[a-z0-9._-]{3,32}"
                  placeholder="maria"
                  required
                  disabled={submitting}
                />
                <p className="text-xs text-muted-foreground">
                  Solo minúsculas, números, punto, guion, guion bajo. 3–32 chars.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="display-name">Nombre para mostrar</Label>
                <Input
                  id="display-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Maria López"
                  required
                  disabled={submitting}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">Email (opcional)</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="maria@grupoeuromex.com"
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
                    Validando…
                  </>
                ) : (
                  <>
                    Siguiente
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            </form>
          </div>
        )}

        {step === "complete" && begin && (
          <div className="space-y-5 animate-slide-up">
            {/* QR */}
            <div className="rounded-2xl border border-border bg-card p-6 shadow-xl shadow-black/20">
              <div className="mb-4 text-center">
                <p className="text-sm font-medium">Escanea con tu autenticador</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Google Authenticator, Aegis, 1Password, Authy…
                </p>
              </div>
              <div className="mx-auto w-fit rounded-xl bg-white p-3 shadow-lg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={begin.totpQrDataUrl}
                  alt="QR TOTP"
                  width={220}
                  height={220}
                  className="block"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4 w-full"
                onClick={copyUri}
              >
                {copiedUri ? (
                  <>
                    <Check className="size-4 text-success" />
                    URI copiada
                  </>
                ) : (
                  <>
                    <Copy className="size-4" />
                    ¿No puedes escanear? Copiar URI
                  </>
                )}
              </Button>
            </div>

            {/* Form complete */}
            <div className="rounded-2xl border border-border bg-card p-6 shadow-xl shadow-black/20">
              <form onSubmit={onComplete} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="totp">Código TOTP (6 dígitos)</Label>
                  <Input
                    id="totp"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    value={totpToken}
                    onChange={(e) =>
                      setTotpToken(e.target.value.replace(/\D/g, ""))
                    }
                    placeholder="000000"
                    required
                    disabled={submitting}
                    className="tracking-[0.3em] text-center font-mono text-base"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password">Contraseña (mínimo 12 caracteres)</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={submitting}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password2">Confirma contraseña</Label>
                  <Input
                    id="password2"
                    type="password"
                    value={password2}
                    onChange={(e) => setPassword2(e.target.value)}
                    required
                    disabled={submitting}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="device-name">Nombre de este dispositivo</Label>
                  <Input
                    id="device-name"
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
                      Creando cuenta…
                    </>
                  ) : (
                    <>
                      <KeyRound className="size-4" />
                      Crear cuenta
                    </>
                  )}
                </Button>
              </form>
            </div>
          </div>
        )}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          ¿Ya tienes cuenta?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Inicia sesión
          </Link>
        </p>
      </div>
    </main>
  );
}

function humanizeError(code: string): string {
  const map: Record<string, string> = {
    invalid_or_expired_code: "El código ya no es válido o expiró.",
    username_taken: "Ese usuario ya existe. Elige otro.",
    invalid_totp: "El código 2FA no coincide. Reintenta.",
    enrollment_expired: "La sesión de enrollment expiró (10 min). Reinicia.",
    invalid_body: "Revisa los datos — alguno no es válido.",
  };
  return map[code] ?? `Error: ${code}`;
}
