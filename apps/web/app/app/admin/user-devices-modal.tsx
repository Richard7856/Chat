"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  Monitor,
  Smartphone,
  ShieldOff,
  CheckCircle2,
  Clock,
} from "lucide-react";
import type { AdminDeviceItem } from "@euromex/shared";
import { api } from "../../lib/api";
import { isBiometricAvailable, verifyBiometric } from "../../lib/biometric";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { formatRelative } from "./admin-utils";

/**
 * Modal admin para inspeccionar y revocar los dispositivos de un usuario.
 *
 * Por qué existe (mayo 2026): si a un colaborador le roban el celular o
 * sospechamos filtración de credenciales, el admin necesita poder cortar
 * el acceso de ese device específico sin tener que deshabilitar al usuario
 * completo (lo cual revoca todos sus devices y le quita el acceso desde
 * las máquinas que sí controla).
 */
interface Props {
  user: { id: string; displayName: string; username: string } | null;
  onClose: () => void;
  onRevoked?: () => void;
}

function PlatformIcon({ platform }: { platform: AdminDeviceItem["platform"] }) {
  if (platform === "ios" || platform === "android") {
    return <Smartphone className="size-4 shrink-0 text-muted-foreground" />;
  }
  return <Monitor className="size-4 shrink-0 text-muted-foreground" />;
}

function StatusBadge({ status }: { status: AdminDeviceItem["status"] }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--accent-task-soft))] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--accent-task))]">
        <CheckCircle2 className="size-2.5" />
        activo
      </span>
    );
  }
  if (status === "revoked") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
        <ShieldOff className="size-2.5" />
        revocado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      <Clock className="size-2.5" />
      pendiente
    </span>
  );
}

/**
 * Resume el user_agent en algo legible (Chrome / Mac, Safari / iPhone).
 * Usamos heurística simple — si fallaa, devolvemos los primeros 50 chars.
 */
function summarizeUA(ua: string | null): string {
  if (!ua) return "(sin user agent)";
  const browser =
    /Edg\//.test(ua)
      ? "Edge"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const os =
    /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "Desconocido";
  return `${browser} · ${os}`;
}

export function UserDevicesModal({ user, onClose, onRevoked }: Props) {
  const [devices, setDevices] = useState<AdminDeviceItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<AdminDeviceItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ devices: AdminDeviceItem[] }>(
        `/admin/users/${user.id}/devices`,
        { method: "GET", auth: true },
      );
      setDevices(r.devices);
    } catch (err) {
      setError(err instanceof Error ? err.message : "error_loading");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) void refresh();
    else setDevices(null);
  }, [user, refresh]);

  async function handleRevoke(device: AdminDeviceItem) {
    setRevoking(device.id);
    setError(null);
    // Fase 27 — step-up biométrico en mobile. La acción es destructiva
    // (irreversible para la sesión activa del peer). En web no hay sensor
    // → proseguimos normal. Este step-up NO sustituye al check server-side
    // de admin role; es solo confirmación de presencia física.
    try {
      if (await isBiometricAvailable()) {
        const ok = await verifyBiometric(
          `Revocar el dispositivo "${device.deviceName}" de ${user?.displayName ?? "este usuario"}`,
        );
        if (!ok) {
          setError("Confirmación biométrica cancelada.");
          setRevoking(null);
          return;
        }
      }
      await api(`/admin/devices/${device.id}/revoke`, {
        method: "POST",
        auth: true,
        body: {},
      });
      setConfirmRevoke(null);
      await refresh();
      onRevoked?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "error_revoking");
    } finally {
      setRevoking(null);
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Dispositivos de{" "}
            <span className="text-primary">
              {user?.displayName ?? "?"}
            </span>{" "}
            <span className="text-sm font-normal text-muted-foreground">
              @{user?.username}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Cargando dispositivos…
            </div>
          )}

          {!loading && error && (
            <p className="py-6 text-center text-sm text-destructive">
              {error}
            </p>
          )}

          {!loading && devices && devices.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Este usuario no tiene dispositivos registrados.
            </p>
          )}

          {!loading && devices && devices.length > 0 && (
            <ul className="divide-y divide-border">
              {devices.map((d) => (
                <li
                  key={d.id}
                  className="flex items-start gap-3 py-3"
                >
                  <PlatformIcon platform={d.platform} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {d.deviceName}
                      </span>
                      <StatusBadge status={d.status} />
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {summarizeUA(d.userAgent)} · {d.platform}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                      <span>
                        Último acceso:{" "}
                        <span className="text-foreground/80">
                          {formatRelative(d.lastSeenAt)}
                        </span>
                      </span>
                      <span>
                        Alta:{" "}
                        <span className="text-foreground/80">
                          {new Date(d.createdAt).toLocaleDateString("es-MX", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </span>
                      </span>
                      {d.revokedAt && (
                        <span>
                          Revocado:{" "}
                          <span className="text-destructive/80">
                            {formatRelative(d.revokedAt)}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                  {d.status === "active" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setConfirmRevoke(d)}
                      disabled={revoking === d.id}
                    >
                      {revoking === d.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <ShieldOff className="size-3.5" />
                      )}
                      Revocar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Confirmación de revocación */}
      <Dialog
        open={!!confirmRevoke}
        onOpenChange={(open) => !open && setConfirmRevoke(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>¿Revocar dispositivo?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              Esto cerrará la sesión de{" "}
              <strong>{confirmRevoke?.deviceName}</strong> de inmediato. El
              usuario tendrá que hacer login completo desde ese dispositivo
              para volver a entrar.
            </p>
            <p className="text-xs text-muted-foreground">
              Recomendado si: el dispositivo se perdió, fue robado, o
              sospechas que la cuenta fue comprometida desde ahí.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmRevoke(null)}
              disabled={!!revoking}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmRevoke && handleRevoke(confirmRevoke)}
              disabled={!!revoking}
            >
              {revoking && <Loader2 className="size-4 animate-spin" />}
              Revocar acceso
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
