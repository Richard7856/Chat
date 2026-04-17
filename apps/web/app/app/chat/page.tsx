"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AttachmentPayload,
  Conversation,
  DeviceKey,
  Message,
  UserListItem,
} from "@euromex/shared";
import { ATTACHMENT_CONTENT_TYPE } from "@euromex/shared";
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
import {
  downloadFileToUser,
  encryptAndUpload,
  formatBytes,
} from "../../lib/attachments";

interface MeResponse {
  user: {
    id: string;
    username: string;
    displayName: string;
    email: string | null;
    role: "user" | "admin";
  };
  device: {
    id: string;
    deviceName: string;
    platform: "web" | "ios" | "android" | "desktop";
    lastSeenAt: string | null;
  };
}

interface RenderedMessage extends Message {
  plaintext: string | null;
  /** 'ok' | 'legacy' (texto plano Fase 3) | 'no_envelope' | 'decrypt_error' */
  status: "ok" | "legacy" | "no_envelope" | "decrypt_error";
  /** Parsed payload cuando contentType === ATTACHMENT_CONTENT_TYPE. */
  attachment?: AttachmentPayload;
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
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Cache de claves públicas por deviceId (para descifrar mensajes entrantes
   *  y cifrar los salientes). Se refresca al entrar a una conversación. */
  const deviceKeysRef = useRef<DeviceKeyMap>({});

  const selectedConv = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  const decryptMessage = useCallback(
    async (msg: Message, kp: IdentityKeypair): Promise<RenderedMessage> => {
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
        const attachment =
          msg.contentType === ATTACHMENT_CONTENT_TYPE
            ? (JSON.parse(text) as AttachmentPayload)
            : undefined;
        return { ...msg, plaintext: text, status: "ok", attachment };
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

  // Bootstrap: sesión + me + keypair + conversaciones + socket
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

    return () => {
      closeSocket();
    };
  }, [router, refreshConversations]);

  // Socket: escucha mensajes y conversaciones nuevas
  useEffect(() => {
    if (!me || !myKeypair) return;
    const socket = getSocket();

    const onNew = async (msg: Message) => {
      // Si el sender no está en cache, refresca las device-keys.
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

    socket.on("message:new", onNew);
    socket.on("conversation:updated", onConvUpdated);
    return () => {
      socket.off("message:new", onNew);
      socket.off("conversation:updated", onConvUpdated);
    };
  }, [me, myKeypair, decryptMessage, refreshDeviceKeys]);

  // Mantiene ref con selectedId para handlers del socket
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // Carga mensajes + device keys al cambiar de conversación
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

  /**
   * Cifra un plaintext (bytes) y lo envía al server. Hace el fan-out por
   * dispositivo destinatario y la inserción optimista local.
   */
  const sendEncrypted = useCallback(
    async (params: {
      plaintextBytes: Uint8Array;
      contentType: string;
      /** Plaintext que la UI conoce para mostrar sin descifrar. */
      localPlaintext: string;
      /** Payload de adjunto ya parseado (si aplica) para render optimista. */
      attachment?: AttachmentPayload;
    }): Promise<void> => {
      if (!selectedId || !myKeypair) throw new Error("no_conversation");
      await refreshDeviceKeys(selectedId);
      const recipients = Object.values(deviceKeysRef.current).filter(
        (d) => d.identityPublicKey,
      );
      if (recipients.length === 0) {
        throw new Error("No hay dispositivos con clave pública publicada.");
      }
      const envelopes = await Promise.all(
        recipients.map(async (d) => {
          const peerPub = await fromBase64(d.identityPublicKey!);
          const env = await encryptFor(
            params.plaintextBytes,
            peerPub,
            myKeypair.privateKey,
          );
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
          },
        ];
      });
    },
    [selectedId, myKeypair, refreshDeviceKeys],
  );

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !draft.trim() || !me || !myKeypair) return;
    const content = draft.trim();
    setDraft("");
    setSending(true);
    try {
      await sendEncrypted({
        plaintextBytes: await encodeUtf8(content),
        contentType: "text/plain",
        localPlaintext: content,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "send_failed");
      setDraft(content);
    } finally {
      setSending(false);
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite re-seleccionar el mismo archivo luego
    if (!file || !selectedId || !myKeypair) return;

    setUploading(true);
    setError(null);
    try {
      const upload = await encryptAndUpload(selectedId, file);
      const payload: AttachmentPayload = {
        kind: "attachment",
        attachmentId: upload.attachmentId,
        fileName: upload.fileName,
        mime: upload.mime,
        byteSize: upload.byteSize,
        fileKey: upload.fileKey,
        fileIv: upload.fileIv,
      };
      const json = JSON.stringify(payload);
      await sendEncrypted({
        plaintextBytes: await encodeUtf8(json),
        contentType: ATTACHMENT_CONTENT_TYPE,
        localPlaintext: json,
        attachment: payload,
      });
    } catch (err) {
      setError(
        err instanceof Error ? `Subida falló: ${err.message}` : "upload_failed",
      );
    } finally {
      setUploading(false);
    }
  }

  async function onLogout() {
    try {
      await api("/auth/logout", { method: "POST", auth: true });
    } catch {}
    if (me) clearKeypair(me.device.id);
    clearSession();
    closeSocket();
    router.replace("/login");
  }

  if (loading) {
    return (
      <main className="shell">
        <p className="tagline">Cargando chat…</p>
      </main>
    );
  }
  if (error || !me) {
    return (
      <main className="shell">
        <h1>Sesión inválida</h1>
        <p className="error">{error ?? "no autenticado"}</p>
        <a href="/login">Volver a iniciar sesión</a>
      </main>
    );
  }

  return (
    <div className="chat-root" data-view={selectedId ? "detail" : "list"}>
      <aside className="chat-sidebar">
        <header className="chat-sidebar-header">
          <div>
            <strong>{me.user.displayName}</strong>
            <span className="muted">@{me.user.username}</span>
          </div>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setShowNew(true)}
            >
              + Nueva
            </button>
            <button type="button" className="secondary" onClick={onLogout}>
              Salir
            </button>
          </div>
        </header>

        <ul className="conv-list">
          {conversations.length === 0 && (
            <li className="empty">
              No tienes conversaciones todavía. Usa <strong>+ Nueva</strong>.
            </li>
          )}
          {conversations.map((conv) => (
            <li
              key={conv.id}
              className={selectedId === conv.id ? "selected" : ""}
              onClick={() => setSelectedId(conv.id)}
            >
              <div className="conv-title">
                {displayTitle(conv, me.user.id)}
                {conv.unreadCount > 0 && (
                  <span className="badge">{conv.unreadCount}</span>
                )}
              </div>
              <div className="conv-preview">
                {conv.lastMessage
                  ? (conv.lastMessage.content ?? "🔒 mensaje cifrado")
                  : "(sin mensajes)"}
              </div>
            </li>
          ))}
        </ul>
      </aside>

      <section className="chat-main">
        {selectedConv ? (
          <>
            <header className="chat-main-header">
              <h2>
                <button
                  type="button"
                  className="back-btn"
                  onClick={() => setSelectedId(null)}
                  aria-label="Volver"
                >
                  ←
                </button>
                <span className="lock" title="Cifrado de extremo a extremo">
                  🔒
                </span>{" "}
                {displayTitle(selectedConv, me.user.id)}
              </h2>
              <p className="muted">
                {selectedConv.type === "group"
                  ? `${selectedConv.members.length} miembros`
                  : selectedConv.members
                      .filter((m) => m.userId !== me.user.id)
                      .map((m) => `@${m.username}`)
                      .join(", ")}
              </p>
            </header>

            <div ref={scrollRef} className="messages">
              {messages.map((msg) => {
                const mine = msg.senderUserId === me.user.id;
                const sender = selectedConv.members.find(
                  (m) => m.userId === msg.senderUserId,
                );
                return (
                  <div
                    key={msg.id}
                    className={`bubble ${mine ? "mine" : "theirs"}`}
                  >
                    {!mine && selectedConv.type === "group" && (
                      <div className="bubble-sender">
                        {sender?.displayName ?? "?"}
                      </div>
                    )}
                    <div className="bubble-text">
                      {msg.status === "ok" && msg.attachment && (
                        <AttachmentBubble att={msg.attachment} />
                      )}
                      {msg.status === "ok" && !msg.attachment && msg.plaintext}
                      {msg.status === "legacy" && (
                        <>
                          <span className="warn-inline">📜 sin cifrar</span>{" "}
                          {msg.plaintext}
                        </>
                      )}
                      {msg.status === "no_envelope" && (
                        <em>🔒 este dispositivo no puede descifrar este mensaje</em>
                      )}
                      {msg.status === "decrypt_error" && (
                        <em>⚠️ error al descifrar</em>
                      )}
                    </div>
                    <div className="bubble-time">
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <form className="composer" onSubmit={onSend}>
              <input
                ref={fileInputRef}
                type="file"
                onChange={onPickFile}
                style={{ display: "none" }}
              />
              <button
                type="button"
                className="attach-btn"
                title="Adjuntar archivo"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || sending}
              >
                📎
              </button>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  uploading ? "Cifrando y subiendo…" : "Escribe un mensaje cifrado…"
                }
                disabled={sending || uploading}
                autoFocus
              />
              <button
                type="submit"
                disabled={sending || uploading || !draft.trim()}
              >
                {sending ? "…" : "Enviar"}
              </button>
            </form>
          </>
        ) : (
          <div className="empty-main">
            <p>Selecciona una conversación o crea una nueva.</p>
          </div>
        )}
      </section>

      {showNew && (
        <NewConversationDialog
          currentUserId={me.user.id}
          onClose={() => setShowNew(false)}
          onCreated={async (convId) => {
            setShowNew(false);
            await refreshConversations();
            setSelectedId(convId);
          }}
        />
      )}
    </div>
  );
}

function displayTitle(conv: Conversation, meId: string): string {
  if (conv.type === "group") return conv.name ?? "Grupo";
  const other = conv.members.find((m) => m.userId !== meId);
  return other ? other.displayName : "(solo tú)";
}

function fileIconFor(mime: string): string {
  if (mime.startsWith("image/")) return "🖼️";
  if (mime.startsWith("video/")) return "🎬";
  if (mime.startsWith("audio/")) return "🎵";
  if (mime === "application/pdf") return "📕";
  if (mime.includes("spreadsheet") || mime.includes("excel")) return "📊";
  if (mime.includes("word") || mime.includes("document")) return "📝";
  if (mime.includes("zip") || mime.includes("compressed")) return "🗜️";
  return "📎";
}

function AttachmentBubble({ att }: { att: AttachmentPayload }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "download_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="attachment">
      <span className="attachment-icon">{fileIconFor(att.mime)}</span>
      <div className="attachment-meta">
        <div className="attachment-name" title={att.fileName}>
          {att.fileName}
        </div>
        <div className="attachment-size">{formatBytes(att.byteSize)}</div>
      </div>
      <button
        type="button"
        className="attachment-dl"
        onClick={onDownload}
        disabled={busy}
        title="Descargar y descifrar"
      >
        {busy ? "…" : "⬇"}
      </button>
      {err && <div className="attachment-err">Error: {err}</div>}
    </div>
  );
}

function NewConversationDialog({
  currentUserId,
  onClose,
  onCreated,
}: {
  currentUserId: string;
  onClose: () => void;
  onCreated: (convId: string) => void;
}) {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [type, setType] = useState<"dm" | "group">("dm");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ users: UserListItem[] }>("/users", { method: "GET", auth: true })
      .then((r) => setUsers(r.users))
      .catch((e) => setErr(e instanceof Error ? e.message : "error"));
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else {
        if (type === "dm") n.clear();
        n.add(id);
      }
      return n;
    });
  }

  async function onCreate() {
    setErr(null);
    setBusy(true);
    try {
      if (type === "dm" && selected.size !== 1) {
        throw new Error("Selecciona exactamente un usuario para DM");
      }
      if (type === "group" && !name.trim()) {
        throw new Error("El grupo necesita un nombre");
      }
      if (selected.size === 0) {
        throw new Error("Selecciona al menos un miembro");
      }
      const res = await api<Conversation>("/conversations", {
        auth: true,
        body: {
          type,
          name: type === "group" ? name.trim() : undefined,
          memberUserIds: Array.from(selected),
        },
      });
      onCreated(res.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>Nueva conversación</h3>
          <button type="button" className="secondary" onClick={onClose}>
            Cerrar
          </button>
        </header>

        <div className="tabs">
          <button
            type="button"
            className={type === "dm" ? "active" : ""}
            onClick={() => {
              setType("dm");
              setSelected(new Set());
            }}
          >
            Directo (1-a-1)
          </button>
          <button
            type="button"
            className={type === "group" ? "active" : ""}
            onClick={() => setType("group")}
          >
            Grupo
          </button>
        </div>

        {type === "group" && (
          <label>
            <span>Nombre del grupo</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contabilidad, Proyectos 2026…"
            />
          </label>
        )}

        <div className="user-list">
          {users.length === 0 && (
            <p className="muted">
              No hay otros usuarios todavía. Emite invitaciones desde el
              panel admin.
            </p>
          )}
          {users
            .filter((u) => u.id !== currentUserId)
            .map((u) => (
              <label key={u.id} className="user-row">
                <input
                  type={type === "dm" ? "radio" : "checkbox"}
                  name="member"
                  checked={selected.has(u.id)}
                  onChange={() => toggle(u.id)}
                />
                <span>
                  <strong>{u.displayName}</strong>{" "}
                  <span className="muted">@{u.username}</span>
                </span>
              </label>
            ))}
        </div>

        {err && <p className="error">Error: {err}</p>}

        <footer>
          <button type="button" onClick={onCreate} disabled={busy}>
            {busy ? "Creando…" : "Crear"}
          </button>
        </footer>
      </div>
    </div>
  );
}
