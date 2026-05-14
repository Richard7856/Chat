"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  KeyRound,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { api, saveSession } from "../../lib/api";
import { ensureDeviceKeypair } from "../../lib/keys";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Alert, AlertDescription } from "../../components/ui/alert";

/**
 * Fase 30 — Página de cambio forzado de password tras un admin reset.
 *
 * Flujo:
 *   1. El user intentó hacer login con la temp password generada por el admin.
 *   2. El server detectó must_change_password=true y devolvió en lugar de un
 *      JWT normal, un changeToken corto (5 min, JWT con claim t="password-change").
 *   3. El login page guardó el token en sessionStorage y nos redirigió aquí.
 *   4. El user ingresa nueva password + TOTP y enviamos a /auth/password/forced.
 *   5. El server valida, persiste la nueva password, limpia el flag y devuelve
 *      un AuthSuccessResponse completo. saveSession() + redirect a /app/chat.
 *
 * Si no hay changeToken válido en sessionStorage (recarga después de éxito,
 * acceso directo por URL, expiró el flujo), redirigimos a /login.
 */

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

const CHANGE_TOKEN_KEY = "euromex.changeToken";
const CHANGE_USERNAME_KEY = "euromex.changeUsername";
const CHANGE_DISPLAY_KEY = "euromex.changeDisplayName";

function defaultDeviceName(): string {
  if (typeof navigator === "undefined") return "Navegador web";
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone — Safari";
  if (/iPad/.test(ua)) return "iPad — Safari";
  if (/Android/.test(ua)) return "Android — navegador";
  if (/Mac OS X/.test(ua)) return "Mac — navegador";
  if (/Windows/.test(ua)) return "Windows — navegador";
  return "Navegador web";
}

export default function ForcedChangePage() {
  const router = useRouter();
  const [changeToken, setChangeToken] = useState<string | null>(null);
  const [username, setUsername] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [totpToken, setTotpToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cargar el contexto del cambio. Si no hay → redirect a /login.
  useEffect(() => {
    const token = sessionStorage.getItem(CHANGE_TOKEN_KEY);
    if (!token) {
      router.replace("/login");
      return;
    }
    setChangeToken(token);
    setUsername(sessionStorage.getItem(CHANGE_USERNAME_KEY) ?? "");
    setDisplayName(sessionStorage.getItem(CHANGE_DISPLAY_KEY) ?? "");
  }, [router]);

  function clearChangeContext() {
    sessionStorage.removeItem(CHANGE_TOKEN_KEY);
    sessionStorage.removeItem(CHANGE_USERNAME_KEY);
    sessionStorage.removeItem(CHANGE_DISPLAY_KEY);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validación cliente — el server también valida, pero damos feedback rápido.
    if (newPassword.length < 12) {
      setError("La contraseña debe tener mínimo 12 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (!/^\d{6}$/.test(totpToken)) {
      setError("El código 2FA debe ser de 6 dígitos.");
      return;
    }
    if (!changeToken) {
      setError("La sesión de cambio expiró. Vuelve a iniciar sesión.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await api<AuthSuccess>("/auth/password/forced", {
        method: "POST",
        body: {
          changeToken,
          newPassword,
          totpToken,
          deviceName: defaultDeviceName(),
          platform: "web",
        },
      });
      clearChangeContext();
      saveSession(res);
      await ensureDeviceKeypair(res.device.id);
      router.push("/app/chat");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      if (msg.includes("invalid_totp")) {
        setError("Código 2FA incorrecto.");
      } else if (msg.includes("same_as_temp_password")) {
        setError(
          "La nueva contraseña debe ser distinta a la temporal que recibiste.",
        );
      } else if (msg.includes("invalid_change_token")) {
        setError(
          "La sesión de cambio expiró (5 min máximo). Vuelve a iniciar sesión con la temp password.",
        );
        clearChangeContext();
        // No redirect inmediato — el user puede leer el mensaje
      } else if (msg.includes("no_change_required")) {
        setError(
          "El cambio ya fue completado en otra sesión. Vuelve a iniciar sesión normalmente.",
        );
        clearChangeContext();
      } else if (msg.includes("session_revoked")) {
        setError("La sesión fue revocada. Vuelve a iniciar sesión.");
        clearChangeContext();
      } else {
        setError("No se pudo cambiar la contraseña. Intenta de nuevo.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Mientras carga el token desde sessionStorage, no renderizamos el form
  // para evitar flash de contenido si vamos a redirigir.
  if (!changeToken) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
            <KeyRound className="size-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Cambia tu contraseña
          </h1>
          <p className="text-sm text-muted-foreground">
            Un administrador restableció tu contraseña.
            {displayName && (
              <>
                {" "}
                <span className="font-medium text-foreground">
                  {displayName} (@{username})
                </span>
              </>
            )}
            <br />
            Elige una nueva antes de continuar.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
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
              autoFocus
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

          <div className="space-y-1.5">
            <Label htmlFor="totp">Código 2FA (6 dígitos)</Label>
            <Input
              id="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
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
            <p className="text-xs text-muted-foreground">
              Tu authenticator app sigue siendo el mismo — el admin no cambió tu TOTP.
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertDescription>{error}</AlertDescription>
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
                Cambiando…
              </>
            ) : (
              <>
                <ShieldCheck className="size-4" />
                Cambiar contraseña y entrar
              </>
            )}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Tienes 5 minutos para completar este cambio.
          <br />
          Si expira, vuelve a iniciar sesión con la contraseña temporal.
        </p>
      </div>
    </div>
  );
}
