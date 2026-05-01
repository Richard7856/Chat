/**
 * Rutas de Web Push: suscribir / desuscribir dispositivos.
 *
 * El cliente llama a POST /push/subscribe con el objeto PushSubscription
 * generado por el browser y lo vincula al device_id del JWT actual.
 * Si el usuario desinstala la PWA o revoca permisos, llama DELETE.
 */

import type { FastifyInstance } from "fastify";
import { PushSubscribeRequestSchema } from "@euromex/shared";
import { requireAuth } from "../auth/jwt.js";
import { pool } from "../db/pg.js";
import { config } from "../config.js";

export async function pushRoutes(app: FastifyInstance) {
  // --------------------------------------------------------------------------
  // GET /push/vapid-key — devuelve la VAPID public key para que el cliente
  // la use al llamar a pushManager.subscribe().
  // --------------------------------------------------------------------------
  app.get("/push/vapid-key", async (_req, _reply) => {
    return { vapidPublicKey: config.vapidPublicKey };
  });

  // --------------------------------------------------------------------------
  // POST /push/subscribe — registra o actualiza la suscripción del dispositivo.
  // Un dispositivo solo puede tener UNA suscripción activa (UNIQUE en device_id).
  // --------------------------------------------------------------------------
  app.post(
    "/push/subscribe",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const parsed = PushSubscribeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      }
      const { endpoint, p256dh, auth } = parsed.data;
      const userId = req.session!.sub;
      const deviceId = req.session!.did;

      // Upsert: si ya existe la entrada del dispositivo, actualizar el endpoint.
      // Puede cambiar si el browser rota el endpoint (infrecuente pero posible).
      await pool.query(
        `INSERT INTO push_subscriptions (user_id, device_id, endpoint, p256dh, auth)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (device_id) DO UPDATE
           SET endpoint = EXCLUDED.endpoint,
               p256dh   = EXCLUDED.p256dh,
               auth     = EXCLUDED.auth`,
        [userId, deviceId, endpoint, p256dh, auth],
      );

      return reply.code(204).send();
    },
  );

  // --------------------------------------------------------------------------
  // DELETE /push/subscribe — elimina la suscripción del dispositivo actual.
  // El cliente lo llama cuando el usuario desactiva las notificaciones.
  // --------------------------------------------------------------------------
  app.delete(
    "/push/subscribe",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      await pool.query(
        "DELETE FROM push_subscriptions WHERE device_id = $1",
        [req.session!.did],
      );
      return reply.code(204).send();
    },
  );
}
