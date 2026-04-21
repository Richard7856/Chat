import { Download } from "lucide-react";
import type { SystemEvent } from "@euromex/shared";
import { formatHour } from "./chat-utils";

/**
 * Pill centrado que muestra un evento de sistema (ej. descarga de adjunto).
 * No es E2EE — el server lo genera y broadcasta a todos los watchers de la
 * conversación. Se renderiza distinto a los bubbles para dejar claro que es
 * audit, no conversación.
 */
export function SystemNotice({
  ev,
  createdAt,
}: {
  ev: SystemEvent;
  createdAt: string;
}) {
  const time = formatHour(createdAt);

  if (ev.kind === "attachment_downloaded") {
    return (
      <div className="relative z-[2] my-1 flex justify-center">
        <div className="inline-flex max-w-[90%] items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          <Download className="size-3 shrink-0 text-primary" />
          <span className="truncate">
            <span className="font-medium text-foreground">
              {ev.actor.displayName}
            </span>{" "}
            descargó{" "}
            <span className="font-medium text-foreground">
              &ldquo;{ev.target.fileName}&rdquo;
            </span>
          </span>
          <span className="shrink-0 opacity-70">{time}</span>
        </div>
      </div>
    );
  }

  if (ev.kind === "conversation_created") {
    return (
      <div className="relative z-[2] my-1 flex justify-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          <span>
            <span className="font-medium text-foreground">
              {ev.actor.displayName}
            </span>{" "}
            creó esta conversación
          </span>
          <span className="shrink-0 opacity-70">{time}</span>
        </div>
      </div>
    );
  }

  return null;
}
