import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  FileAudio,
  type LucideIcon,
} from "lucide-react";
import type { Conversation } from "@euromex/shared";

/** Título visible de una conversación desde la perspectiva del usuario. */
export function displayTitle(conv: Conversation, meId: string): string {
  if (conv.type === "group") return conv.name ?? "Grupo";
  const other = conv.members.find((m) => m.userId !== meId);
  return other ? other.displayName : "(solo tú)";
}

/** Para DMs, devuelve al "otro" participante. Para grupos, null. */
export function dmPeer(
  conv: Conversation,
  meId: string,
): { username: string; displayName: string } | null {
  if (conv.type !== "dm") return null;
  const other = conv.members.find((m) => m.userId !== meId);
  if (!other) return null;
  return { username: other.username, displayName: other.displayName };
}

/** Formato relativo corto: "ahora", "hace 2h", "ayer", "15 mar". */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "ayer";
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

/** Hora del día (HH:MM) — para timestamp de bubbles individuales. */
export function formatHour(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Icono lucide apropiado para el MIME. */
export function fileIconFor(mime: string): LucideIcon {
  if (mime.startsWith("image/")) return FileImage;
  if (mime.startsWith("video/")) return FileVideo;
  if (mime.startsWith("audio/")) return FileAudio;
  if (mime === "application/pdf") return FileText;
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("csv"))
    return FileSpreadsheet;
  if (mime.includes("word") || mime.includes("document")) return FileText;
  if (
    mime.includes("zip") ||
    mime.includes("compressed") ||
    mime.includes("tar") ||
    mime.includes("gzip") ||
    mime.includes("x-7z")
  )
    return FileArchive;
  if (
    mime.includes("json") ||
    mime.includes("javascript") ||
    mime.includes("typescript") ||
    mime === "text/html" ||
    mime === "text/css" ||
    mime === "text/x-python"
  )
    return FileCode;
  return File;
}
