"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { Button } from "./ui/button";

const STORAGE_KEY = "euromex.security-banner.acked";

interface Props {
  conversationId: string;
}

/**
 * Banner informativo que aparece la primera vez que se abre una conversación.
 * Se cierra con "Entendido" y persiste en localStorage por-conversación.
 */
export function SecurityBanner({ conversationId }: Props) {
  const [hydrated, setHydrated] = useState(false);
  const [acked, setAcked] = useState(true);

  useEffect(() => {
    setHydrated(true);
    try {
      const stored = JSON.parse(
        localStorage.getItem(STORAGE_KEY) || "{}",
      ) as Record<string, boolean>;
      setAcked(!!stored[conversationId]);
    } catch {
      setAcked(false);
    }
  }, [conversationId]);

  function dismiss() {
    try {
      const stored = JSON.parse(
        localStorage.getItem(STORAGE_KEY) || "{}",
      ) as Record<string, boolean>;
      stored[conversationId] = true;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {}
    setAcked(true);
  }

  if (!hydrated || acked) return null;

  return (
    <div
      role="note"
      className="relative z-10 border-b border-border bg-primary/5 px-4 py-3 text-sm animate-fade-in"
    >
      <div className="mx-auto flex max-w-4xl items-start gap-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="flex-1 leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">
            Cifrado de extremo a extremo.
          </span>{" "}
          Las capturas de pantalla no se pueden detectar — dependemos de la
          confianza entre miembros. Los archivos descargados quedan
          registrados en el chat.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={dismiss}
          className="shrink-0"
        >
          Entendido
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
