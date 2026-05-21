"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  Database,
  Eye,
  EyeOff,
  Fingerprint,
  Headphones,
  Key,
  Lock,
  Pause,
  Play,
  Server,
  Shield,
  ShieldCheck,
  Square,
  UserCog,
} from "lucide-react";

/**
 * Página pública /seguridad — explicación visual + auditiva de las medidas
 * de seguridad y privacidad de la plataforma Euromex Chat.
 *
 * No requiere login (sirve como material para compartir con stakeholders,
 * nuevos usuarios, auditorías internas, etc.).
 *
 * TTS: usa Web Speech API (window.speechSynthesis) — gratis, sin servidor,
 * voz nativa del SO en español. Cada sección tiene su botón individual y hay
 * un "Reproducir todo" arriba que encadena todas las secciones.
 *
 * Fallback: si el navegador no expone speechSynthesis (raro pero posible en
 * iOS WebView muy antiguo), mostramos un banner avisando que solo está
 * disponible el contenido visual. El layout sigue 100% accesible.
 */

interface Section {
  id: string;
  icon: typeof Shield;
  title: string;
  /** Texto narrado — sin emojis ni símbolos que confundan al TTS. */
  narration: string;
  /** Contenido visual; puede tener más detalle/formato que la narración. */
  bullets: string[];
}

const SECTIONS: Section[] = [
  {
    id: "e2ee",
    icon: Lock,
    title: "Cifrado de extremo a extremo",
    narration:
      "Todos los mensajes se cifran en tu dispositivo antes de salir hacia el servidor. Usamos NaCl crypto box, un algoritmo de cifrado moderno basado en Curve veinticinco cinco diecinueve. Ni siquiera el servidor puede leer el contenido de tus mensajes. La clave privada que descifra tus mensajes vive únicamente en tu dispositivo y nunca se transmite. Para cada destinatario, el mensaje se cifra individualmente con su clave pública.",
    bullets: [
      "Mensajes cifrados con NaCl crypto_box (Curve25519 + XSalsa20 + Poly1305)",
      "La clave privada nunca sale de tu dispositivo",
      "El servidor solo ve los mensajes cifrados, jamás el contenido en claro",
      "Cifrado por destinatario: cada device recibe su propio envelope cifrado",
    ],
  },
  {
    id: "attachments",
    icon: Shield,
    title: "Adjuntos protegidos",
    narration:
      "Los archivos también se cifran antes de subirse al servidor, usando AES doscientos cincuenta y seis GCM, el mismo cifrado que usan gobiernos y bancos. Solo los dispositivos autorizados pueden descifrarlos. Para adjuntos restringidos, podemos limitar quién puede descargar incluso dentro de una conversación. Si un administrador comparte un documento confidencial con cinco personas, solo esas cinco personas tendrán la clave para abrirlo.",
    bullets: [
      "AES-256-GCM para archivos (estándar industrial)",
      "Clave de archivo embebida en el mensaje cifrado",
      "Adjuntos restringidos: subset de la conversación con acceso a la clave",
      "El blob en el servidor es inútil sin la clave del cliente",
    ],
  },
  {
    id: "auth",
    icon: Key,
    title: "Autenticación de doble factor",
    narration:
      "Para entrar a tu cuenta necesitas tres cosas: tu usuario, tu contraseña, y un código de seis dígitos generado por una aplicación autenticadora como Google Authenticator o Authy. Sin el segundo factor, ni siquiera con tu contraseña pueden entrar a tu cuenta. Tu contraseña se almacena cifrada con Argon dos i d, el estándar más moderno de hashing recomendado por el N I S T.",
    bullets: [
      "Password obligatoria de mínimo 12 caracteres",
      "TOTP de 6 dígitos obligatorio (Google Authenticator, Authy, etc.)",
      "Hashing con Argon2id (resistente a GPU brute force)",
      "JWT firmados con secreto de servidor, expiración 8 horas",
    ],
  },
  {
    id: "biometric",
    icon: Fingerprint,
    title: "Biometría opcional",
    narration:
      "En dispositivos móviles puedes activar el desbloqueo con huella digital o reconocimiento facial. Esto te permite entrar más rápido sin escribir tu código de seis dígitos cada vez. La huella nunca sale de tu dispositivo. El servidor solo emite un token cifrado que se guarda en el Keystore del teléfono y solo puede usarse si pasas el desbloqueo biométrico. Si pierdes el teléfono, el token expira y queda inservible.",
    bullets: [
      "Touch ID, Face ID, huella Android — opcional, opt-in por dispositivo",
      "La huella nunca se transmite al servidor",
      "Token biométrico vive en Keystore (Android) / Keychain (iOS)",
      "Validación de fingerprint contra el device que lo activó",
      "Revocación instantánea desde el panel admin",
    ],
  },
  {
    id: "anti-screenshot",
    icon: Camera,
    title: "Anti-capturas de pantalla",
    narration:
      "En las versiones Android y de escritorio bloqueamos las capturas de pantalla a nivel sistema operativo. Si intentas tomar una foto de tu pantalla mientras tienes el chat abierto, el sistema muestra una pantalla en negro. Adicionalmente, todas las pantallas tienen una marca de agua semitransparente con tu nombre de usuario y la fecha exacta. Si por algún medio se filtra una imagen, sabemos identificar al responsable.",
    bullets: [
      "Android: FLAG_SECURE bloquea screenshots a nivel OS",
      "Desktop (Electron): setContentProtection bloquea Quartz/DWM",
      "Watermark visible en pantalla con username + timestamp UTC",
      "Identificación forense si una captura se filtra externamente",
      "iOS no permite bloqueo OS-level — el watermark es la defensa principal",
    ],
  },
  {
    id: "audit",
    icon: Eye,
    title: "Auditoría completa",
    narration:
      "Cada acción importante se registra: cuándo entraste, desde qué dispositivo, qué cambios hiciste, qué archivos descargaste. Los administradores pueden ver este registro en cualquier momento. Esto no es para vigilarte, sino para detectar comportamiento sospechoso y proteger a todos. Si algún día alguien intenta entrar a tu cuenta sin autorización, los administradores verán el intento.",
    bullets: [
      "Audit log de logins exitosos y fallidos",
      "Registro de cambios de password, rotaciones de TOTP, biometric enables",
      "Acciones de admins también auditadas (revoca, reset, permisos)",
      "Cada evento incluye IP + User-Agent + timestamp",
      "Filtrable por usuario, acción, rango de fechas en el panel admin",
    ],
  },
  {
    id: "recovery",
    icon: Key,
    title: "Recuperación segura de contraseña",
    narration:
      "Si olvidas tu contraseña hay dos caminos. El primero es por ti mismo, usando tu código de seis dígitos del autenticador, puedes cambiar la contraseña en cualquier momento. El segundo es a través de un administrador, que también requiere su propio código para autorizar el cambio. En ambos casos queda registro de quién hizo el cambio, cuándo y desde dónde. Si pierdes también el teléfono del autenticador, solo un administrador puede restaurarte el acceso.",
    bullets: [
      "Self-service: cambia tu password con tu propio TOTP, sin intervención",
      "Admin reset: el admin genera una password temporal con su TOTP",
      "Cambio forzado tras admin reset: la temp no queda como definitiva",
      "Revocación automática de todas las sesiones al cambiar password",
      "Cada reset queda en audit log visible para admins",
    ],
  },
  {
    id: "admin",
    icon: UserCog,
    title: "Control administrativo granular",
    narration:
      "Los administradores pueden revocar dispositivos al instante, por ejemplo si pierdes tu teléfono, cambiar permisos de usuarios, ver el registro de auditoría, y resetear contraseñas. También pueden definir permisos granulares por usuario: quién puede descargar adjuntos, quién puede compartir externamente, quién puede crear grupos. Todo esto se decide por cada usuario individualmente.",
    bullets: [
      "Revocación inmediata de devices comprometidos",
      "6 permisos granulares por usuario (descarga, share, grupos, invite, llamadas, tamaño máximo)",
      "Reset de password con audit + revocación de sesiones",
      "Edición de perfil (display name, cargo, depto, jefe directo)",
      "Visibilidad total del organigrama y movimientos",
    ],
  },
  {
    id: "self-hosted",
    icon: Server,
    title: "Servidor propio, no nube pública",
    narration:
      "A diferencia de WhatsApp, Telegram, o Slack, esta plataforma se hospeda en un servidor propio de Grupo Euromex. No usamos servicios públicos en la nube. Esto significa que ninguna empresa externa tiene acceso a los datos del chat. El servidor está protegido con H T T P S forzado, política de seguridad de contenido estricta, y rate limiting para prevenir ataques de fuerza bruta.",
    bullets: [
      "VPS propio, no Slack/Teams/WhatsApp",
      "HTTPS obligatorio con certificado Let's Encrypt renovado automáticamente",
      "HSTS forzado: el browser solo se conecta vía HTTPS",
      "Content Security Policy estricta — bloquea inyecciones",
      "Rate limiting 300 requests/minuto/IP",
    ],
  },
  {
    id: "backups",
    icon: Database,
    title: "Respaldos cifrados",
    narration:
      "Cada día a las tres de la mañana se hacen respaldos automáticos de la base de datos. Estos respaldos están cifrados con AES doscientos cincuenta y seis usando GPG, y solo se pueden abrir con una llave maestra que solo el administrador del sistema conoce. Si algún día el servidor fallara, podemos restaurar todo desde un respaldo.",
    bullets: [
      "Backup diario automático a las 3:00 UTC",
      "Cifrado simétrico GPG con AES-256",
      "Passphrase guardada exclusivamente en /etc/euromex/backup.env",
      "Sin la passphrase, los backups son ilegibles incluso para nosotros",
      "Restore procedure documentado en HOSTINGER.md",
    ],
  },
  {
    id: "what-we-dont-store",
    icon: EyeOff,
    title: "Lo que NO almacenamos",
    narration:
      "El servidor nunca tiene acceso a: el contenido de tus mensajes en texto plano, las claves de cifrado de tus archivos excepto las que están cifradas para los destinatarios, tu huella digital o cara, ni cualquier dato que no haya sido cifrado por ti antes de subir.",
    bullets: [
      "Mensajes en plaintext — solo los devices destinatarios los descifran",
      "Tu huella o cara — viven en tu dispositivo, jamás en el servidor",
      "Claves privadas E2EE — solo en tu localStorage",
      "El servidor solo persiste lo que está cifrado o es metadata mínima",
    ],
  },
  {
    id: "limitations",
    icon: AlertTriangle,
    title: "Limitaciones honestas",
    narration:
      "Para ser totalmente transparentes: si pierdes tu dispositivo y no tienes ningún otro, los mensajes históricos pueden quedar ilegibles, porque solo tu dispositivo tiene las claves para descifrarlos. Esta plataforma no incluye llamadas de voz o video. La marca de agua puede ayudarnos a identificar fugas, pero no impide tomarle foto a la pantalla con otro teléfono.",
    bullets: [
      "Sin device backup: historial puede quedar ilegible",
      "Sin llamadas voz/video (no implementado por decisión de scope)",
      "Sin forward secrecy completa (device comprometido lee mensajes pasados que tenía)",
      "El watermark identifica pero no impide capturas con cámara externa",
      "iOS no bloquea screenshots — solo Android y Desktop",
    ],
  },
];

// ─── Hook TTS ───────────────────────────────────────────────────────────────

type Status = "idle" | "playing" | "paused";

/**
 * Wrapper alrededor de window.speechSynthesis. Maneja:
 * - Selección de voz en español (es-MX preferido, fallback a es-ES o cualquier es-*)
 * - Cancelación de utterance previo cuando se inicia uno nuevo (no overlap)
 * - Tracking de qué sección está sonando para resaltarla visualmente
 * - Cola para "Reproducir todo" — encadena utterances secuencialmente
 * - Cleanup al unmount (cancela TTS pendiente)
 */
function useTextToSpeech() {
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [activeId, setActiveId] = useState<string | null>(null);
  const queueRef = useRef<Array<{ id: string; text: string }>>([]);
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      setSupported(true);
    }
    return () => {
      // Cleanup: cancela cualquier TTS pendiente cuando el componente se desmonta
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const pickSpanishVoice = useCallback((): SpeechSynthesisVoice | null => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return null;
    // Preferencia: es-MX > es-ES > cualquier es-*
    return (
      voices.find((v) => v.lang === "es-MX") ??
      voices.find((v) => v.lang === "es-ES") ??
      voices.find((v) => v.lang.startsWith("es")) ??
      null
    );
  }, []);

  const playNext = useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) {
      setStatus("idle");
      setActiveId(null);
      return;
    }

    const utter = new SpeechSynthesisUtterance(next.text);
    utter.lang = "es-MX";
    utter.rate = 1.0;
    utter.pitch = 1.0;
    const voice = pickSpanishVoice();
    if (voice) utter.voice = voice;

    utter.onstart = () => {
      setStatus("playing");
      setActiveId(next.id);
    };
    utter.onend = () => {
      currentUtteranceRef.current = null;
      // Si hay más en la cola, continuar
      playNext();
    };
    utter.onerror = () => {
      currentUtteranceRef.current = null;
      setStatus("idle");
      setActiveId(null);
      queueRef.current = [];
    };

    currentUtteranceRef.current = utter;
    window.speechSynthesis.speak(utter);
  }, [pickSpanishVoice]);

  const play = useCallback(
    (items: Array<{ id: string; text: string }>) => {
      if (!supported) return;
      // Cancelar cualquier TTS en curso antes de empezar el nuevo
      window.speechSynthesis.cancel();
      queueRef.current = [...items];
      playNext();
    },
    [supported, playNext],
  );

  const pause = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.pause();
    setStatus("paused");
  }, [supported]);

  const resume = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.resume();
    setStatus("playing");
  }, [supported]);

  const stop = useCallback(() => {
    if (!supported) return;
    queueRef.current = [];
    window.speechSynthesis.cancel();
    setStatus("idle");
    setActiveId(null);
  }, [supported]);

  return { supported, status, activeId, play, pause, resume, stop };
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function SeguridadPage() {
  const tts = useTextToSpeech();
  const [voicesReady, setVoicesReady] = useState(false);

  // Algunas plataformas (Chrome) cargan voices async; esperamos al onvoiceschanged
  useEffect(() => {
    if (!tts.supported) return;
    const checkVoices = () => {
      if (window.speechSynthesis.getVoices().length > 0) setVoicesReady(true);
    };
    checkVoices();
    window.speechSynthesis.onvoiceschanged = checkVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [tts.supported]);

  const playAll = useCallback(() => {
    tts.play(SECTIONS.map((s) => ({ id: s.id, text: `${s.title}. ${s.narration}` })));
  }, [tts]);

  const playOne = useCallback(
    (section: Section) => {
      tts.play([{ id: section.id, text: `${section.title}. ${section.narration}` }]);
    },
    [tts],
  );

  return (
    <div className="min-h-screen bg-background">
      {/* ─── Header / Hero ───────────────────────────────────────────────── */}
      <header className="border-b border-border bg-gradient-to-b from-primary/5 to-background">
        <div className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ShieldCheck className="size-7" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Grupo Euromex
              </p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Seguridad y privacidad
              </h1>
            </div>
          </div>

          <p className="mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg">
            Esta plataforma de chat fue construida desde cero con un solo objetivo:
            que las comunicaciones internas de Grupo Euromex sean privadas, auditables
            y resistentes a filtraciones. Aquí están las medidas que la respaldan.
          </p>

          {/* Controles globales TTS */}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {tts.supported ? (
              <>
                {tts.status === "idle" && (
                  <button
                    onClick={playAll}
                    disabled={!voicesReady}
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Headphones className="size-4" />
                    Reproducir todo en voz alta
                  </button>
                )}
                {tts.status === "playing" && (
                  <>
                    <button
                      onClick={tts.pause}
                      className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                    >
                      <Pause className="size-4" />
                      Pausar
                    </button>
                    <button
                      onClick={tts.stop}
                      className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-5 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
                    >
                      <Square className="size-3.5" />
                      Detener
                    </button>
                  </>
                )}
                {tts.status === "paused" && (
                  <>
                    <button
                      onClick={tts.resume}
                      className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                    >
                      <Play className="size-4" />
                      Reanudar
                    </button>
                    <button
                      onClick={tts.stop}
                      className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-5 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
                    >
                      <Square className="size-3.5" />
                      Detener
                    </button>
                  </>
                )}
                {!voicesReady && (
                  <span className="text-xs text-muted-foreground">
                    Cargando voces del sistema…
                  </span>
                )}
              </>
            ) : (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                Tu navegador no soporta lectura en voz alta. El contenido sigue
                siendo legible visualmente.
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ─── Secciones ───────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-5xl px-6 py-12">
        <div className="grid gap-6 sm:grid-cols-2">
          {SECTIONS.map((section, idx) => {
            const Icon = section.icon;
            const isActive = tts.activeId === section.id;
            return (
              <article
                key={section.id}
                className={[
                  "rounded-2xl border bg-card p-6 shadow-sm transition-all",
                  isActive
                    ? "border-primary/50 ring-2 ring-primary/30"
                    : "border-border",
                ].join(" ")}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={[
                      "flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-primary/10 text-primary",
                    ].join(" ")}
                  >
                    <Icon className="size-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-base font-semibold leading-tight sm:text-lg">
                        <span className="text-muted-foreground mr-1.5">
                          {String(idx + 1).padStart(2, "0")}.
                        </span>
                        {section.title}
                      </h2>
                      {tts.supported && (
                        <button
                          onClick={() => playOne(section)}
                          title="Escuchar esta sección"
                          className={[
                            "inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
                            isActive
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:bg-primary hover:text-primary-foreground",
                          ].join(" ")}
                        >
                          {isActive && tts.status === "playing" ? (
                            <Pause className="size-3.5" />
                          ) : (
                            <Play className="size-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                    <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                      {section.bullets.map((b, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/60" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {/* ─── Footer ─────────────────────────────────────────────────────── */}
        <footer className="mt-16 border-t border-border pt-8">
          <p className="text-center text-sm text-muted-foreground">
            ¿Preguntas o reportes de seguridad? Contacta al área de TI de Grupo
            Euromex.
          </p>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Documento técnico complementario disponible bajo solicitud (DECISIONS.md
            con 39 decisiones arquitectónicas registradas).
          </p>
        </footer>
      </main>

      {/* ─── Barra flotante con estado de reproducción ──────────────────── */}
      {tts.activeId && tts.status === "playing" && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-3">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <span className="flex size-2 shrink-0 animate-pulse rounded-full bg-primary" />
              <span className="truncate font-medium">
                Reproduciendo:{" "}
                <span className="text-muted-foreground">
                  {SECTIONS.find((s) => s.id === tts.activeId)?.title}
                </span>
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={tts.pause}
                title="Pausar"
                className="inline-flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Pause className="size-3.5" />
              </button>
              <button
                onClick={tts.stop}
                title="Detener"
                className="inline-flex size-8 items-center justify-center rounded-full border border-border hover:bg-muted"
              >
                <Square className="size-3" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
