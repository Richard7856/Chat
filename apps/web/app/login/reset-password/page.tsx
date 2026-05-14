"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  KeyRound,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { api } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Alert, AlertDescription } from "../../components/ui/alert";

/**
 * Fase 30b — Self-service password reset.
 *
 * El user que conserva su authenticator TOTP puede cambiar la password
 * por sí mismo, sin pasar por un admin. El TOTP actúa como segundo factor.
 *
 * Flujo:
 *   1. User ingresa username + código 2FA actual + nueva password + confirmación.
 *   2. POST /auth/password/reset-self → server valida TOTP, persiste new pwd,
 *      revoca TODOS los devices activos (zero-trust), audit log.
 *   3. Pantalla de éxito → user va a /login a hacer login con la nueva pwd.
 *
 * Si el user también perdió el authenticator (caso "perdí el celular"), no
 * puede usar este flow — el banner final explica que debe contactar a un admin.
 */

export default function ResetPasswordPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [totpToken, setTotpToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validación cliente. El server también valida; esto es solo feedback rápido.
    if (newPassword.length < 12) {
      setError("La contraseña debe tener mínimo 12 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (!/^[a-z0-9._-]+$/.test(username)) {
      setError("El usuario tiene formato inválido.");
      return;
    }
    if (!/^\d{6}$/.test(totpToken)) {
      setError("El código 2FA debe ser de 6 dígitos.");
      return;
    }

    setSubmitting(true);
    try {
      await api("/auth/password/reset-self", {
        method: "POST",
        body: { username, totpToken, newPassword },
      });
      setDone(true);
      // No auto-redirect — dejamos que el user lea el mensaje y entre cuando esté listo.
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      if (msg.includes("invalid_credentials_or_totp")) {
        setError(
          "Usuario o código 2FA inválido. Verifica los datos y vuelve a intentar.",
        );
      } else if (msg.includes("invalid_body")) {
        setError(
          "Los datos no cumplen los requisitos (password mínimo 12 caracteres, TOTP 6 dígitos).",
        );
      } else {
        setError("No se pudo cambiar la contraseña. Intenta de nuevo.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Estado final: éxito ──────────────────────────────────────────────────
  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
            <Check className="size-7" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Contraseña actualizada
            </h1>
            <p className="text-sm text-muted-foreground">
              Tu contraseña se cambió correctamente. Todas las sesiones activas
              fueron revocadas — vuelve a iniciar sesión con tu nueva contraseña.
            </p>
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3 text-left text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">
              Esta acción quedó registrada
            </p>
            <p>
              Un administrador puede ver en el panel de auditoría que tu cuenta
              cambió la contraseña por sí misma. Si no fuiste tú, contáctalos
              inmediatamente para investigar.
            </p>
          </div>

          <Link href="/login">
            <Button className="w-full" size="lg">
              Iniciar sesión
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // ─── Estado inicial: form ─────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <KeyRound className="size-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Cambiar mi contraseña
          </h1>
          <p className="text-sm text-muted-foreground">
            Si conservas tu authenticator (Google Authenticator, Authy, etc.)
            puedes cambiar la contraseña tú mismo con tu código 2FA.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="username">Usuario</Label>
            <Input
              id="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="tu_usuario"
              required
              disabled={submitting}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="totp">Código 2FA actual (6 dígitos)</Label>
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
            <Label htmlFor="new-password">Nueva contraseña</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mínimo 12 caracteres"
              minLength={12}
              required
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirma la contraseña</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repite la nueva contraseña"
              minLength={12}
              required
              disabled={submitting}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={submitting} className="w-full" size="lg">
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Cambiando…
              </>
            ) : (
              <>
                <ShieldCheck className="size-4" />
                Cambiar contraseña
              </>
            )}
          </Button>
        </form>

        <div className="space-y-3">
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
            <p className="font-medium text-amber-900 dark:text-amber-200 mb-1">
              ¿Perdiste también tu authenticator?
            </p>
            <p className="text-amber-800 dark:text-amber-300">
              Sin el código 2FA no puedes usar este flow. Contacta a un
              administrador del chat para que regenere tu TOTP.
            </p>
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">Importante</p>
            <p>
              Al completar el cambio se revocan todas tus sesiones activas y se
              registra la acción en el log de auditoría visible para los
              administradores.
            </p>
          </div>

          <button
            type="button"
            onClick={() => router.push("/login")}
            className="flex w-full items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            Volver al inicio de sesión
          </button>
        </div>
      </div>
    </div>
  );
}
