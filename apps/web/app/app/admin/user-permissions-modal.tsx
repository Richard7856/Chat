"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  Download,
  Camera,
  Users,
  UserPlus,
  Phone,
  Paperclip,
  ShieldCheck,
} from "lucide-react";
import type { AdminUserListItem, UserPermissions } from "@euromex/shared";
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

/**
 * Modal admin para gestionar permisos granulares (Fase 24) de un usuario.
 *
 * Defaults conservadores en BD (ver migration 011): la mayoría de
 * usuarios pueden descargar y crear grupos, pero NO compartir
 * externamente ni invitar gente. El admin acá puede subir o bajar
 * cualquier flag, con efecto inmediato en el server (próximo request).
 *
 * Para que el cliente del usuario afectado vea el cambio en su UI
 * (botones ocultos, watermark intensa), debe re-loguearse o esperar
 * a que la sesión expire — la sesión guardada en localStorage trae
 * el snapshot de permisos del momento del login.
 */
interface Props {
  user: AdminUserListItem | null;
  onClose: () => void;
  onSaved: () => void;
}

interface PermissionToggleProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

function PermissionToggle({
  icon,
  label,
  description,
  value,
  onChange,
  disabled,
}: PermissionToggleProps) {
  return (
    <label
      className={[
        "flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer transition-colors",
        value ? "bg-primary/5 border-primary/30" : "hover:bg-muted/40",
        disabled ? "opacity-60 cursor-not-allowed" : "",
      ].join(" ")}
    >
      <span
        className={[
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
          value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        ].join(" ")}
      >
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{label}</span>
          <input
            type="checkbox"
            checked={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
            className="size-4 accent-primary"
          />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </label>
  );
}

export function UserPermissionsModal({ user, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<UserPermissions | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resetea el draft cuando cambia el usuario
  useEffect(() => {
    if (user) setDraft({ ...user.permissions });
    else setDraft(null);
  }, [user]);

  if (!user || !draft) return null;

  const isAdmin = user.role === "admin";

  async function save() {
    if (!user || !draft) return;
    setSaving(true);
    setError(null);
    try {
      // Solo enviamos los flags que cambiaron — admin.ts hace audit log
      // del patch completo, así que mantener el diff estrecho ayuda a
      // leer el log después.
      const patch: Partial<UserPermissions> = {};
      const orig = user.permissions;
      if (draft.canDownloadAttachments !== orig.canDownloadAttachments)
        patch.canDownloadAttachments = draft.canDownloadAttachments;
      if (draft.canShareExternally !== orig.canShareExternally)
        patch.canShareExternally = draft.canShareExternally;
      if (draft.canCreateGroups !== orig.canCreateGroups)
        patch.canCreateGroups = draft.canCreateGroups;
      if (draft.canInviteUsers !== orig.canInviteUsers)
        patch.canInviteUsers = draft.canInviteUsers;
      if (draft.canInitiateCalls !== orig.canInitiateCalls)
        patch.canInitiateCalls = draft.canInitiateCalls;
      if (draft.maxAttachmentMb !== orig.maxAttachmentMb)
        patch.maxAttachmentMb = draft.maxAttachmentMb;

      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }

      await api(`/admin/users/${user.id}`, {
        method: "PATCH",
        auth: true,
        body: patch,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save_failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Permisos de{" "}
            <span className="text-primary">{user.displayName}</span>{" "}
            <span className="text-sm font-normal text-muted-foreground">
              @{user.username}
            </span>
          </DialogTitle>
        </DialogHeader>

        {isAdmin && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <strong>Nota:</strong> este usuario es <em>admin</em>. Los admins
            pueden saltarse algunos límites desde el código aún si los
            permisos están apagados. Considera bajar primero el rol a "user"
            si quieres restricción real.
          </div>
        )}

        <div className="space-y-2">
          <PermissionToggle
            icon={<Download className="size-3.5" />}
            label="Descargar archivos"
            description="Si está apagado, el usuario no puede bajar adjuntos a su disco. El server bloquea la descarga."
            value={draft.canDownloadAttachments}
            onChange={(v) =>
              setDraft({ ...draft, canDownloadAttachments: v })
            }
            disabled={saving}
          />

          <PermissionToggle
            icon={<Camera className="size-3.5" />}
            label="Compartir externamente"
            description="Cuando está apagado, la marca de agua se intensifica para añadir fricción a screenshots. (En APK Android: bloqueo total con FLAG_SECURE — Fase 23.)"
            value={draft.canShareExternally}
            onChange={(v) => setDraft({ ...draft, canShareExternally: v })}
            disabled={saving}
          />

          <PermissionToggle
            icon={<Users className="size-3.5" />}
            label="Crear grupos"
            description="Permite crear conversaciones tipo grupo. Si está apagado, solo puede tener DMs."
            value={draft.canCreateGroups}
            onChange={(v) => setDraft({ ...draft, canCreateGroups: v })}
            disabled={saving}
          />

          <PermissionToggle
            icon={<UserPlus className="size-3.5" />}
            label="Invitar usuarios"
            description="Permite generar códigos de invitación. Default: solo admins."
            value={draft.canInviteUsers}
            onChange={(v) => setDraft({ ...draft, canInviteUsers: v })}
            disabled={saving}
          />

          <PermissionToggle
            icon={<Phone className="size-3.5" />}
            label="Iniciar llamadas"
            description="Permite iniciar llamadas de voz internas. (Fase 22 — todavía no implementado.)"
            value={draft.canInitiateCalls}
            onChange={(v) => setDraft({ ...draft, canInitiateCalls: v })}
            disabled={saving}
          />

          {/* Límite de tamaño de archivo */}
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Paperclip className="size-3.5" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    Máximo por archivo
                  </span>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={1}
                      max={500}
                      value={draft.maxAttachmentMb}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n >= 1 && n <= 500) {
                          setDraft({ ...draft, maxAttachmentMb: n });
                        }
                      }}
                      disabled={saving}
                      className="h-7 w-20 text-right text-sm"
                    />
                    <span className="text-xs text-muted-foreground">MB</span>
                  </div>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Tamaño máximo por upload. Default: 50 MB. El server rechaza
                  archivos más grandes con 413.
                </p>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            <ShieldCheck className="size-4" />
            Guardar permisos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
