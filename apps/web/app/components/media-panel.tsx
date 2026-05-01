"use client";

/**
 * Panel lateral de medios — Fase 17.
 * Tabs: Archivos (imágenes/video), Links, Docs, Guardados.
 *
 * Recibe del chat page:
 *   - conversationId: para llamar a GET /conversations/:id/attachments
 *   - messageCache: Map<attachmentId, AttachmentPayload> — necesario para
 *     descifrar imágenes sin conocer la clave en el servidor
 *   - messages: mensajes descifrados — usados para extraer URLs (tab Links)
 *     y para mostrar el contexto de los mensajes guardados
 *   - currentUserId: para marcar qué mensajes puede acceder
 */

import { useState, useEffect, useCallback } from "react";
import {
  X,
  Image,
  Link2,
  FileText,
  Star,
  ExternalLink,
  Download,
  Lock,
} from "lucide-react";
import type { AttachmentPayload } from "@euromex/shared";
import { downloadAndDecrypt, downloadFileToUser, formatBytes } from "../lib/attachments";
import { api } from "../lib/api";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AttachmentListItem {
  id: string;
  uploaderDisplayName: string;
  byteSize: number;
  createdAt: string;
  accessType: "all" | "restricted";
  allowedUserIds: string[];
  hasPin: boolean;
  messageId: string | null;
}

interface RenderedMsg {
  id: string;
  plaintext: string | null;
  senderUserId: string;
  createdAt: string;
  attachment?: AttachmentPayload;
}

interface StarredRef {
  messageId: string;
  conversationId: string;
  starredAt: string;
}

interface Props {
  conversationId: string;
  messageCache: Map<string, AttachmentPayload>;
  messages: RenderedMsg[];
  currentUserId: string;
  onClose: () => void;
}

type Tab = "archivos" | "links" | "docs" | "guardados";

// Simple URL extractor — looks for http/https links in plaintext
const URL_RE = /https?:\/\/[^\s<>"]+/gi;

function extractLinks(text: string): string[] {
  return Array.from(new Set(text.match(URL_RE) ?? []));
}

function isImage(mime: string) {
  return mime.startsWith("image/");
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MediaPanel({
  conversationId,
  messageCache,
  messages,
  currentUserId,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>("archivos");
  const [attachments, setAttachments] = useState<AttachmentListItem[]>([]);
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<string | null>(null); // blobUrl for full-size view
  const [starred, setStarred] = useState<StarredRef[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [pinModal, setPinModal] = useState<{ item: AttachmentListItem; payload: AttachmentPayload } | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");

  // Fetch attachment list when panel opens
  useEffect(() => {
    setLoadingAttachments(true);
    api<{ attachments: AttachmentListItem[] }>(
      `/conversations/${conversationId}/attachments`,
      { method: "GET", auth: true },
    )
      .then((res) => setAttachments(res.attachments))
      .catch(() => {})
      .finally(() => setLoadingAttachments(false));
  }, [conversationId]);

  // Fetch starred messages
  useEffect(() => {
    api<{ messages: StarredRef[] }>("/starred-messages", { method: "GET", auth: true })
      .then((res) => setStarred(res.messages))
      .catch(() => {});
  }, []);

  // Auto-decrypt images that we have keys for
  useEffect(() => {
    const load = async () => {
      for (const att of attachments) {
        const payload = messageCache.get(att.id);
        if (!payload || !isImage(payload.mime)) continue;
        if (blobUrls[att.id]) continue; // already loaded
        if (att.hasPin) continue; // requires PIN, user clicks to decrypt

        try {
          const blob = await downloadAndDecrypt({
            attachmentId: att.id,
            fileKey: payload.fileKey,
            fileIv: payload.fileIv,
            mime: payload.mime,
          });
          const url = URL.createObjectURL(blob);
          setBlobUrls((prev) => ({ ...prev, [att.id]: url }));
        } catch {
          // Silencioso — puede ser acceso restringido o PIN
        }
      }
    };
    void load();
    // Cleanup object URLs on unmount
    return () => {
      for (const url of Object.values(blobUrls)) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments, messageCache]);

  // Derived data
  const imageAttachments = attachments.filter((a) => {
    const p = messageCache.get(a.id);
    return p && isImage(p.mime);
  });

  const docAttachments = attachments.filter((a) => {
    const p = messageCache.get(a.id);
    return !p || !isImage(p.mime);
  });

  const linksInConv = messages.flatMap((m) =>
    m.plaintext ? extractLinks(m.plaintext).map((url) => ({ url, msgId: m.id, sentAt: m.createdAt })) : [],
  );
  // Deduplicate by URL
  const uniqueLinks = Array.from(new Map(linksInConv.map((l) => [l.url, l])).values());

  const starredInConv = starred.filter((s) => s.conversationId === conversationId);

  const handleDownload = useCallback(
    async (item: AttachmentListItem, payload: AttachmentPayload) => {
      if (item.hasPin) {
        setPinModal({ item, payload });
        return;
      }
      await downloadFileToUser({
        attachmentId: item.id,
        fileKey: payload.fileKey,
        fileIv: payload.fileIv,
        fileName: payload.fileName,
        mime: payload.mime,
        byteSize: item.byteSize,
      });
    },
    [],
  );

  const handlePinDownload = async () => {
    if (!pinModal) return;
    setPinError("");
    try {
      await downloadFileToUser({
        attachmentId: pinModal.item.id,
        fileKey: pinModal.payload.fileKey,
        fileIv: pinModal.payload.fileIv,
        fileName: pinModal.payload.fileName,
        mime: pinModal.payload.mime,
        byteSize: pinModal.item.byteSize,
        downloadPin: pin,
      });
      setPinModal(null);
      setPin("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error";
      setPinError(msg === "403" || msg === "forbidden" ? "PIN incorrecto" : "Error al descargar");
    }
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: "archivos", label: "Archivos", icon: <Image size={14} />, count: imageAttachments.length },
    { id: "links", label: "Links", icon: <Link2 size={14} />, count: uniqueLinks.length },
    { id: "docs", label: "Docs", icon: <FileText size={14} />, count: docAttachments.length },
    { id: "guardados", label: "Guardados", icon: <Star size={14} />, count: starredInConv.length },
  ];

  return (
    <>
      {/* Panel */}
      <aside className="w-72 border-l border-white/10 flex flex-col bg-[#1a1a2e] text-sm">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="font-semibold text-white">Medios</span>
          <button onClick={onClose} className="text-white/50 hover:text-white transition">
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] transition ${
                tab === t.id
                  ? "text-indigo-400 border-b-2 border-indigo-400"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
              {t.count != null && t.count > 0 && (
                <span className="text-[10px] text-white/40">{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-2">
          {loadingAttachments && (tab === "archivos" || tab === "docs") && (
            <p className="text-white/40 text-center py-6 text-xs">Cargando…</p>
          )}

          {/* ── Archivos (images) ── */}
          {tab === "archivos" && !loadingAttachments && (
            <>
              {imageAttachments.length === 0 ? (
                <p className="text-white/30 text-center py-8 text-xs">Sin imágenes</p>
              ) : (
                <div className="grid grid-cols-3 gap-1">
                  {imageAttachments.map((att) => {
                    const payload = messageCache.get(att.id);
                    const blobUrl = blobUrls[att.id];
                    const restricted =
                      att.accessType === "restricted" &&
                      !att.allowedUserIds.includes(currentUserId);

                    return (
                      <div
                        key={att.id}
                        className="aspect-square relative rounded overflow-hidden bg-white/5 cursor-pointer"
                        onClick={() => {
                          if (blobUrl) setLightbox(blobUrl);
                          else if (payload && !restricted) void handleDownload(att, payload);
                        }}
                      >
                        {blobUrl ? (
                          <img src={blobUrl} alt="" className="w-full h-full object-cover" />
                        ) : restricted ? (
                          <div className="w-full h-full flex items-center justify-center">
                            <Lock size={18} className="text-white/30" />
                          </div>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Image size={18} className="text-white/30" />
                          </div>
                        )}
                        {att.hasPin && (
                          <span className="absolute top-1 right-1 text-[10px] bg-black/60 rounded px-1">
                            🔑
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ── Links ── */}
          {tab === "links" && (
            <>
              {uniqueLinks.length === 0 ? (
                <p className="text-white/30 text-center py-8 text-xs">Sin links compartidos</p>
              ) : (
                <ul className="space-y-2">
                  {uniqueLinks.map((l) => (
                    <li key={l.url} className="flex items-start gap-2 bg-white/5 rounded p-2">
                      <ExternalLink size={13} className="text-indigo-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-300 hover:underline break-all line-clamp-2 text-xs"
                        >
                          {l.url}
                        </a>
                        <p className="text-white/30 text-[10px] mt-0.5">
                          {new Date(l.sentAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* ── Docs ── */}
          {tab === "docs" && !loadingAttachments && (
            <>
              {docAttachments.length === 0 ? (
                <p className="text-white/30 text-center py-8 text-xs">Sin documentos</p>
              ) : (
                <ul className="space-y-2">
                  {docAttachments.map((att) => {
                    const payload = messageCache.get(att.id);
                    const restricted =
                      att.accessType === "restricted" &&
                      !att.allowedUserIds.includes(currentUserId);

                    return (
                      <li key={att.id} className="flex items-center gap-2 bg-white/5 rounded p-2">
                        <FileText size={16} className="text-indigo-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-white text-xs truncate">
                            {payload?.fileName ?? "Archivo cifrado"}
                          </p>
                          <p className="text-white/40 text-[10px]">
                            {formatBytes(att.byteSize)} ·{" "}
                            {new Date(att.createdAt).toLocaleDateString("es-MX", {
                              day: "2-digit",
                              month: "short",
                            })}
                            {att.hasPin && " · 🔑"}
                            {att.accessType === "restricted" && " · 🔒"}
                          </p>
                        </div>
                        {restricted ? (
                          <span className="text-white/30 text-[10px]">Sin acceso</span>
                        ) : payload ? (
                          <button
                            onClick={() => void handleDownload(att, payload)}
                            className="text-white/50 hover:text-white transition"
                            title="Descargar"
                          >
                            <Download size={14} />
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}

          {/* ── Guardados ── */}
          {tab === "guardados" && (
            <>
              {starredInConv.length === 0 ? (
                <p className="text-white/30 text-center py-8 text-xs">
                  Sin mensajes guardados.
                  <br />
                  Mantén presionado un mensaje y toca ⭐
                </p>
              ) : (
                <ul className="space-y-2">
                  {starredInConv.map((s) => {
                    const msg = messages.find((m) => m.id === s.messageId);
                    return (
                      <li key={s.messageId} className="bg-white/5 rounded p-2">
                        <p className="text-yellow-300/80 text-xs line-clamp-3">
                          {msg?.plaintext ?? msg?.attachment?.fileName ?? "(mensaje cifrado)"}
                        </p>
                        <p className="text-white/30 text-[10px] mt-1">
                          {new Date(s.starredAt).toLocaleDateString("es-MX", {
                            day: "2-digit",
                            month: "short",
                          })}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </aside>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="Imagen completa"
            className="max-w-full max-h-full object-contain rounded"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white"
            onClick={() => setLightbox(null)}
          >
            <X size={24} />
          </button>
        </div>
      )}

      {/* PIN Modal */}
      {pinModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-[#1e1e3a] rounded-xl p-5 w-80 space-y-4">
            <h3 className="text-white font-semibold">PIN de descarga</h3>
            <p className="text-white/60 text-sm">
              Este archivo requiere un PIN para descargarlo.
            </p>
            <input
              type="password"
              placeholder="Ingresa el PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handlePinDownload()}
              className="w-full rounded-lg bg-white/10 px-3 py-2 text-white text-sm outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {pinError && <p className="text-red-400 text-xs">{pinError}</p>}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setPinModal(null);
                  setPin("");
                  setPinError("");
                }}
                className="px-3 py-1.5 text-white/60 hover:text-white text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={() => void handlePinDownload()}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm"
              >
                Descargar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
