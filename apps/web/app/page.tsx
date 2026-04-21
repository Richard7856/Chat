import Link from "next/link";
import {
  ArrowRight,
  Bell,
  Building2,
  Eye,
  KeyRound,
  Lock,
  MessageSquare,
  Paperclip,
  ShieldCheck,
  Smartphone,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { Button } from "./components/ui/button";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background">
      {/* ===== Hero ===== */}
      <section className="relative overflow-hidden bg-hero">
        <div className="mx-auto max-w-4xl px-6 pb-12 pt-20 sm:pt-28">
          <div className="flex flex-col items-center text-center">
            <div className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground glow-primary">
              <Lock className="size-7" />
            </div>

            <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-card/50 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
              <Building2 className="size-3.5" />
              Uso exclusivo de Grupo Euromex
            </div>

            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              El chat privado de Grupo Euromex
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
              Un espacio seguro para hablar de proyectos, números e ideas
              dentro de la empresa — sin depender de WhatsApp ni servicios
              externos.
            </p>

            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg">
                <Link href="/login">
                  Iniciar sesión
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/enroll">
                  <UserPlus className="size-4" />
                  Tengo código de invitación
                </Link>
              </Button>
            </div>

            <p className="mt-6 flex items-center gap-1.5 text-sm text-muted-foreground">
              <ShieldCheck className="size-4 text-primary" />
              Cifrado de extremo a extremo · Acceso solo por invitación
            </p>
          </div>
        </div>
      </section>

      {/* ===== Features ===== */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            ¿Qué puedes hacer?
          </h2>
          <p className="mt-2 text-muted-foreground">
            Todo lo que esperas de un chat corporativo, sin las fugas de uno público.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FeatureCard
            icon={<MessageSquare className="size-5" />}
            title="Mensajes directos y grupos"
            desc="Chatea 1-a-1 con un colega o crea grupos por proyecto, equipo o tema."
          />
          <FeatureCard
            icon={<Paperclip className="size-5" />}
            title="Comparte archivos"
            desc="Envía PDFs, Excel, imágenes o código hasta 50 MB — todo cifrado antes de salir de tu dispositivo."
          />
          <FeatureCard
            icon={<Smartphone className="size-5" />}
            title="Úsalo como app"
            desc="Instálalo en tu iPhone, Android o computadora. Se ve y siente como una app nativa."
          />
          <FeatureCard
            icon={<Bell className="size-5" />}
            title="Mensajes en vivo"
            desc="Los mensajes y archivos llegan al instante a todos los dispositivos conectados."
          />
        </div>
      </section>

      {/* ===== Security ===== */}
      <section className="border-t border-border bg-card/30">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="mb-10 text-center">
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <ShieldCheck className="size-3.5" />
              Seguridad
            </div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Tu información está protegida
            </h2>
            <p className="mt-2 text-muted-foreground">
              Diseñado para que hables tranquilo de temas sensibles — contratos,
              números, estrategia.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SecurityCard
              icon={<Lock className="size-5" />}
              title="Cifrado de extremo a extremo"
              desc="Tus mensajes se cifran en tu dispositivo antes de salir. Solo los miembros de la conversación pueden leerlos — ni siquiera el servidor tiene las claves para abrirlos."
            />
            <SecurityCard
              icon={<KeyRound className="size-5" />}
              title="Autenticación en 2 pasos"
              desc="Para entrar necesitas tu contraseña y un código que rota cada 30 segundos en tu teléfono (Google Authenticator, Aegis, 1Password). Si te roban la contraseña, tampoco entran."
            />
            <SecurityCard
              icon={<UserCheck className="size-5" />}
              title="Solo por invitación"
              desc="No hay registro público. Un administrador de Euromex te invita personalmente. Cada dispositivo nuevo debe ser autorizado; si pierdes el teléfono, un admin lo revoca al instante."
            />
            <SecurityCard
              icon={<Eye className="size-5" />}
              title="Auditoría completa"
              desc="Cuando alguien descarga un archivo, queda avisado en el chat y registrado en los logs. Las capturas de pantalla llevan una marca con el nombre de quien las tomó."
            />
          </div>

          <div className="mt-10 rounded-xl border border-border bg-card p-6">
            <div className="flex items-start gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Building2 className="size-5" />
              </div>
              <div>
                <h3 className="font-semibold">Hosted en infraestructura de Euromex</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  El chat corre en servidores que controla directamente Grupo Euromex
                  — no en Google, WhatsApp ni otra empresa externa. Los respaldos
                  se guardan cifrados diariamente. Nadie fuera de Euromex tiene
                  acceso a la conversación ni aunque lo pidan.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== CTA bottom ===== */}
      <section className="mx-auto max-w-4xl px-6 py-16">
        <div className="rounded-2xl border border-border bg-card p-8 text-center sm:p-12">
          <h2 className="text-2xl font-semibold tracking-tight">
            ¿Listo para entrar?
          </h2>
          <p className="mx-auto mt-2 max-w-md text-muted-foreground">
            Si ya tienes cuenta, entra. Si un admin te compartió un código,
            úsalo para crear tu perfil.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/login">
                Iniciar sesión
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/enroll">
                <UserPlus className="size-4" />
                Tengo invitación
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ===== Footer ===== */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-6 py-6 text-xs text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-1.5">
            <Lock className="size-3.5" />
            Euromex Chat · Sistema interno de Grupo Euromex
          </div>
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-primary" />
            Los intentos de acceso quedan registrados
          </div>
        </div>
      </footer>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/30">
      <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        {desc}
      </p>
    </div>
  );
}

function SecurityCard({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-start gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="flex-1">
          <h3 className="font-semibold">{title}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {desc}
          </p>
        </div>
      </div>
    </div>
  );
}
