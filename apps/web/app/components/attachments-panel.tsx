"use client";

import { useEffect, useState } from "react";
import { Download, FileText, Lock, Key, X, Loader2, AlertCircle } from "lucide-react";
import type { AttachmentListItem, AttachmentPayload } from "@euromex/shared";
import { api } from "../lib/api";
import { downloadFileToUser, formatBytes } from "../lib/attachments";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface Props {
  conversationId: string;
  /** Mensajes descifrados del chat — se usan para obtener los nombres de archivo. */
  messageCache: Map<string, AttachmentPayload>;
  currentUserId: string;
  onClose: () => void;
}

export function AttachmentsPanel({ conversationId, messageCache, currentUserId, onClose }: Props) {
  const [items, setItems] = useState<AttachmentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pinTarget, setPinTarget] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api<{ attachments: AttachmentListItem[] }>(
      `/conversations/${conversationId}/attachments`,
      { method: "GET", auth: true },
    )
      .then((r) => setItems(r.attachments))
      .catch((e) => setError(e instanceof Error ? e.message : "error"))
      .finally(() => setLoading(false));
  }, [conversationId]);

  async function handleDownload(item: AttachmentListItem, pinValue?: string) {
    // Para descargar necesitamos fileKey/fileIv del mensaje en el cache.
    const cached = messageCache.get(item.id);
    if (!cached) {
      setError(`No se encontró la clave de descifrado para este archivo. Carga el historial de mensajes que lo contiene.`);
      return;
    }

    setDownloading(item.id);
    setError(null);
    try {
      await downloadFileToUser({
        attachmentId: item.id,
        fileKey: cached.fileKey,
        fileIv: cached.fileIv,
        fileName: cached.fileName,
        mime: cached.mime,
        byteSize: cached.byteSize,
        downloadPin: pinValue,
      });
      setPinTarget(null);
      setPin("");
    } catch (e) {
      const code = e instanceof Error ? e.message : "download_failed";
      if (code === "invalid_pin") {
        setError("PIN incorrecto.");
      } else if (code === "pin_required") {
        setError("Se requiere PIN para descargar.");
      } else if (code === "access_denied") {
        setError("No tienes acceso a este archivo.");
      } else {
        setError(`Error al descargar: ${code}`);
      }
    } finally {
      setDownloading(null);
    }
  }

  function onClickDownload(item: AttachmentListItem) {
    if (item.hasPin) {
      setPinTarget(item.id);
      setPin("");
    } else {
      handleDownload(item);
    }
  }

  function canAccess(item: AttachmentListItem): boolean {
    if (item.accessType === "all") return true;
    return item.allowedUserIds.includes(currentUserId);
  }

  function fileName(item: AttachmentListItem): string {
    return messageCache.get(item.id)?.fileName ?? "Archivo cifrado";
  }

  return (
    <div className="flex h-full w-80 flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-primary" />
          <span className="text-sm font-semibold">Documentos</span>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar">
          <X className="size-4" />
        </Button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && error && (
          <div className="mx-3 mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!loading && items.length === 0 && !error && (
          <p className="px-4 py-10 text-center text-xs text-muted-foreground">
            Esta conversación no tiene documentos enviados aún.
          </p>
        )}

        {!loading && items.length > 0 && (
          <ul className="divide-y divide-border">
            {items.map((item) => {
              const accessible = canAccess(item);
              const name = fileName(item);
              const isPinTarget = pinTarget === item.id;
              const isDownloading = downloading === item.id;

              return (
                <li key={item.id} className="px-4 py-3">
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 shrink-0 rounded-md bg-secondary p-1.5">
                      <FileText className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium">{name}</span>
                        {item.accessType === "restricted" && (
                          <span title="Acceso restringido">
                            <Lock className="size-3 shrink-0 text-amber-600" />
                          </span>
                        )}
                        {item.hasPin && (
                          <span title="Requiere PIN">
                            <Key className="size-3 shrink-0 text-blue-600" />
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {item.uploaderDisplayName} · {formatBytes(item.byteSize)}
                      </div>

                      {/* PIN input en línea */}
                      {isPinTarget && accessible && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <Input
                            value={pin}
                            onChange={(e) => setPin(e.target.value)}
                            placeholder="PIN de descarga"
                            type="password"
                            className="h-7 text-xs"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleDownload(item, pin);
                              if (e.key === "Escape") { setPinTarget(null); setPin(""); }
                            }}
                            autoFocus
                          />
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => handleDownload(item, pin)}
                            disabled={!pin || isDownloading}
                          >
                            {isDownloading ? <Loader2 className="size-3 animate-spin" /> : "OK"}
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Botón de descarga */}
                    {accessible && !isPinTarget && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        onClick={() => onClickDownload(item)}
                        disabled={isDownloading || !messageCache.has(item.id)}
                        title={
                          !messageCache.has(item.id)
                            ? "Clave no disponible — carga el mensaje en el historial"
                            : "Descargar"
                        }
                      >
                        {isDownloading ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Download className="size-3.5" />
                        )}
                      </Button>
                    )}

                    {!accessible && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        Sin acceso
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
