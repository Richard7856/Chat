"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileClock,
  Loader2,
  MessageSquare,
  Network,
  ShieldCheck,
  Ticket,
  Users as UsersIcon,
} from "lucide-react";
import { api, clearSession, loadSession } from "../../lib/api";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Avatar } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { UsersTab } from "./users-tab";
import { InvitationsTab } from "./invitations-tab";
import { AuditTab } from "./audit-tab";
import { OrgChartTab } from "./org-chart-tab";

type Tab = "users" | "invitations" | "audit" | "org";

interface MeResponse {
  user: {
    id: string;
    username: string;
    displayName: string;
    role: "user" | "admin";
  };
}

export default function AdminPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tab, setTab] = useState<Tab>("users");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!loadSession()) {
      router.replace("/login");
      return;
    }
    api<MeResponse>("/auth/me", { method: "GET", auth: true })
      .then((res) => {
        if (res.user.role !== "admin") {
          router.replace("/app");
          return;
        }
        setMe(res);
      })
      .catch(() => {
        clearSession();
        router.replace("/login");
      })
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">Cargando panel admin…</span>
        </div>
      </main>
    );
  }
  if (!me) return null;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-10">
        {/* Header */}
        <header className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Panel admin
              </h1>
              <p className="text-sm text-muted-foreground">
                Gestiona usuarios, invitaciones y auditoría de Euromex Chat.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 md:flex">
              <Avatar
                size="sm"
                username={me.user.username}
                displayName={me.user.displayName}
              />
              <div className="text-right">
                <div className="text-sm font-medium leading-tight">
                  {me.user.displayName}
                </div>
                <div className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
                  @{me.user.username}
                  <Badge variant="default" className="px-1.5 py-0 text-[10px]">
                    {me.user.role}
                  </Badge>
                </div>
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <a href="/app/chat">
                <MessageSquare />
                Chat
              </a>
            </Button>
          </div>
        </header>

        {/* Tabs */}
        <div className="mb-6 flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1 shadow-sm">
          <TabBtn
            active={tab === "users"}
            onClick={() => setTab("users")}
            icon={<UsersIcon className="size-4" />}
            label="Usuarios"
          />
          <TabBtn
            active={tab === "invitations"}
            onClick={() => setTab("invitations")}
            icon={<Ticket className="size-4" />}
            label="Invitaciones"
          />
          <TabBtn
            active={tab === "audit"}
            onClick={() => setTab("audit")}
            icon={<FileClock className="size-4" />}
            label="Audit log"
          />
          <TabBtn
            active={tab === "org"}
            onClick={() => setTab("org")}
            icon={<Network className="size-4" />}
            label="Organigrama"
          />
        </div>

        {/* Error global */}
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription className="flex items-center justify-between gap-3">
              <span>Error: {error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-xs font-medium opacity-70 hover:opacity-100"
              >
                cerrar
              </button>
            </AlertDescription>
          </Alert>
        )}

        {/* Tab content */}
        <section>
          {tab === "users" && (
            <UsersTab meId={me.user.id} onError={setError} />
          )}
          {tab === "invitations" && <InvitationsTab onError={setError} />}
          {tab === "audit" && <AuditTab onError={setError} />}
          {tab === "org" && <OrgChartTab onError={setError} />}
        </section>
      </div>
    </main>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}
