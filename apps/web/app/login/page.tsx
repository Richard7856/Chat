"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Fingerprint,
  Loader2,
  LogIn,
  ShieldCheck,
  UserX,
} from "lucide-react";
import {
  api,
  clearDeviceHint,
  loadDeviceHint,
  saveSession,
  type DeviceHint,
} from "../lib/api";
import { ensureDeviceKeypair } from "../lib/keys";
import { loadKeypair } from "../lib/keys";
import {
  clearBiometricUnlock,
  hasLocalBiometricFlag,
  isBiometricAvailable,
  unlockWithBiometric,
} from "../lib/biometric";
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

// Fase 27: 'biometric' es una variante del modo "quick" — tenemos device
// hint + keypair + biometría activada. La pantalla muestra el botón huella
// como acción primaria; "Usar TOTP" hace fallback al modo quick clásico.
type LoginMode = "loading" | "biometric" | "quick" | "full";

export default function LoginPage() {
  const router = useRouter();

  // Modo del formulario: se determina en el useEffect inicial
  const [mode, setMode] = useState<LoginMode>("loading");
  const [hint, setHint] = useState<DeviceHint | null>(null);

  // Campos compartidos entre ambos modos
  const [totpToken, setTotpToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Campos exclusivos del modo completo
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [deviceName, setDeviceName] = useState(defaultDeviceName());

  // Al montar: detectar si hay un device hint + keypair guardados en
  // localStorage. Si ambos existen, el usuario puede entrar solo con TOTP.
  // Fase 27: si además hay biometría enrolada y el usuario activó "iniciar
  // con huella" en este device, mostramos el modo biométrico como primario.
  useEffect(() => {
    (async () => {
      const h = loadDeviceHint();
      if (h) {
        const kp = await loadKeypair(h.deviceId);
        if (kp) {
          setHint(h);
          // Solo entramos a "biometric" si: (a) flag local dice que está
          // activado, y (b) realmente hay sensor + huella enrolada. Si la
          // huella se borró del sistema, el flag aún diría "1" y el unlock
          // fallaría — por eso comprobamos availability también.
          const useBio = hasLocalBiometricFlag() && (await isBiometricAvailable());
          setMode(useBio ? "biometric" : "quick");
          return;
        }
        // Hay hint pero el keypair fue limpiado — borramos el hint huérfano
        clearDeviceHint();
      }
      setMode("full");
    })();
  }, []);

  // --------------------------------------------------------------------------
  // Fase 27 — Flujo biométrico
  // --------------------------------------------------------------------------
  async function onBiometricUnlock() {
    if (!hint) return;
    setError(null);
    setSubmitting(true);
    try {
      const unlocked = await unlockWithBiometric();
      if (!unlocked) {
        // El usuario canceló o el prompt falló — no es error fatal,
        // dejamos el botón listo para reintentar.
        return;
      }
      const res = await api<AuthSuccess>("/auth/biometric/unlock", {
        body: { biometricToken: unlocked.token },
      });
      saveSession(res);
      await ensureDeviceKeypair(res.device.id);
      router.push("/app/chat");
    } catch (err) {
      const code = err instanceof Error ? err.message : "error";
      if (code === "biometric_revoked" || code === "invalid_biometric_token") {
        // El token guardado ya no sirve (admin revocó device, usuario
        // desactivó biometría desde otro device, o JWT expiró). Limpiamos
        // y caemos al modo TOTP — el hint sigue vivo.
        await clearBiometricUnlock();
        setMode("quick");
        setError(
          "La autenticación biométrica fue revocada. Ingresa tu código 2FA.",
        );
      } else if (code === "session_revoked") {
        await clearBiometricUnlock();
        clearDeviceHint();
        setHint(null);
        setMode("full");
        setError("Tu sesión fue revocada. Inicia sesión de nuevo.");
      } else {
        setError(humanizeError(code));
      }
    } finally {
      setSubmitting(false);
    }
  }

  // --------------------------------------------------------------------------
  // Flujo rápido — solo TOTP, mismo deviceId
  // --------------------------------------------------------------------------
  async function onQuickSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hint) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await api<AuthSuccess>("/auth/reauth", {
        body: { deviceId: hint.deviceId, totpToken },
      });
      saveSession(res);
      // ensureDeviceKeypair es idempotente — devuelve el keypair existente
      await ensureDeviceKeypair(res.device.id);
      router.push("/app/chat");
    } catch (err) {
      const code = err instanceof Error ? err.message : "error";
      if (code === "session_revoked") {
        // El device fue revocado por un admin → forzar login completo
        clearDeviceHint();
        setHint(null);
        setMode("full");
        setError("Tu sesión fue revocada por un administrador. Inicia sesión de nuevo.");
      } else {
        setError(humanizeError(code));
      }
    } finally {
      setSubmitting(false);
    }
  }

  // --------------------------------------------------------------------------
  // Flujo completo — usuario + contraseña + TOTP + nombre de dispositivo
  // --------------------------------------------------------------------------
  async function onFullSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Si todavía existe un deviceHint local (ej. usuario cerró sesión pero
      // el browser sigue siendo el mismo), pasamos el deviceId para que el
      // server reuse esa fila en vez de crear un device nuevo cada vez.
      const existingHint = loadDeviceHint();
      const res = await api<AuthSuccess>("/auth/login", {
        body: {
          username,
          password,
          totpToken,
          deviceName,
          platform: "web",
          ...(existingHint?.deviceId ? { deviceId: existingHint.deviceId } : {}),
        },
      });
      saveSession(res);
      await ensureDeviceKeypair(res.device.id);
      router.push("/app/chat");
    } catch (err) {
      setError(humanizeError(err instanceof Error ? err.message : "error"));
    } finally {
      setSubmitting(false);
    }
  }

  // --------------------------------------------------------------------------
  // Estados de carga
  // --------------------------------------------------------------------------
  if (mode === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </main>
    );
  }

  return (
    <main className="relative min-h-screen bg-hero">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        {/* Brand — el logo oficial ya contiene el wordmark "EurOMex". Mantener
            solo el logo + tagline; sin "Euromex Chat" redundante. */}
        <div className="mb-8 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Euromex"
            className="mb-3 h-12 w-auto select-none"
            draggable={false}
          />
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ShieldCheck className="size-4 text-primary" />
            Chat interno cifrado de extremo a extremo
          </p>
        </div>

        {/* Form card */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-xl shadow-black/5 animate-slide-up">

          {/* ---------------------------------------------------------------- */}
          {/* Fase 27 — Modo biométrico (solo en APK con huella activada)      */}
          {/* ---------------------------------------------------------------- */}
          {mode === "biometric" && hint && (
            <>
              <div className="mb-6">
                <h2 className="mb-1 text-lg font-semibold">Bienvenido de nuevo</h2>
                <p className="text-sm text-muted-foreground">
                  Confirma con tu huella o Face ID para entrar.
                </p>
              </div>

              <div className="mb-5 flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary font-semibold text-sm">
                  {hint.displayName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{hint.displayName}</p>
                  <p className="text-xs text-muted-foreground">@{hint.username}</p>
                </div>
              </div>

              {error && (
                <Alert variant="destructive" className="mb-4">
                  <AlertTriangle className="size-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                type="button"
                onClick={onBiometricUnlock}
                disabled={submitting}
                className="w-full"
                size="lg"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Verificando…
                  </>
                ) : (
                  <>
                    <Fingerprint className="size-5" />
                    Entrar con huella / Face ID
                  </>
                )}
              </Button>

              <button
                type="button"
                onClick={() => {
                  setMode("quick");
                  setError(null);
                }}
                className="mt-4 flex w-full items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronRight className="size-3.5" />
                Usar código 2FA
              </button>
            </>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* Modo rápido: solo TOTP                                           */}
          {/* ---------------------------------------------------------------- */}
          {mode === "quick" && hint && (
            <>
              <div className="mb-6">
                <h2 className="mb-1 text-lg font-semibold">Bienvenido de nuevo</h2>
                <p className="text-sm text-muted-foreground">
                  Confirma tu identidad con el código 2FA.
                </p>
              </div>

              {/* Identidad guardada (solo lectura) */}
              <div className="mb-5 flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary font-semibold text-sm">
                  {hint.displayName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{hint.displayName}</p>
                  <p className="text-xs text-muted-foreground">@{hint.username}</p>
                </div>
              </div>

              <form onSubmit={onQuickSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="totp-quick">Código 2FA (6 dígitos)</Label>
                  <Input
                    id="totp-quick"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    maxLength={6}
                    value={totpToken}
                    onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, ""))}
                    placeholder="000000"
                    required
                    disabled={submitting}
                    autoFocus
                    className="tracking-[0.3em] text-center font-mono text-base"
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
                      Entrando…
                    </>
                  ) : (
                    <>
                      <LogIn className="size-4" />
                      Entrar
                    </>
                  )}
                </Button>
              </form>

              {/* Opción para cambiar de cuenta */}
              <button
                type="button"
                onClick={() => {
                  // Solo cambiamos modo — no borramos el hint ni el keypair.
                  // El usuario puede volver al modo rápido si cancela.
                  setMode("full");
                  setError(null);
                  setTotpToken("");
                }}
                className="mt-4 flex w-full items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <UserX className="size-3.5" />
                Usar otra cuenta
              </button>
            </>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* Modo completo: usuario + contraseña + TOTP + dispositivo         */}
          {/* ---------------------------------------------------------------- */}
          {mode === "full" && (
            <>
              <h2 className="mb-1 text-lg font-semibold">Iniciar sesión</h2>
              <p className="mb-6 text-sm text-muted-foreground">
                Acceso restringido a miembros de Grupo Euromex.
              </p>

              <form onSubmit={onFullSubmit} className="space-y-4">
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

              {/* Volver al modo rápido si había un hint (usuario canceló) */}
              {hint && (
                <button
                  type="button"
                  onClick={() => { setMode("quick"); setError(null); setTotpToken(""); }}
                  className="mt-4 flex w-full items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronRight className="size-3.5" />
                  Volver a @{hint.username}
                </button>
              )}
            </>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          ¿Primera vez?{" "}
          <Link href="/enroll" className="font-medium text-primary hover:underline">
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
