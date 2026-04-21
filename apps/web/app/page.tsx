import Link from "next/link";
import { ArrowRight, Lock, MessageCircle, ShieldCheck, UserPlus } from "lucide-react";
import { Button } from "./components/ui/button";

export default function HomePage() {
  return (
    <main className="relative min-h-screen bg-hero">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
        <div className="flex flex-col items-center text-center">
          <div className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground glow-primary">
            <Lock className="size-7" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Euromex Chat
          </h1>
          <p className="mt-3 text-lg text-muted-foreground">
            Comunicación interna privada de Grupo Euromex
          </p>
          <div className="mt-5 flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1.5 text-sm text-muted-foreground">
            <ShieldCheck className="size-4 text-primary" />
            Cifrado de extremo a extremo
          </div>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          <Link
            href="/login"
            className="group rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/40 hover:bg-card/80"
          >
            <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <MessageCircle className="size-5" />
            </div>
            <h2 className="mb-1 text-lg font-semibold">Tengo cuenta</h2>
            <p className="text-sm text-muted-foreground">
              Iniciar sesión con usuario, contraseña y 2FA.
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
              Entrar
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>

          <Link
            href="/enroll"
            className="group rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/40 hover:bg-card/80"
          >
            <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UserPlus className="size-5" />
            </div>
            <h2 className="mb-1 text-lg font-semibold">Me invitaron</h2>
            <p className="text-sm text-muted-foreground">
              Tengo un código de invitación de un admin de Euromex.
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
              Crear cuenta
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        </div>

        <p className="mt-12 text-center text-xs text-muted-foreground">
          Acceso restringido. Los intentos de acceso quedan registrados.
        </p>
      </div>
    </main>
  );
}
