"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { AdminAuditLogItem } from "@euromex/shared";
import { api } from "../../lib/api";
import { Badge, type BadgeProps } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import { formatFull } from "./admin-utils";

const COMMON_ACTIONS = [
  "",
  "login.success",
  "login.failed",
  "login.totp_failed",
  "enroll.complete",
  "invitation.create",
  "admin.user.update",
  "admin.device.revoke",
  "admin.invitation.revoke",
  "attachment.downloaded",
  "password.reset",
  "logout",
];

function actionVariant(action: string): BadgeProps["variant"] {
  if (action.endsWith(".failed") || action.includes(".revoke")) {
    return "destructive";
  }
  if (action.endsWith(".success") || action.includes(".complete")) {
    return "success";
  }
  if (action.startsWith("admin.")) return "default";
  return "outline";
}

export function AuditTab({
  onError,
}: {
  onError: (e: string | null) => void;
}) {
  const [entries, setEntries] = useState<AdminAuditLogItem[]>([]);
  const [actionFilter, setActionFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: "200" });
      if (actionFilter) qs.set("action", actionFilter);
      const r = await api<{ entries: AdminAuditLogItem[] }>(
        `/admin/audit-log?${qs.toString()}`,
        { method: "GET", auth: true },
      );
      setEntries(r.entries);
    } catch (err) {
      onError(err instanceof Error ? err.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [actionFilter, onError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="action-filter">Filtrar por acción</Label>
            <select
              id="action-filter"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="flex h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {COMMON_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a || "(todas)"}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={refresh}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            Refrescar
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Fecha</th>
                <th className="px-4 py-3 text-left font-semibold">Usuario</th>
                <th className="px-4 py-3 text-left font-semibold">Acción</th>
                <th className="px-4 py-3 text-left font-semibold">Metadata</th>
                <th className="px-4 py-3 text-left font-semibold">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    <Loader2 className="mx-auto size-4 animate-spin" />
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-sm text-muted-foreground"
                  >
                    Sin eventos que mostrar.
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr
                    key={e.id}
                    className="transition-colors hover:bg-muted/30"
                  >
                    <td
                      className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground"
                      title={e.createdAt}
                    >
                      {formatFull(e.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      {e.username ? (
                        <span className="font-medium">@{e.username}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={actionVariant(e.action)}>
                        <span className="font-mono text-[11px]">
                          {e.action}
                        </span>
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <code className="block max-w-xl truncate rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
                        {JSON.stringify(e.metadata)}
                      </code>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {e.ip ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
