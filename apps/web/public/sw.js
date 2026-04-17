/**
 * Service worker de Euromex Chat.
 *
 * Diseño cauteloso con E2EE:
 *   • NUNCA cacheamos respuestas del API (`:4000`) — aunque son ciphertext,
 *     mezclar cache con auth mutables es riesgoso. Son cross-origin así que
 *     ni siquiera entran a este SW, pero lo dejamos documentado.
 *   • Para assets estáticos (JS/CSS/chunks de Next) usamos cache-first con
 *     revalidación en background — ahorran data en móvil.
 *   • Para páginas HTML (same-origin) usamos network-first con fallback a
 *     cache si no hay red — permite abrir la app offline, aunque la lista
 *     de mensajes requiere conectividad.
 *   • Ignoramos explícitamente `/socket.io/*` (no cross-origin? por si acaso).
 */

const VERSION = "v1";
const STATIC_CACHE = `euromex-static-${VERSION}`;
const PAGE_CACHE = `euromex-pages-${VERSION}`;
const OFFLINE_URL = "/offline.html";

const PRECACHE = [OFFLINE_URL, "/manifest.webmanifest", "/icon", "/apple-icon"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // Best-effort: no fallamos la instalación si algún asset no existe.
      await Promise.allSettled(PRECACHE.map((u) => cache.add(u)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== PAGE_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Solo interceptamos same-origin. API y socket.io van a otro origin.
  if (url.origin !== self.location.origin) return;

  // No cachear socket.io por si algún día lo servimos desde el mismo origen.
  if (url.pathname.startsWith("/socket.io/")) return;

  // Estrategia cache-first para assets estáticos de Next.js.
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/icon" ||
    url.pathname === "/apple-icon"
  ) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Navegación HTML: network-first, fallback a cache, último fallback a offline.
  const isNavigation =
    req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");
  if (isNavigation) {
    event.respondWith(networkFirst(req));
    return;
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    // Sin red y sin cache: deja que el browser muestre su error.
    throw err;
  }
}

async function networkFirst(req) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}
