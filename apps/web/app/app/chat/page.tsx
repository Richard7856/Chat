"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  Conversation,
  Message,
  UserListItem,
} from "@euromex/shared";
import { api, clearSession, loadSession } from "../../lib/api";
import { closeSocket, getSocket } from "../../lib/socket";

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

export default function ChatPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const selectedConv = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  const refreshConversations = useCallback(async () => {
    const r = await api<{ conversations: Conversation[] }>("/conversations", {
      method: "GET",
      auth: true,
    });
    setConversations(r.conversations);
  }, []);

  // Bootstrap: sesión + me + conversaciones + socket
  useEffect(() => {
    if (!loadSession()) {
      router.replace("/login");
      return;
    }
    (async () => {
      try {
        const [meRes] = await Promise.all([
          api<MeResponse>("/auth/me", { method: "GET", auth: true }),
          refreshConversations(),
        ]);
        setMe(meRes);
      } catch (err) {
        setError(err instanceof Error ? err.message : "error");
        clearSession();
      } finally {
        setLoading(false);
      }
    })();

    const socket = getSocket();
    socket.on("message:new", (msg) => {
      setMessages((prev) => {
        if (msg.conversationId !== selectedIdRef.current) return prev;
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === msg.conversationId);
        if (idx < 0) return prev;
        const updated = [...prev];
        const conv = { ...updated[idx]! };
        conv.lastMessage = {
          id: msg.id,
          senderUserId: msg.senderUserId,
          content: msg.content,
          createdAt: msg.createdAt,
        };
        if (msg.conversationId !== selectedIdRef.current) {
          conv.unreadCount = conv.unreadCount + 1;
        }
        updated.splice(idx, 1);
        return [conv, ...updated];
      });
    });
    socket.on("conversation:updated", (conv) => {
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === conv.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = conv;
          return copy;
        }
        return [conv, ...prev];
      });
    });

    return () => {
      closeSocket();
    };
  }, [router, refreshConversations]);

  // Mantiene una ref con selectedId para usarla dentro del handler del socket
  // sin re-suscribirse cada vez que cambia.
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // Carga mensajes al cambiar de conversación
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    (async () => {
      const r = await api<{ messages: Message[] }>(
        `/conversations/${selectedId}/messages?limit=50`,
        { method: "GET", auth: true },
      );
      setMessages(r.messages);
      try {
        await api(`/conversations/${selectedId}/read`, { method: "POST", auth: true });
      } catch {}
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId ? { ...c, unreadCount: 0 } : c,
        ),
      );
    })();
  }, [selectedId]);

  // Auto-scroll al final cuando llegan mensajes
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !draft.trim() || !me) return;
    const content = draft.trim();
    const clientId = crypto.randomUUID();
    setDraft("");
    setSending(true);
    try {
      const socket = getSocket();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout")), 10_000);
        socket.emit(
          "message:send",
          { conversationId: selectedId, content, clientId },
          (res) => {
            clearTimeout(timer);
            if (!res.ok) return reject(new Error(res.error));
            resolve();
          },
        );
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "send_failed");
      setDraft(content);
    } finally {
      setSending(false);
    }
  }

  async function onLogout() {
    try {
      await api("/auth/logout", { method: "POST", auth: true });
    } catch {}
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
    <div className="chat-root">
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
                {conv.lastMessage?.content ?? "(sin mensajes)"}
              </div>
            </li>
          ))}
        </ul>
      </aside>

      <section className="chat-main">
        {selectedConv ? (
          <>
            <header className="chat-main-header">
              <h2>{displayTitle(selectedConv, me.user.id)}</h2>
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
                    <div className="bubble-text">{msg.content}</div>
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
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Escribe un mensaje…"
                disabled={sending}
                autoFocus
              />
              <button type="submit" disabled={sending || !draft.trim()}>
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
