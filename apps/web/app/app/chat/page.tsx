"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  AtSign,
  Bell,
  BellOff,
  CalendarDays,
  ClipboardList,
  CalendarPlus,
  FolderOpen,
  Loader2,
  Lock,
  LogOut,
  Paperclip,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react";
import type {
  AttachmentPayload,
  AttachmentRestrictedPayload,
  Conversation,
  DeviceKey,
  Message,
  SystemEvent,
} from "@euromex/shared";
import {
  ACTIVITY_CONTENT_TYPE,
  ATTACHMENT_CONTENT_TYPE,
  SYSTEM_CONTENT_TYPE,
  TASK_CONTENT_TYPE,
} from "@euromex/shared";
import {
  decodeUtf8,
  decryptFrom,
  encodeUtf8,
  encryptFor,
  envelopeFromBase64,
  fromBase64,
  ready,
  toBase64,
  type IdentityKeypair,
} from "@euromex/crypto";
import { api, clearSession, loadSession } from "../../lib/api";
import { ensureDeviceKeypair, clearKeypair } from "../../lib/keys";
import { closeSocket, getSocket } from "../../lib/socket";
import { encryptAndUpload } from "../../lib/attachments";
import { applyShareExternallyPolicy } from "../../lib/native";
import { Avatar } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { SecurityBanner } from "../../components/security-banner";
import { Watermark } from "../../components/watermark";
import { MediaPanel } from "../../components/media-panel";
import { AttachmentOptionsModal } from "../../components/attachment-options-modal";
import { ActivityCard } from "../../components/activity-card";
import { TaskCard } from "../../components/task-card";
import { CreateActivityModal } from "../../components/create-activity-modal";
import { CreateTaskModal } from "../../components/create-task-modal";
import { AttachmentBubble } from "./attachment-bubble";
import { NewConversationDialog } from "./new-conv-dialog";
import { SystemNotice } from "./system-notice";
import {
  displayTitle,
  dmPeer,
  formatHour,
  formatWhen,
  previewLastMessage,
} from "./chat-utils";

/** Convierte una VAPID public key (base64url) al Uint8Array que necesita PushManager. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const arr = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i);
  return arr;
}

interface MeResponse {
  user: {
    id: string;
    username: string;
    displayName: string;
    email: string | null;
    role: "user" | "admin";
    /** Fase 24 — opcional para tolerar APIs viejos que aún no lo devuelven. */
    permissions?: {
      canDownloadAttachments: boolean;
      canShareExternally: boolean;
      canCreateGroups: boolean;
      canInviteUsers: boolean;
      canInitiateCalls: boolean;
      maxAttachmentMb: number;
    };
  };
  device: {
    id: string;
    deviceName: string;
    platform: "web" | "ios" | "android" | "desktop";
    lastSeenAt: string | null;
  };
}

type RenderStatus = "ok" | "legacy" | "no_envelope" | "decrypt_error" | "system" | "restricted_attachment";

interface RenderedMessage extends Message {
  plaintext: string | null;
  status: RenderStatus;
  attachment?: AttachmentPayload;
  attachmentRestricted?: AttachmentRestrictedPayload;
  systemEvent?: SystemEvent;
}

type DeviceKeyMap = Record<string, DeviceKey>;

export default function ChatPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [myKeypair, setMyKeypair] = useState<IdentityKeypair | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<RenderedMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [convQuery, setConvQuery] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDocsPanel, setShowDocsPanel] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  // Fase 17: mensajes guardados (starred)
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  // Fase 18: presencia y read receipts
  // presenceMap: userId → { online, lastSeenAt }
  const [presenceMap, setPresenceMap] = useState<Map<string, { online: boolean; lastSeenAt: string | null }>>(new Map());
  // Fase 19: push notifications permission state.
  // Default a "granted" para que el banner NO parpadee al cargar la página
  // (el useEffect que sigue lee Notification.permission y corrige el estado).
  const [pushState, setPushState] = useState<"unknown" | "granted" | "denied" | "subscribing">("granted");
  // Si el usuario ya descartó el banner manualmente, recordarlo en localStorage.
  const [pushDismissed, setPushDismissed] = useState(false);
  // Fase 19: @mention autocomplete
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Fix post-Fase 20: ref al compositor para re-enfocarlo después de send.
  // Sin esto, el toggle de `disabled` durante onSend hace que React pierda el foco.
  const composerRef = useRef<HTMLInputElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  const deviceKeysRef = useRef<DeviceKeyMap>({});

  const selectedConv = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  const filteredConvs = useMemo(() => {
    const q = convQuery.trim().toLowerCase();
    if (!q || !me) return conversations;
    return conversations.filter((c) => {
      const title = displayTitle(c, me.user.id).toLowerCase();
      const peer = dmPeer(c, me.user.id);
      return (
        title.includes(q) ||
        (peer && peer.username.toLowerCase().includes(q))
      );
    });
  }, [conversations, convQuery, me]);

  // Cache de AttachmentPayloads de mensajes descifrados — usado por AttachmentsPanel
  // para mostrar los nombres de archivo sin exponer las claves al server.
  const attachmentCache = useMemo(() => {
    const map = new Map<string, AttachmentPayload>();
    for (const msg of messages) {
      if (msg.attachment) map.set(msg.attachment.attachmentId, msg.attachment);
    }
    return map;
  }, [messages]);

  // ---------------- Decrypt helper ----------------
  const decryptMessage = useCallback(
    async (msg: Message, kp: IdentityKeypair): Promise<RenderedMessage> => {
      if (msg.contentType === SYSTEM_CONTENT_TYPE && msg.content !== null) {
        try {
          const ev = JSON.parse(msg.content) as SystemEvent;
          return { ...msg, plaintext: msg.content, status: "system", systemEvent: ev };
        } catch {
          return { ...msg, plaintext: null, status: "decrypt_error" };
        }
      }
      // Activity/Task system messages are plaintext JSON (not E2EE envelopes)
      if (
        (msg.contentType === ACTIVITY_CONTENT_TYPE || msg.contentType === TASK_CONTENT_TYPE) &&
        msg.content !== null
      ) {
        return { ...msg, plaintext: msg.content, status: "ok" };
      }
      if (msg.content !== null && msg.envelope === null) {
        return { ...msg, plaintext: msg.content, status: "legacy" };
      }
      if (!msg.envelope) {
        return { ...msg, plaintext: null, status: "no_envelope" };
      }
      const senderKey = deviceKeysRef.current[msg.senderDeviceId];
      if (!senderKey?.identityPublicKey) {
        return { ...msg, plaintext: null, status: "decrypt_error" };
      }
      try {
        const senderPub = await fromBase64(senderKey.identityPublicKey);
        const env = await envelopeFromBase64(msg.envelope);
        const pt = await decryptFrom(env, senderPub, kp.privateKey);
        const text = await decodeUtf8(pt);

        if (msg.contentType === ATTACHMENT_CONTENT_TYPE) {
          const parsed = JSON.parse(text) as { kind: string };
          if (parsed.kind === "attachment_restricted") {
            return {
              ...msg,
              plaintext: text,
              status: "restricted_attachment",
              attachmentRestricted: parsed as AttachmentRestrictedPayload,
            };
          }
          return {
            ...msg,
            plaintext: text,
            status: "ok",
            attachment: parsed as AttachmentPayload,
          };
        }
        return { ...msg, plaintext: text, status: "ok" };
      } catch {
        return { ...msg, plaintext: null, status: "decrypt_error" };
      }
    },
    [],
  );

  const refreshConversations = useCallback(async () => {
    const r = await api<{ conversations: Conversation[] }>("/conversations", {
      method: "GET",
      auth: true,
    });
    setConversations(r.conversations);
  }, []);

  const refreshDeviceKeys = useCallback(async (conversationId: string) => {
    const r = await api<{ devices: DeviceKey[] }>(
      `/conversations/${conversationId}/device-keys`,
      { method: "GET", auth: true },
    );
    const map: DeviceKeyMap = {};
    for (const d of r.devices) map[d.deviceId] = d;
    deviceKeysRef.current = { ...deviceKeysRef.current, ...map };
  }, []);

  // ---------------- Bootstrap ----------------
  useEffect(() => {
    if (!loadSession()) {
      router.replace("/login");
      return;
    }
    (async () => {
      try {
        await ready();
        const meRes = await api<MeResponse>("/auth/me", {
          method: "GET",
          auth: true,
        });
        setMe(meRes);
        const kp = await ensureDeviceKeypair(meRes.device.id);
        setMyKeypair(kp);
        await refreshConversations();
      } catch (err) {
        setError(err instanceof Error ? err.message : "error");
        clearSession();
      } finally {
        setLoading(false);
      }
    })();
    return () => closeSocket();
  }, [router, refreshConversations]);

  // Fase 17: cargar mensajes guardados del usuario
  useEffect(() => {
    if (!me) return;
    api<{ messages: Array<{ messageId: string }> }>("/starred-messages", { method: "GET", auth: true })
      .then((res) => setStarredIds(new Set(res.messages.map((m) => m.messageId))))
      .catch(() => {});
  }, [me]);

  // Fase 23 — APK Capacitor: aplicar FLAG_SECURE en función del permiso
  // can_share_externally del usuario. En la web normal este efecto es no-op
  // (el bridge detecta que no estamos en Capacitor); en el APK Android,
  // setea el flag a nivel OS bloqueando screenshots, screen recording y
  // mirroring. Se re-aplica al cambiar `me` (login/refresh, en futuras fases
  // también socket events de cambio de permisos).
  useEffect(() => {
    if (!me) return;
    const canShare = me.user.permissions?.canShareExternally ?? false;
    void applyShareExternallyPolicy(canShare);
  }, [me]);

  // Fase 19: revisar estado actual del permiso de notificaciones
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPushState(
        Notification.permission === "granted"
          ? "granted"
          : Notification.permission === "denied"
          ? "denied"
          : "unknown",
      );
      // Recordar si el usuario ya descartó el banner antes
      try {
        if (localStorage.getItem("euromex.push.dismissed") === "1") {
          setPushDismissed(true);
        }
      } catch {}
    }
  }, []);

  // ---------------- Socket listeners ----------------
  useEffect(() => {
    if (!me || !myKeypair) return;
    const socket = getSocket();

    const onNew = async (msg: Message) => {
      if (!deviceKeysRef.current[msg.senderDeviceId]) {
        try {
          await refreshDeviceKeys(msg.conversationId);
        } catch {}
      }
      const rendered = await decryptMessage(msg, myKeypair);
      setMessages((prev) => {
        if (msg.conversationId !== selectedIdRef.current) return prev;
        if (prev.some((m) => m.id === rendered.id)) return prev;
        return [...prev, rendered];
      });
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === msg.conversationId);
        if (idx < 0) return prev;
        const updated = [...prev];
        const conv = { ...updated[idx]! };
        conv.lastMessage = {
          id: msg.id,
          senderUserId: msg.senderUserId,
          content: rendered.plaintext,
          contentType: msg.contentType,
          createdAt: msg.createdAt,
        };
        if (msg.conversationId !== selectedIdRef.current) {
          conv.unreadCount = conv.unreadCount + 1;
        }
        updated.splice(idx, 1);
        return [conv, ...updated];
      });
    };

    const onConvUpdated = (conv: Conversation) => {
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === conv.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = conv;
          return copy;
        }
        return [conv, ...prev];
      });
    };

    // Fase 18: presencia
    const onUserOnline = ({ userId }: { userId: string }) => {
      setPresenceMap((prev) => {
        const next = new Map(prev);
        next.set(userId, { online: true, lastSeenAt: null });
        return next;
      });
    };
    const onUserOffline = ({ userId, lastSeenAt }: { userId: string; lastSeenAt: string }) => {
      setPresenceMap((prev) => {
        const next = new Map(prev);
        next.set(userId, { online: false, lastSeenAt });
        return next;
      });
    };
    // Fase 18: read receipts — actualizar lastReadAt del miembro en la conversación
    const onMessageRead = ({ conversationId, userId, lastReadAt }: { conversationId: string; userId: string; lastReadAt: string }) => {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== conversationId) return c;
          return {
            ...c,
            members: c.members.map((m) =>
              m.userId === userId ? { ...m, lastReadAt } : m,
            ),
          };
        }),
      );
    };

    socket.on("message:new", onNew);
    socket.on("conversation:updated", onConvUpdated);
    socket.on("user:online", onUserOnline);
    socket.on("user:offline", onUserOffline);
    socket.on("message:read", onMessageRead);
    return () => {
      socket.off("message:new", onNew);
      socket.off("conversation:updated", onConvUpdated);
      socket.off("user:online", onUserOnline);
      socket.off("user:offline", onUserOffline);
      socket.off("message:read", onMessageRead);
    };
  }, [me, myKeypair, decryptMessage, refreshDeviceKeys]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // ---------------- Carga mensajes al cambiar conv ----------------
  useEffect(() => {
    if (!selectedId || !myKeypair) {
      setMessages([]);
      return;
    }
    (async () => {
      await refreshDeviceKeys(selectedId);
      const r = await api<{ messages: Message[] }>(
        `/conversations/${selectedId}/messages?limit=50`,
        { method: "GET", auth: true },
      );
      const rendered = await Promise.all(
        r.messages.map((m) => decryptMessage(m, myKeypair)),
      );
      setMessages(rendered);
      try {
        await api(`/conversations/${selectedId}/read`, {
          method: "POST",
          auth: true,
        });
      } catch {}
      setConversations((prev) =>
        prev.map((c) => (c.id === selectedId ? { ...c, unreadCount: 0 } : c)),
      );
    })();
  }, [selectedId, myKeypair, refreshDeviceKeys, decryptMessage]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  // ---------------- Encrypt + send ----------------
  const sendEncrypted = useCallback(
    async (params: {
      plaintextBytes: Uint8Array;
      contentType: string;
      localPlaintext: string;
      attachment?: AttachmentPayload;
      /**
       * Fase 14: para adjuntos restringidos, este payload (sin fileKey/fileIv)
       * se cifra para los dispositivos NO incluidos en allowedUserIds.
       */
      attachmentRestricted?: AttachmentRestrictedPayload;
      /** Fase 14: user IDs con acceso completo (para split de envelopes). */
      allowedUserIds?: string[];
      /** Fase 14: si el mensaje referencia un adjunto, pasamos el ID para
       *  que el server vincule attachment.message_id. */
      attachmentId?: string;
      /** Fase 19: user IDs mencionados con @, para push offline. */
      mentionedUserIds?: string[];
    }): Promise<void> => {
      if (!selectedId || !myKeypair) throw new Error("no_conversation");
      await refreshDeviceKeys(selectedId);
      const recipients = Object.values(deviceKeysRef.current).filter(
        (d) => d.identityPublicKey,
      );
      if (recipients.length === 0) {
        throw new Error("No hay dispositivos con clave pública publicada.");
      }

      const restrictedBytes =
        params.attachmentRestricted && params.allowedUserIds
          ? await encodeUtf8(JSON.stringify(params.attachmentRestricted))
          : null;

      const envelopes = await Promise.all(
        recipients.map(async (d) => {
          const peerPub = await fromBase64(d.identityPublicKey!);
          // Para adjuntos restringidos, encriptar con payload diferente
          // según si el dispositivo pertenece a un usuario con acceso.
          const payload =
            restrictedBytes && params.allowedUserIds &&
            !params.allowedUserIds.includes(d.userId)
              ? restrictedBytes
              : params.plaintextBytes;
          const env = await encryptFor(payload, peerPub, myKeypair.privateKey);
          return {
            recipientDeviceId: d.deviceId,
            ciphertext: await toBase64(env.ciphertext),
            nonce: await toBase64(env.nonce),
          };
        }),
      );

      const clientId = crypto.randomUUID();
      const socket = getSocket();
      const serverMsg = await new Promise<Message>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout")), 30_000);
        socket.emit(
          "message:send",
          {
            conversationId: selectedId,
            clientId,
            contentType: params.contentType,
            envelopes,
            attachmentId: params.attachmentId,
            mentionedUserIds: params.mentionedUserIds,
          },
          (res) => {
            clearTimeout(timer);
            if (!res.ok) return reject(new Error(res.error));
            resolve(res.message);
          },
        );
      });

      setMessages((prev) => {
        if (prev.some((m) => m.id === serverMsg.id)) return prev;
        return [
          ...prev,
          {
            ...serverMsg,
            plaintext: params.localPlaintext,
            status: "ok" as const,
            attachment: params.attachment,
            attachmentRestricted: undefined,
          },
        ];
      });
    },
    [selectedId, myKeypair, refreshDeviceKeys],
  );

  // Fase 17: toggle estrella en un mensaje
  async function handleStar(msgId: string, convId: string) {
    const isStarred = starredIds.has(msgId);
    const method = isStarred ? "DELETE" : "POST";
    // Actualizar estado optimistamente
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (isStarred) next.delete(msgId); else next.add(msgId);
      return next;
    });
    try {
      await api(`/conversations/${convId}/messages/${msgId}/star`, { method, auth: true });
    } catch {
      // Revertir si falla
      setStarredIds((prev) => {
        const next = new Set(prev);
        if (isStarred) next.add(msgId); else next.delete(msgId);
        return next;
      });
    }
  }

  // Fase 19: suscribir dispositivo a Web Push
  async function subscribeToPush() {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    setPushState("subscribing");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setPushState("denied");
        return;
      }
      // Obtener la VAPID key del servidor
      const { vapidPublicKey } = await api<{ vapidPublicKey: string }>("/push/vapid-key", { method: "GET" });
      if (!vapidPublicKey) {
        setPushState("unknown");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      // urlB64ToUint8Array convierte la VAPID public key al formato que necesita pushManager
      const appServerKey = urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appServerKey });
      const json = sub.toJSON();
      await api("/push/subscribe", {
        method: "POST",
        auth: true,
        body: {
          endpoint: json.endpoint,
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
        },
      });
      setPushState("granted");
    } catch {
      setPushState("unknown");
    }
  }

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !draft.trim() || !me || !myKeypair || !selectedConv) return;
    const content = draft.trim();
    setDraft("");
    setMentionQuery(null);
    setSending(true);
    // Extraer @usernames del mensaje y mapear a userIds
    const mentionMatches = [...content.matchAll(/@([\w.]+)/g)].map((m) => m[1]);
    const mentionedUserIds = selectedConv.members
      .filter((m) => mentionMatches.includes(m.username) && m.userId !== me.user.id)
      .map((m) => m.userId);
    try {
      await sendEncrypted({
        plaintextBytes: await encodeUtf8(content),
        contentType: "text/plain",
        localPlaintext: content,
        mentionedUserIds: mentionedUserIds.length > 0 ? mentionedUserIds : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "send_failed");
      setDraft(content);
    } finally {
      setSending(false);
      // Re-enfocar el input después del re-render que dispara setSending(false).
      // requestAnimationFrame asegura que React ya pintó el `disabled=false`.
      requestAnimationFrame(() => composerRef.current?.focus());
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selectedId || !myKeypair || !selectedConv) return;

    // En grupos mostramos el modal de opciones (PIN, acceso restringido).
    // En DMs subimos directamente.
    if (selectedConv.type === "group") {
      setPendingFile(file);
      return;
    }
    await doUploadFile(file, {});
  }

  async function doUploadFile(
    file: File,
    opts: { downloadPin?: string; allowedUserIds?: string[] },
  ) {
    if (!selectedId || !myKeypair) return;
    setUploading(true);
    setError(null);
    try {
      const upload = await encryptAndUpload(selectedId, file, opts);
      const payload: AttachmentPayload = {
        kind: "attachment",
        attachmentId: upload.attachmentId,
        fileName: upload.fileName,
        mime: upload.mime,
        byteSize: upload.byteSize,
        fileKey: upload.fileKey,
        fileIv: upload.fileIv,
      };
      const restricted: AttachmentRestrictedPayload | undefined =
        opts.allowedUserIds && opts.allowedUserIds.length > 0
          ? {
              kind: "attachment_restricted",
              attachmentId: upload.attachmentId,
              fileName: upload.fileName,
              mime: upload.mime,
              byteSize: upload.byteSize,
            }
          : undefined;

      const json = JSON.stringify(payload);
      await sendEncrypted({
        plaintextBytes: await encodeUtf8(json),
        contentType: ATTACHMENT_CONTENT_TYPE,
        localPlaintext: json,
        attachment: payload,
        attachmentRestricted: restricted,
        allowedUserIds: opts.allowedUserIds,
        attachmentId: upload.attachmentId,
      });
    } catch (err) {
      setError(err instanceof Error ? `Subida falló: ${err.message}` : "upload_failed");
    } finally {
      setUploading(false);
    }
  }

  async function onLogout() {
    // Logout suave: auditamos en el servidor pero NO revocamos el device
    // ni borramos el keypair E2EE. Esto permite que la próxima visita
    // muestre el formulario de login rápido (solo TOTP).
    // Si el device debe revocarse (teléfono perdido, etc.), el admin lo
    // hace desde el panel admin → Usuarios → Dispositivos → Revocar.
    try {
      await api("/auth/logout", { method: "POST", auth: true });
    } catch {}
    clearSession(); // solo borra el token de acceso; hint + keypair persisten
    closeSocket();
    router.replace("/login");
  }

  // ---------------- Loading / error states ----------------
  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }
  if (error || !me) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold">Sesión inválida</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {error ?? "No autenticado."}
          </p>
          <Button asChild className="mt-4">
            <a href="/login">Volver a iniciar sesión</a>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <div
      className="grid h-screen w-screen bg-background md:grid-cols-[340px_1fr]"
      data-view={selectedId ? "detail" : "list"}
    >
      {/* ============== SIDEBAR ============== */}
      <aside
        className={[
          "flex h-screen flex-col border-r border-border bg-card",
          selectedId ? "hidden md:flex" : "flex",
        ].join(" ")}
      >
        {/* Brand strip: solo logo (el logo ya contiene "EurOMex", el texto
            adicional era redundante y robaba espacio en pantalla) */}
        <div className="flex items-center justify-center border-b border-border px-4 py-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Euromex"
            className="h-6 w-auto select-none"
            draggable={false}
          />
        </div>

        {/* Header sidebar: usuario actual */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Avatar
            size="md"
            username={me.user.username}
            displayName={me.user.displayName}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">
                {me.user.displayName}
              </span>
              {me.user.role === "admin" && (
                <Badge variant="default" className="shrink-0 px-1.5 py-0 text-[10px]">
                  admin
                </Badge>
              )}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              @{me.user.username}
            </div>
          </div>
          {me.user.role === "admin" && (
            <Button asChild variant="ghost" size="icon" title="Panel admin">
              <a href="/app/admin">
                <ShieldCheck className="size-4" />
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onLogout}
            title="Cerrar sesión"
          >
            <LogOut className="size-4" />
          </Button>
        </div>

        {/* Search + nueva (icon-only para no dominar visualmente el sidebar) */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={convQuery}
              onChange={(e) => setConvQuery(e.target.value)}
              placeholder="Buscar conversación…"
              className="pl-9 h-9 text-sm"
            />
          </div>
          <Button
            type="button"
            onClick={() => setShowNew(true)}
            size="icon"
            className="h-9 w-9 shrink-0"
            title="Nueva conversación"
            aria-label="Nueva conversación"
          >
            <Plus className="size-4" />
          </Button>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto py-1">
          {filteredConvs.length === 0 && (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              {conversations.length === 0
                ? "Aún no tienes conversaciones. Crea una con el botón de arriba."
                : "Ninguna conversación coincide."}
            </p>
          )}
          {filteredConvs.map((conv) => {
            const peer = dmPeer(conv, me.user.id);
            const isActive = selectedId === conv.id;
            const unread = conv.unreadCount > 0;
            return (
              <button
                key={conv.id}
                type="button"
                onClick={() => setSelectedId(conv.id)}
                className={[
                  "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                  isActive
                    ? "bg-primary/10 ring-inset ring-1 ring-primary/25"
                    : "hover:bg-secondary/50",
                ].join(" ")}
              >
                {/* Fase 18: presencia — punto verde en el avatar del peer DM */}
                {(() => {
                  const peerId = conv.type === "dm"
                    ? conv.members.find((m) => m.userId !== me.user.id)?.userId
                    : null;
                  return (
                    <div className="relative shrink-0">
                      <Avatar
                        size="md"
                        username={peer?.username ?? conv.name ?? conv.id}
                        displayName={peer?.displayName ?? conv.name ?? "Grupo"}
                      />
                      {peerId && presenceMap.get(peerId)?.online && (
                        <span className="absolute bottom-0 right-0 size-2.5 rounded-full bg-green-400 ring-2 ring-background" />
                      )}
                    </div>
                  );
                })()}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={[
                        "truncate text-sm",
                        unread ? "font-semibold" : "font-medium",
                      ].join(" ")}
                    >
                      {displayTitle(conv, me.user.id)}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {formatWhen(conv.lastMessage?.createdAt ?? conv.updatedAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={[
                        "truncate text-xs",
                        unread ? "text-foreground" : "text-muted-foreground",
                      ].join(" ")}
                    >
                      {previewLastMessage(conv.lastMessage)}
                    </span>
                    {unread && (
                      <Badge variant="default" className="shrink-0 px-1.5 py-0 text-[10px]">
                        {conv.unreadCount}
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer sidebar: device info + calendar */}
        <div className="flex items-center gap-2 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <Sparkles className="size-3 text-primary" />
          <span className="flex-1 truncate">
            {me.device.deviceName} · E2EE activo
          </span>
          <Button asChild variant="ghost" size="icon" title="Calendario" className="size-7">
            <a href="/app/calendar">
              <CalendarDays className="size-3.5" />
            </a>
          </Button>
        </div>
      </aside>

      {/* ============== MAIN ============== */}
      <section
        className={[
          "flex h-screen min-w-0 bg-background",
          selectedId ? "flex" : "hidden md:flex",
        ].join(" ")}
      >
        {selectedConv ? (
          <div className="flex flex-1 min-w-0 flex-col">
            {/* Header */}
            <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedId(null)}
                className="md:hidden"
                aria-label="Volver"
              >
                <ArrowLeft className="size-4" />
              </Button>
              <Avatar
                size="md"
                username={
                  dmPeer(selectedConv, me.user.id)?.username ??
                  selectedConv.name ??
                  selectedConv.id
                }
                displayName={displayTitle(selectedConv, me.user.id)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  <Lock className="size-3.5 text-primary" />
                  <span className="truncate">
                    {displayTitle(selectedConv, me.user.id)}
                  </span>
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {selectedConv.type === "group"
                    ? `${selectedConv.members.length} miembros`
                    : selectedConv.members
                        .filter((m) => m.userId !== me.user.id)
                        .map((m) => `@${m.username}`)
                        .join(", ")}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowDocsPanel((v) => !v)}
                title="Documentos de la conversación"
                className={showDocsPanel ? "text-primary" : ""}
              >
                <FolderOpen className="size-4" />
              </Button>
            </header>

            <SecurityBanner conversationId={selectedConv.id} />

            {/* Fase 19: Banner de notificaciones push.
                Solo se muestra si: (a) el usuario aún no decidió y
                (b) no descartó el banner antes (persiste en localStorage). */}
            {pushState === "unknown" && !pushDismissed && (
              <div className="flex items-center justify-between gap-3 border-b border-border bg-primary/5 px-4 py-2 text-xs text-foreground">
                <div className="flex items-center gap-2 min-w-0">
                  <Bell size={13} className="text-primary shrink-0" />
                  <span className="truncate">Activa las notificaciones para no perder mensajes.</span>
                </div>
                <div className="flex gap-2 shrink-0 items-center">
                  <button
                    className="rounded-md bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
                    onClick={() => void subscribeToPush()}
                  >
                    Activar
                  </button>
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setPushDismissed(true);
                      try { localStorage.setItem("euromex.push.dismissed", "1"); } catch {}
                    }}
                    aria-label="Descartar"
                    title="No volver a preguntar"
                  >
                    <BellOff size={13} />
                  </button>
                </div>
              </div>
            )}

            {/* Messages */}
            <div
              ref={scrollRef}
              className="relative flex-1 overflow-y-auto px-4 py-4"
            >
              <Watermark
                username={me.user.username}
                intense={me.user.permissions?.canShareExternally === false}
              />

              <div className="relative z-[2] space-y-1">
                {messages.map((msg) => {
                  if (msg.status === "system" && msg.systemEvent) {
                    return (
                      <SystemNotice
                        key={msg.id}
                        ev={msg.systemEvent}
                        createdAt={msg.createdAt}
                      />
                    );
                  }
                  const mine = msg.senderUserId === me.user.id;
                  const sender = selectedConv.members.find(
                    (m) => m.userId === msg.senderUserId,
                  );
                  // Fase 18: ✓✓ — ¿al menos un miembro (no el sender) leyó hasta aquí?
                  const otherMembers = selectedConv.members.filter((m) => m.userId !== me.user.id);
                  const readByAny = mine && otherMembers.some(
                    (m) => m.lastReadAt && m.lastReadAt >= msg.createdAt,
                  );
                  const readByAll = mine && otherMembers.length > 0 && otherMembers.every(
                    (m) => m.lastReadAt && m.lastReadAt >= msg.createdAt,
                  );
                  const isStarred = starredIds.has(msg.id);
                  // Las cards interactivas (tarea/actividad) tienen su propio
                  // diseño y NO deben envolverse en bubble coloreado — se
                  // renderizan standalone para mantener legibilidad y
                  // contraste consistente.
                  const isInteractiveCard =
                    msg.contentType === ACTIVITY_CONTENT_TYPE ||
                    msg.contentType === TASK_CONTENT_TYPE;

                  if (isInteractiveCard) {
                    return (
                      <div
                        key={msg.id}
                        className={[
                          "group flex gap-2 items-end",
                          mine ? "justify-end" : "justify-start",
                        ].join(" ")}
                      >
                        {!mine && selectedConv.type === "group" && (
                          <Avatar
                            size="xs"
                            username={sender?.username ?? "?"}
                            displayName={sender?.displayName ?? "?"}
                            className="mb-1"
                          />
                        )}
                        <div className="flex flex-col gap-0.5 max-w-[85%] md:max-w-[70%]">
                          {!mine && selectedConv.type === "group" && (
                            <div className="px-1 text-[11px] font-semibold text-primary">
                              {sender?.displayName ?? "?"}
                            </div>
                          )}
                          <MessageBody msg={msg} mine={mine} currentUserId={me.user.id} />
                          <div
                            className={[
                              "px-1 flex items-center gap-1 text-[10px] text-muted-foreground",
                              mine ? "justify-end" : "justify-start",
                            ].join(" ")}
                          >
                            {formatHour(msg.createdAt)}
                            {mine && (
                              <span
                                title={readByAll ? "Visto por todos" : readByAny ? "Visto" : "Enviado"}
                                className={readByAny ? "text-blue-600" : "opacity-60"}
                              >
                                {readByAny ? "✓✓" : "✓"}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={msg.id}
                      className={[
                        "group flex gap-2",
                        mine ? "justify-end" : "justify-start",
                      ].join(" ")}
                    >
                      {!mine && selectedConv.type === "group" && (
                        <Avatar
                          size="xs"
                          username={sender?.username ?? "?"}
                          displayName={sender?.displayName ?? "?"}
                          className="mt-1"
                        />
                      )}
                      {/* ⭐ Star button — aparece al hover, del lado opuesto al bubble */}
                      {mine && (
                        <button
                          type="button"
                          className="self-center opacity-0 group-hover:opacity-100 transition text-yellow-500/60 hover:text-yellow-600"
                          title={isStarred ? "Quitar de guardados" : "Guardar mensaje"}
                          onClick={() => void handleStar(msg.id, selectedConv.id)}
                        >
                          <Star size={13} fill={isStarred ? "currentColor" : "none"} />
                        </button>
                      )}
                      <div
                        className={[
                          "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm md:max-w-[65%]",
                          mine
                            ? "rounded-br-sm bg-primary text-primary-foreground"
                            : "rounded-bl-sm bg-card text-card-foreground ring-1 ring-border",
                        ].join(" ")}
                      >
                        {!mine && selectedConv.type === "group" && (
                          <div className="mb-0.5 text-[11px] font-semibold text-primary">
                            {sender?.displayName ?? "?"}
                          </div>
                        )}
                        <MessageBody msg={msg} mine={mine} currentUserId={me.user.id} />
                        <div
                          className={[
                            "mt-1 flex items-center justify-end gap-1 text-[10px]",
                            mine ? "text-primary-foreground/70" : "text-muted-foreground",
                          ].join(" ")}
                        >
                          {formatHour(msg.createdAt)}
                          {/* Fase 18: ✓✓ read receipts (solo mensajes propios) */}
                          {mine && (
                            <span
                              title={readByAll ? "Visto por todos" : readByAny ? "Visto" : "Enviado"}
                              className={readByAny ? "text-blue-600" : "opacity-50"}
                            >
                              {readByAny ? "✓✓" : "✓"}
                            </span>
                          )}
                        </div>
                      </div>
                      {/* ⭐ Star button para mensajes recibidos */}
                      {!mine && (
                        <button
                          type="button"
                          className="self-center opacity-0 group-hover:opacity-100 transition text-yellow-500/60 hover:text-yellow-600"
                          title={isStarred ? "Quitar de guardados" : "Guardar mensaje"}
                          onClick={() => void handleStar(msg.id, selectedConv.id)}
                        >
                          <Star size={13} fill={isStarred ? "currentColor" : "none"} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Composer */}
            <form
              onSubmit={onSend}
              className="border-t border-border bg-card px-3 py-3"
            >
              {error && (
                <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                  {error}{" "}
                  <button
                    type="button"
                    onClick={() => setError(null)}
                    className="ml-1 font-medium underline"
                  >
                    cerrar
                  </button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={onPickFile}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || sending}
                  title="Adjuntar archivo"
                >
                  {uploading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Paperclip className="size-4" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowActivityModal(true)}
                  disabled={uploading || sending}
                  title="Nueva actividad"
                >
                  <CalendarPlus className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowTaskModal(true)}
                  disabled={uploading || sending}
                  title="Nueva tarea"
                >
                  <ClipboardList className="size-4" />
                </Button>
                <div className="relative flex-1">
                  {/* Fase 19: @mention autocomplete dropdown */}
                  {mentionQuery !== null && selectedConv && (() => {
                    const q = mentionQuery.toLowerCase();
                    const filtered = selectedConv.members.filter(
                      (m) => m.userId !== me.user.id &&
                        (m.username.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q)),
                    );
                    if (filtered.length === 0) return null;
                    return (
                      <div className="absolute bottom-full mb-1 left-0 w-full bg-popover text-popover-foreground border border-border rounded-lg overflow-hidden shadow-xl z-50 max-h-40 overflow-y-auto">
                        {filtered.map((m) => (
                          <button
                            key={m.userId}
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              // Reemplaza el último @query con @username
                              setDraft((d) => d.replace(/@[\w.]*$/, `@${m.username} `));
                              setMentionQuery(null);
                            }}
                          >
                            <span className="font-medium text-primary">@{m.username}</span>
                            <span className="text-muted-foreground text-xs">{m.displayName}</span>
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                  <Input
                    ref={composerRef}
                    value={draft}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDraft(val);
                      // Detectar si estamos escribiendo una mención @
                      const match = val.match(/@([\w.]*)$/);
                      setMentionQuery(match ? (match[1] ?? null) : null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setMentionQuery(null);
                    }}
                    placeholder={
                      uploading
                        ? "Cifrando y subiendo…"
                        : "Escribe un mensaje cifrado…"
                    }
                    disabled={sending || uploading}
                    className="h-10 rounded-full px-4"
                    autoFocus
                  />
                </div>
                <Button
                  type="submit"
                  size="icon"
                  disabled={sending || uploading || !draft.trim()}
                  title="Enviar"
                  className="rounded-full"
                >
                  {sending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </Button>
              </div>
            </form>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="max-w-sm text-center">
              <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Lock className="size-6" />
              </div>
              <h2 className="text-lg font-semibold">
                Selecciona una conversación
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                O crea una nueva desde el botón <strong>+ Nueva conversación</strong>{" "}
                en la barra lateral.
              </p>
            </div>
          </div>
        )}

        {/* Fases 14+17: Panel de medios lateral */}
        {showDocsPanel && selectedConv && (
          <MediaPanel
            conversationId={selectedConv.id}
            messageCache={attachmentCache}
            messages={messages}
            currentUserId={me.user.id}
            onClose={() => setShowDocsPanel(false)}
          />
        )}
      </section>

      {/* Fase 14: Modal de opciones de envío para grupos */}
      {pendingFile && selectedConv && (
        <AttachmentOptionsModal
          file={pendingFile}
          members={selectedConv.members}
          currentUserId={me.user.id}
          onConfirm={(opts) => {
            const f = pendingFile;
            setPendingFile(null);
            doUploadFile(f, opts);
          }}
          onCancel={() => setPendingFile(null)}
        />
      )}

      {/* Fase 15: Modal nueva actividad */}
      {showActivityModal && selectedConv && (
        <CreateActivityModal
          conversationId={selectedConv.id}
          members={selectedConv.members}
          currentUserId={me.user.id}
          onCreated={() => {}}
          onClose={() => setShowActivityModal(false)}
        />
      )}

      {/* Fase 15: Modal nueva tarea */}
      {showTaskModal && selectedConv && (
        <CreateTaskModal
          conversationId={selectedConv.id}
          members={selectedConv.members}
          currentUserId={me.user.id}
          onCreated={() => {}}
          onClose={() => setShowTaskModal(false)}
        />
      )}

      <NewConversationDialog
        open={showNew}
        onOpenChange={setShowNew}
        currentUserId={me.user.id}
        onCreated={async (convId) => {
          setShowNew(false);
          await refreshConversations();
          setSelectedId(convId);
        }}
      />
    </div>
  );
}

function MessageBody({ msg, mine, currentUserId }: { msg: RenderedMessage; mine: boolean; currentUserId: string }) {
  if (msg.status === "restricted_attachment" && msg.attachmentRestricted) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Lock className="size-3.5 shrink-0 text-amber-600" />
        <span>Documento restringido — Solo ciertos miembros tienen acceso</span>
      </div>
    );
  }
  if (msg.contentType === ACTIVITY_CONTENT_TYPE && msg.content) {
    try {
      const payload = JSON.parse(msg.content);
      return <ActivityCard payload={payload} currentUserId={currentUserId} />;
    } catch {
      return <em className="opacity-80 text-xs">⚠ error al parsear actividad</em>;
    }
  }
  if (msg.contentType === TASK_CONTENT_TYPE && msg.content) {
    try {
      const payload = JSON.parse(msg.content);
      return <TaskCard payload={payload} currentUserId={currentUserId} />;
    } catch {
      return <em className="opacity-80 text-xs">⚠ error al parsear tarea</em>;
    }
  }
  if (msg.status === "ok" && msg.attachment) {
    return <AttachmentBubble att={msg.attachment} mine={mine} />;
  }
  if (msg.status === "ok") {
    return <span className="whitespace-pre-wrap">{msg.plaintext}</span>;
  }
  if (msg.status === "legacy") {
    return (
      <span className="italic opacity-80">
        📜 (sin cifrar · Fase 3) {msg.plaintext}
      </span>
    );
  }
  if (msg.status === "no_envelope") {
    // Placeholder cuando el mensaje fue enviado antes de que existiera este
    // device. Necesita opacity alto (90%) para ser legible en bubbles del
    // emisor (texto blanco sobre azul) — un 60% se veía casi invisible.
    return (
      <em className="opacity-90 text-xs">
        🔒 Mensaje anterior a este dispositivo
      </em>
    );
  }
  return <em className="opacity-90">⚠ error al descifrar</em>;
}
