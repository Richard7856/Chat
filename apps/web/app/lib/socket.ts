"use client";

import { io, Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@euromex/shared";
import { loadSession } from "./api";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

export type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let current: ChatSocket | null = null;

export function getSocket(): ChatSocket {
  const session = loadSession();
  if (!session) throw new Error("no_session");

  if (current?.connected && current.auth && (current.auth as { token?: string }).token === session.accessToken) {
    return current;
  }

  current?.disconnect();
  current = io(API_BASE, {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    auth: { token: session.accessToken },
    reconnection: true,
    reconnectionAttempts: 10,
  }) as ChatSocket;

  return current;
}

export function closeSocket() {
  current?.disconnect();
  current = null;
}
