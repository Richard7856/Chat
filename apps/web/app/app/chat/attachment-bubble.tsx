"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import type { AttachmentPayload } from "@euromex/shared";
import { downloadFileToUser, formatBytes } from "../../lib/attachments";
import { fileIconFor } from "./chat-utils";

export function AttachmentBubble({
  att,
  mine,
}: {
  att: AttachmentPayload;
  mine: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const Icon = fileIconFor(att.mime);

  async function onDownload() {
    setErr(null);
    setBusy(true);
    try {
      await downloadFileToUser({
        attachmentId: att.attachmentId,
        fileKey: att.fileKey,
        fileIv: att.fileIv,
        fileName: att.fileName,
        mime: att.mime,
        byteSize: att.byteSize,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "download_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={[
        "flex min-w-[240px] items-center gap-3 rounded-lg p-2.5",
        mine
          ? "bg-primary-foreground/10 ring-1 ring-primary-foreground/10"
          : "bg-background/60 ring-1 ring-border",
      ].join(" ")}
    >
      <div
        className={[
          "flex size-10 shrink-0 items-center justify-center rounded-md",
          mine ? "bg-primary-foreground/20" : "bg-primary/10 text-primary",
        ].join(" ")}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div
          className="truncate text-sm font-medium"
          title={att.fileName}
        >
          {att.fileName}
        </div>
        <div className="text-xs opacity-70">{formatBytes(att.byteSize)}</div>
        {err && (
          <div className="mt-0.5 text-xs text-destructive">Error: {err}</div>
        )}
      </div>
      <button
        type="button"
        onClick={onDownload}
        disabled={busy}
        title="Descargar y descifrar"
        className={[
          "flex size-9 shrink-0 items-center justify-center rounded-md transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:opacity-50",
          mine
            ? "hover:bg-primary-foreground/20 text-primary-foreground"
            : "hover:bg-primary/15 text-primary",
        ].join(" ")}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Download className="size-4" />
        )}
      </button>
    </div>
  );
}
