"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Users } from "lucide-react";
import type { AdminUserListItem } from "@euromex/shared";
import { api } from "../../lib/api";
import { Avatar } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";

// ============================================================================
// Tipos internos
// ============================================================================

interface OrgNode {
  user: AdminUserListItem;
  reports: OrgNode[]; // reportes directos
}

// ============================================================================
// Construcción del árbol desde la lista plana de usuarios
//
// Por qué cliente y no un endpoint específico: la lista `/admin/users` ya
// trae `managerUserId` para todos los usuarios. Construir el árbol en el
// cliente evita añadir un endpoint más y mantiene el modelo simple.
// ============================================================================
function buildTree(users: AdminUserListItem[]): OrgNode[] {
  const nodeMap = new Map<string, OrgNode>();

  // Primer pase: crear nodos
  for (const u of users) {
    nodeMap.set(u.id, { user: u, reports: [] });
  }

  const roots: OrgNode[] = [];

  // Segundo pase: enlazar hijos al padre
  for (const u of users) {
    const node = nodeMap.get(u.id)!;
    if (u.managerUserId && nodeMap.has(u.managerUserId)) {
      nodeMap.get(u.managerUserId)!.reports.push(node);
    } else {
      // Sin manager registrado → nodo raíz
      roots.push(node);
    }
  }

  // Orden estable: primero por department, luego por displayName
  function sortNodes(nodes: OrgNode[]) {
    nodes.sort((a, b) => {
      const da = a.user.department ?? "";
      const db = b.user.department ?? "";
      if (da !== db) return da.localeCompare(db, "es");
      return a.user.displayName.localeCompare(b.user.displayName, "es");
    });
    for (const n of nodes) sortNodes(n.reports);
  }
  sortNodes(roots);

  return roots;
}

// ============================================================================
// Componente principal
// ============================================================================

export function OrgChartTab({ onError }: { onError: (e: string | null) => void }) {
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ users: AdminUserListItem[] }>("/admin/users", {
        method: "GET",
        auth: true,
      });
      setUsers(r.users);
    } catch (err) {
      onError(err instanceof Error ? err.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span className="ml-2 text-sm">Cargando organigrama…</span>
      </div>
    );
  }

  const activeUsers = users.filter((u) => u.status === "active");
  const tree = buildTree(activeUsers);
  const totalWithoutProfile = activeUsers.filter(
    (u) => !u.jobTitle && !u.department,
  ).length;

  return (
    <div className="space-y-4">
      {/* Resumen */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm shadow-sm">
        <Users className="size-4 text-muted-foreground" />
        <span className="text-muted-foreground">
          {activeUsers.length} usuario{activeUsers.length !== 1 ? "s" : ""} activo
          {activeUsers.length !== 1 ? "s" : ""}
        </span>
        {totalWithoutProfile > 0 && (
          <span className="text-xs text-muted-foreground/70">
            ·{" "}
            <span className="text-amber-500 dark:text-amber-400">
              {totalWithoutProfile} sin cargo/dpto asignado
            </span>{" "}
            — edítalos en la pestaña Usuarios
          </span>
        )}
      </div>

      {/* Árbol */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm md:p-6">
        {tree.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No hay usuarios activos.
          </p>
        ) : (
          <ul className="space-y-1">
            {tree.map((node) => (
              <TreeNode key={node.user.id} node={node} depth={0} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Nodo recursivo del árbol
// ============================================================================

function TreeNode({ node, depth }: { node: OrgNode; depth: number }) {
  const { user, reports } = node;
  const hasReports = reports.length > 0;

  return (
    <li>
      {/* Tarjeta del usuario */}
      <div
        className={[
          "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/40",
          depth > 0 ? "ml-6 border-l-2 border-border pl-4" : "",
        ].join(" ")}
      >
        <Avatar size="sm" username={user.username} displayName={user.displayName} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium leading-tight">
              {user.displayName}
            </span>
            {user.department && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {user.department}
              </span>
            )}
            {user.role === "admin" && (
              <Badge variant="default" className="px-1.5 py-0 text-[10px]">
                admin
              </Badge>
            )}
          </div>
          {user.jobTitle && (
            <p className="mt-0.5 text-xs text-muted-foreground">{user.jobTitle}</p>
          )}
          {!user.jobTitle && !user.department && (
            <p className="mt-0.5 text-xs text-muted-foreground/50 italic">
              Sin cargo asignado
            </p>
          )}
        </div>

        {hasReports && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {reports.length} reporte{reports.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Reportes directos — recursión */}
      {hasReports && (
        <ul className="mt-1 space-y-1">
          {reports.map((child) => (
            <TreeNode key={child.user.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
