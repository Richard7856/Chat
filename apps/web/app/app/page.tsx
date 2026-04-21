"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  LogOut,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  UserCog,
} from "lucide-react";
import { api, clearSession, loadSession } from "../lib/api";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";

interface MeResponse {
  user: {
    id: string;
    username: string;
    displayName: string;
    email: string | null;
    role: "user" | "admin";
  };
  device: {
    id: string;
    deviceName: string;
    platform: "web" | "ios" | "android" | "desktop";
    lastSeenAt: string | null;
  };
}

export default function AppHome() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loadSession()) {
      router.replace("/login");
      return;
    }
    api<MeResponse>("/auth/me", { method: "GET", auth: true })
      .then(setMe)
      .catch((err) => {
        setError(err instanceof Error ? err.message : "error");
        clearSession();
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function onLogout() {
    try {
      await api("/auth/logout", { method: "POST", auth: true });
    } catch {}
    clearSession();
    router.replace("/login");
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-hero">
        <p className="text-sm text-muted-foreground">Cargando sesión…</p>
      </main>
    );
  }

  if (error || !me) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-hero px-6">
        <div className="mx-auto w-full max-w-md text-center">
          <h1 className="text-2xl font-bold">Sesión inválida</h1>
          <Alert variant="destructive" className="mt-4 text-left">
            <AlertDescription>{error ?? "No autenticado."}</AlertDescription>
          </Alert>
          <Button asChild className="mt-4">
            <Link href="/login">Volver a iniciar sesión</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-6 py-10">
        {/* Top bar */}
        <header className="mb-10 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Hola, {me.user.displayName}
            </h1>
            <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              @{me.user.username}
              <Badge variant={me.user.role === "admin" ? "default" : "secondary"}>
                {me.user.role}
              </Badge>
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onLogout}>
            <LogOut className="size-4" />
            Cerrar sesión
          </Button>
        </header>

        {/* Session card */}
        <section className="mb-6 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="size-4 text-primary" />
            Sesión activa
          </div>
          <div className="mt-2 text-sm">
            <span className="font-medium">{me.device.deviceName}</span>
            <span className="text-muted-foreground"> · {me.device.platform}</span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Último acceso:{" "}
            {me.device.lastSeenAt
              ? new Date(me.device.lastSeenAt).toLocaleString()
              : "ahora"}
          </div>
        </section>

        {/* Action cards */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            href="/app/chat"
            className="group rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/40 hover:bg-card/80"
          >
            <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <MessageCircle className="size-5" />
            </div>
            <h2 className="mb-1 text-lg font-semibold">Abrir chat</h2>
            <p className="text-sm text-muted-foreground">
              Mensajería 1-a-1 y grupos, con adjuntos cifrados.
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
              Entrar
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>

          {me.user.role === "admin" && (
            <Link
              href="/app/admin"
              className="group rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/40 hover:bg-card/80"
            >
              <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <UserCog className="size-5" />
              </div>
              <h2 className="mb-1 text-lg font-semibold">Panel admin</h2>
              <p className="text-sm text-muted-foreground">
                Usuarios, invitaciones y audit log del sistema.
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                Gestionar
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          )}
        </div>

        <p className="mt-10 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="size-3" />
          Todos los mensajes y archivos van cifrados de extremo a extremo
        </p>
      </div>
    </main>
  );
}
