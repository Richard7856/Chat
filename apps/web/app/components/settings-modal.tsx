"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Fingerprint,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  X,
} from "lucide-react";
import type {
  BeginTotpRotationResponse,
  EnableBiometricResponse,
} from "@euromex/shared";
import { api, clearSession } from "../lib/api";
import {
  clearBiometricUnlock,
  enableBiometricUnlock,
  hasLocalBiometricFlag,
  isBiometricAvailable,
} from "../lib/biometric";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

/**
 * Modal de configuración personal del usuario.
 *
 * Fase 26 (C3 + C4):
 *   - Tab "Contraseña": cambia la password (current + new + TOTP).
 *   - Tab "2FA": rota el secreto TOTP (current TOTP → nuevo QR → confirmar).
 *
 * Cuando la password cambia con `revokeOtherDevices=true` (default), el
 * usuario es deslogueado de todos sus demás devices. El device actual sigue
 * funcionando porque el cambio NO afecta al JWT existente — solo el
 * password_hash en BD. (Para futuro: podríamos rotar el JWT secret y
 * forzar re-login global cuando la sesión es muy vieja.)
 */
interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = "password" | "totp" | "biometric";

export function SettingsModal({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("password");
  // Solo mostramos el tab de biometría si la app corre en mobile con sensor
  // disponible. Detectado al abrir el modal (cached por sesión).
  const [showBiometricTab, setShowBiometricTab] = useState(false);

  useEffect(() => {
    if (!open) return;
    void isBiometricAvailable().then(setShowBiometricTab);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">Mi cuenta</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border bg-muted/30">
          <TabBtn active={tab === "password"} onClick={() => setTab("password")} icon={<Lock size={14} />}>
            Contraseña
          </TabBtn>
          <TabBtn active={tab === "totp"} onClick={() => setTab("totp")} icon={<ShieldCheck size={14} />}>
            2FA / TOTP
          </TabBtn>
          {showBiometricTab && (
            <TabBtn
              active={tab === "biometric"}
              onClick={() => setTab("biometric")}
              icon={<Fingerprint size={14} />}
            >
              Huella / Face ID
            </TabBtn>
          )}
        </div>

        <div className="px-5 py-4">
          {tab === "password" && <PasswordPanel onSuccess={onClose} />}
          {tab === "totp" && <TotpPanel />}
          {tab === "biometric" && <BiometricPanel />}
        </div>
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex items-center gap-1.5 px-4 py-2 text-sm transition-colors border-b-2",
        active
          ? "border-primary text-primary font-medium"
          : "border-transparent text-muted-foreground hover:text-foreground",
      ].join(" ")}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — Cambiar contraseña
// ---------------------------------------------------------------------------
function PasswordPanel({ onSuccess }: { onSuccess: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [totp, setTotp] = useState("");
  const [revokeOthers, setRevokeOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (next !== confirm) {
      setErr("Las contraseñas nuevas no coinciden.");
      return;
    }
    if (next.length < 12) {
      setErr("La nueva contraseña debe tener al menos 12 caracteres.");
      return;
    }
    setBusy(true);
    try {
      await api("/auth/password", {
        method: "POST",
        auth: true,
        body: {
          currentPassword: current,
          newPassword: next,
          totpToken: totp,
          revokeOtherDevices: revokeOthers,
        },
      });
      setDone(true);
      // Auto-cerrar después de 1.5s
      setTimeout(onSuccess, 1500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      if (msg.includes("invalid_current_password")) setErr("Contraseña actual incorrecta.");
      else if (msg.includes("invalid_totp")) setErr("Código 2FA incorrecto.");
      else if (msg.includes("same_as_current")) setErr("La nueva contraseña no puede ser igual a la actual.");
      else setErr("No se pudo cambiar la contraseña.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <CheckCircle2 className="size-8 text-[hsl(var(--accent-task))]" />
        <p className="text-sm font-medium">Contraseña actualizada</p>
        <p className="text-xs text-muted-foreground">
          {revokeOthers
            ? "Tus otros dispositivos fueron desconectados."
            : "Tus otras sesiones siguen activas."}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="current">Contraseña actual</Label>
        <Input
          id="current"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          disabled={busy}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="next">Nueva contraseña</Label>
        <Input
          id="next"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
          disabled={busy}
          minLength={12}
        />
        <p className="text-[11px] text-muted-foreground">Mínimo 12 caracteres.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirmar nueva contraseña</Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          disabled={busy}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="totp">Código 2FA actual</Label>
        <Input
          id="totp"
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="one-time-code"
          value={totp}
          onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
          required
          disabled={busy}
        />
      </div>
      <label className="flex items-start gap-2 cursor-pointer rounded-md border border-border bg-muted/40 p-2.5 text-xs">
        <input
          type="checkbox"
          checked={revokeOthers}
          onChange={(e) => setRevokeOthers(e.target.checked)}
          className="mt-0.5 size-3.5 accent-primary"
          disabled={busy}
        />
        <span>
          <span className="font-medium">Cerrar sesión en mis otros dispositivos</span>
          <br />
          <span className="text-muted-foreground">
            Recomendado si sospechas que tu contraseña anterior pudo haber sido vista.
          </span>
        </span>
      </label>
      {err && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {err}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="submit" disabled={busy} size="sm">
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          <KeyRound className="size-3.5" />
          Cambiar contraseña
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — Rotar 2FA
// ---------------------------------------------------------------------------
function TotpPanel() {
  const [step, setStep] = useState<"begin" | "confirm" | "done">("begin");
  const [oldTotp, setOldTotp] = useState("");
  const [newTotp, setNewTotp] = useState("");
  const [rotation, setRotation] = useState<BeginTotpRotationResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function beginRotation(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await api<BeginTotpRotationResponse>("/auth/totp/begin", {
        method: "POST",
        auth: true,
        body: { totpToken: oldTotp },
      });
      setRotation(r);
      setStep("confirm");
      setOldTotp("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      if (msg.includes("invalid_current_totp")) setErr("Código actual incorrecto.");
      else setErr("No se pudo iniciar la rotación.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRotation(e: React.FormEvent) {
    e.preventDefault();
    if (!rotation) return;
    setErr(null);
    setBusy(true);
    try {
      await api("/auth/totp/confirm", {
        method: "POST",
        auth: true,
        body: { rotationToken: rotation.rotationToken, totpToken: newTotp },
      });
      setStep("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      if (msg.includes("invalid_new_totp")) {
        setErr("Código del nuevo autenticador incorrecto. Reintenta con el código vigente.");
      } else if (msg.includes("invalid_rotation_token")) {
        setErr("La sesión de rotación expiró. Empieza de nuevo.");
        setStep("begin");
        setRotation(null);
      } else {
        setErr("No se pudo confirmar la rotación.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (step === "done") {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <CheckCircle2 className="size-8 text-[hsl(var(--accent-task))]" />
        <p className="text-sm font-medium">2FA actualizado correctamente</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          Tu autenticador anterior ya no funcionará. Asegúrate de mantener
          el nuevo (Google Authenticator, 1Password, Authy, etc.).
        </p>
        <Button size="sm" onClick={() => setStep("begin")} variant="ghost">
          Cerrar
        </Button>
      </div>
    );
  }

  if (step === "confirm" && rotation) {
    return (
      <form onSubmit={confirmRotation} className="space-y-3">
        <p className="text-sm">
          Escanea este código en tu app autenticadora:
        </p>
        <div className="flex justify-center rounded-md border border-border bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/png;base64,${rotation.qrPngBase64}`}
            alt="QR del nuevo TOTP"
            className="size-48"
          />
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">
            ¿No puedes escanear? Ingresa la URI manualmente
          </summary>
          <code className="mt-2 block break-all rounded bg-muted p-2 text-[10px]">
            {rotation.otpauthUri}
          </code>
        </details>
        <div className="space-y-1.5">
          <Label htmlFor="new-totp">Código del nuevo autenticador</Label>
          <Input
            id="new-totp"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            value={newTotp}
            onChange={(e) => setNewTotp(e.target.value.replace(/\D/g, ""))}
            required
            disabled={busy}
            placeholder="123456"
          />
          <p className="text-[11px] text-muted-foreground">
            Ingresa el código que muestra tu autenticador AHORA. Una vez confirmado,
            el secreto anterior queda inválido.
          </p>
        </div>
        {err && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            {err}
          </p>
        )}
        <div className="flex justify-between pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setStep("begin");
              setRotation(null);
              setNewTotp("");
              setErr(null);
            }}
            disabled={busy}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={busy} size="sm">
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            <CheckCircle2 className="size-3.5" />
            Confirmar
          </Button>
        </div>
      </form>
    );
  }

  // Step "begin"
  return (
    <form onSubmit={beginRotation} className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Para cambiar tu autenticador 2FA, primero confirma con el código
        actual:
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="old-totp">Código 2FA actual</Label>
        <Input
          id="old-totp"
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="one-time-code"
          value={oldTotp}
          onChange={(e) => setOldTotp(e.target.value.replace(/\D/g, ""))}
          required
          disabled={busy}
          placeholder="123456"
        />
      </div>
      {err && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {err}
        </p>
      )}
      <div className="flex justify-end pt-1">
        <Button type="submit" disabled={busy} size="sm">
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          <ShieldCheck className="size-3.5" />
          Continuar
        </Button>
      </div>
    </form>
  );
}

// Avoid unused-import warning on clearSession (reserved for future "log out
// after sensitive change" flow if we decide to revoke the current device too)
void clearSession;

// ---------------------------------------------------------------------------
// Tab 3 (Fase 27) — Biometric unlock per device
//
// El toggle es per-device: activarlo en este APK no afecta a otros devices
// del mismo usuario. El "username" que se guarda con el token es el del
// usuario logueado actualmente — al desactivar, el server borra el JTI y el
// JWT viejo en Keystore queda inservible.
// ---------------------------------------------------------------------------

function BiometricPanel() {
  const [enabled, setEnabled] = useState(hasLocalBiometricFlag());
  const [busy, setBusy] = useState(false);
  const [showEnableForm, setShowEnableForm] = useState(false);
  const [totp, setTotp] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<"enabled" | "disabled" | null>(null);

  async function handleEnable(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    setDone(null);
    try {
      // 1. Server emite el biometric_unlock_token tras validar TOTP.
      const res = await api<EnableBiometricResponse>("/auth/biometric/enable", {
        method: "POST",
        auth: true,
        body: { totpToken: totp },
      });
      // 2. Necesitamos el username para guardarlo junto al token
      // (el server NO lo devuelve aquí; lo leemos de /auth/me con cache).
      const me = await api<{ user: { username: string } }>("/auth/me", {
        method: "GET",
        auth: true,
      });
      // 3. Guardamos el token cifrado con biometría. Esta llamada hace el
      // prompt nativo "Confirma con tu huella para activar" — el usuario
      // debe pasar la verificación una vez antes de que el Keystore acepte
      // guardar el secret atado a su biometría.
      await enableBiometricUnlock(res.biometricToken, me.user.username);
      setEnabled(true);
      setShowEnableForm(false);
      setTotp("");
      setDone("enabled");
    } catch (e2) {
      const code = e2 instanceof Error ? e2.message : "error";
      const map: Record<string, string> = {
        invalid_totp: "Código 2FA incorrecto",
        biometric_unavailable: "No hay biometría disponible en este dispositivo",
      };
      setErr(map[code] ?? `Error: ${code}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setErr(null);
    setBusy(true);
    setDone(null);
    try {
      await api("/auth/biometric/disable", { method: "POST", auth: true });
      await clearBiometricUnlock();
      setEnabled(false);
      setDone("disabled");
    } catch (e) {
      const code = e instanceof Error ? e.message : "error";
      setErr(`Error: ${code}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <Fingerprint className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="text-sm">
          <p className="font-medium text-foreground">Iniciar con huella o Face ID</p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            Solo en este dispositivo. La huella desbloquea un token guardado
            en el Keystore — el código 2FA sigue siendo necesario al iniciar
            sesión en otro dispositivo.
          </p>
        </div>
      </div>

      {done === "enabled" && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
          <CheckCircle2 size={14} />
          Biometría activada en este dispositivo.
        </div>
      )}
      {done === "disabled" && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          <CheckCircle2 size={14} />
          Biometría desactivada. Tendrás que ingresar 2FA al volver.
        </div>
      )}

      {err && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {err}
        </div>
      )}

      {!enabled && !showEnableForm && (
        <Button onClick={() => setShowEnableForm(true)} disabled={busy} className="w-full">
          <Fingerprint className="size-4" />
          Activar biometría
        </Button>
      )}

      {!enabled && showEnableForm && (
        <form onSubmit={handleEnable} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="bio-totp">
              Código 2FA actual (confirmamos que eres tú antes de activar)
            </Label>
            <Input
              id="bio-totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={totp}
              onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              required
              disabled={busy}
              autoFocus
              className="tracking-[0.3em] text-center font-mono text-base"
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => {
                setShowEnableForm(false);
                setTotp("");
                setErr(null);
              }}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || totp.length !== 6} className="flex-1">
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Activar"}
            </Button>
          </div>
        </form>
      )}

      {enabled && (
        <Button variant="outline" onClick={handleDisable} disabled={busy} className="w-full">
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Desactivar biometría"}
        </Button>
      )}
    </div>
  );
}
