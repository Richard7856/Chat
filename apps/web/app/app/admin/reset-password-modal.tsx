"use client";

import { useEffect, useState } from "react";
import { Loader2, KeyRound, Copy, Check, AlertTriangle } from "lucide-react";
import type {
  AdminResetPasswordResponse,
  AdminUserListItem,
} from "@euromex/shared";
import { api } from "../../lib/api";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";

/**
 * Modal admin para resetear la password de un user que la perdió.
 *
 * Flujo en dos estados:
 *   1. Form — el admin escribe su propio TOTP de 6 dígitos como segundo
 *      factor obligatorio. Sin TOTP, sesión robada ≠ password takeover.
 *   2. Resultado — server devolvió la temp password. Se muestra UNA SOLA VEZ
 *      con botón "Copiar". El admin la envía al user por canal seguro.
 *
 * Side-effects servidor (Fase 30 / ADR-039):
 *   - users.password_hash = hash(temp)
 *   - users.must_change_password = true
 *   - Todos los devices activos del target user → status='revoked'
 *   - audit_log: 'admin.password.reset' con count de devices revocados
 */
interface Props {
  user: AdminUserListItem | null;
  onClose: () => void;
}

export function ResetPasswordModal({ user, onClose }: Props) {
  const [adminTotpToken, setAdminTotpToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdminResetPasswordResponse | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset el state cada vez que se abre el modal con un user distinto.
  useEffect(() => {
    if (user) {
      setAdminTotpToken("");
      setError(null);
      setResult(null);
      setCopied(false);
    }
  }, [user]);

  if (!user) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await api<AdminResetPasswordResponse>(
        `/admin/users/${user.id}/reset-password`,
        {
          method: "POST",
          body: { adminTotpToken },
          auth: true,
        },
      );
      setResult(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      // Mensajes más amigables que el código crudo del API
      if (msg.includes("invalid_totp")) {
        setError("TOTP incorrecto. Verifica el código de tu authenticator.");
      } else if (msg.includes("cannot_reset_self")) {
        setError("No puedes resetear tu propia password. Usa Settings → Cambiar contraseña.");
      } else if (msg.includes("user_not_found")) {
        setError("El usuario ya no existe.");
      } else {
        setError("No se pudo resetear la password. Intenta de nuevo.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function copyToClipboard() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback silencioso — el admin puede seleccionar y copiar manualmente
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            Restablecer contraseña
          </DialogTitle>
        </DialogHeader>

        {/* ─── Estado 1: pedir TOTP del admin ─────────────────────────────── */}
        {!result && (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <p className="font-medium">
                {user.displayName}{" "}
                <span className="text-muted-foreground">(@{user.username})</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Al confirmar: se genera una password temporal, se revocan TODAS sus
                sesiones activas, y el usuario será obligado a cambiarla al entrar.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="admin-totp">Tu código 2FA (6 dígitos)</Label>
              <Input
                id="admin-totp"
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoComplete="one-time-code"
                value={adminTotpToken}
                onChange={(e) => setAdminTotpToken(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                disabled={submitting}
                required
              />
              <p className="text-xs text-muted-foreground">
                Confirmación de tu identidad — segundo factor obligatorio para acciones destructivas.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting || adminTotpToken.length !== 6}>
                {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                Generar password temporal
              </Button>
            </DialogFooter>
          </form>
        )}

        {/* ─── Estado 2: mostrar password generada UNA SOLA VEZ ───────────── */}
        {result && (
          <div className="space-y-4">
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium text-amber-900 dark:text-amber-200">
                Esta password se muestra UNA SOLA VEZ
              </p>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                Cópiala ahora. Si cierras este modal sin copiarla, tendrás que generar otra.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Password temporal para @{result.user.username}</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-base tracking-wider">
                  {result.tempPassword}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={copyToClipboard}
                  title="Copiar al portapapeles"
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                </Button>
              </div>
            </div>

            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1.5">
              <p>
                <strong className="text-foreground">Próximos pasos:</strong>
              </p>
              <ol className="ml-4 list-decimal space-y-1">
                <li>Envíale la password al usuario por canal seguro (correo, en persona, etc).</li>
                <li>El usuario entra con esa password + su TOTP de siempre.</li>
                <li>El sistema lo obliga a elegir una nueva password antes de continuar.</li>
              </ol>
              {result.revokedDevices > 0 && (
                <p className="pt-2 text-foreground">
                  ⚠️ {result.revokedDevices} sesión(es) activa(s) fueron revocadas.
                </p>
              )}
            </div>

            <DialogFooter>
              <Button onClick={onClose}>Cerrar</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
