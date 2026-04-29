import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import * as argon2 from "argon2";
import {
  AttachmentDownloadedNotifySchema,
  SYSTEM_CONTENT_TYPE,
  type AttachmentListItem,
  type SystemEvent,
  type UploadAttachmentResponse,
} from "@euromex/shared";
import { requireAuth } from "../auth/jwt.js";
import {
  getAlertWatchersInConversation,
  insertSystemMessage,
  isConversationMember,
} from "../chat/repo.js";
import {
  getAttachmentForUser,
  getAttachmentsForConversation,
  insertAttachment,
  insertAttachmentAllowedUsers,
  isAttachmentAllowed,
} from "../chat/attachments-repo.js";
import { broadcastSystemMessage } from "../chat/socket.js";
import {
  blobExists,
  deleteBlob,
  generateStorageKey,
  streamBlob,
  writeBlob,
} from "../storage/files.js";
import { config } from "../config.js";
import { pool } from "../db/pg.js";

export async function attachmentRoutes(app: FastifyInstance) {
  // --------------------------------------------------------------------------
  // GET /conversations/:id/attachments — biblioteca de documentos
  // Devuelve la lista de adjuntos subidos en la conversación con metadatos
  // de acceso (quién tiene permiso, si tiene PIN) pero sin la clave AES
  // (que sigue viviendo en el mensaje E2EE).
  // --------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/conversations/:id/attachments",
    { preHandler: [requireAuth] },
    async (req, reply): Promise<{ attachments: AttachmentListItem[] }> => {
      const userId = req.session!.sub;
      const conversationId = req.params.id;

      if (!(await isConversationMember(userId, conversationId))) {
        return reply.code(403).send({ error: "not_a_member" });
      }

      const attachments = await getAttachmentsForConversation(conversationId);
      return { attachments };
    },
  );

  // --------------------------------------------------------------------------
  // POST /conversations/:id/attachments — sube un blob ya cifrado.
  // Body: multipart/form-data con campo "file" + campos de texto opcionales
  // para PIN y lista de usuarios con acceso.
  //
  // Campos extra opcionales (como campos de texto en el multipart):
  //   downloadPin   — texto plano; se hashea con argon2 y se guarda
  //   allowedUserIds — JSON array de UUIDs; si está, acceso = 'restricted'
  // --------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/conversations/:id/attachments",
    { preHandler: [requireAuth] },
    async (req, reply): Promise<UploadAttachmentResponse> => {
      const userId = req.session!.sub;
      const deviceId = req.session!.did;
      const conversationId = req.params.id;

      if (!(await isConversationMember(userId, conversationId))) {
        return reply.code(403).send({ error: "not_a_member" });
      }

      // Acepta un campo file + campos de texto opcionales para PIN y acceso.
      let downloadPin: string | undefined;
      let allowedUserIds: string[] | undefined;

      const parts = req.parts({
        limits: {
          fileSize: config.maxAttachmentBytes,
          files: 1,
          fields: 2, // downloadPin + allowedUserIds
        },
      });

      let storageKey: string | null = null;
      let byteSize = 0;
      let truncated = false;

      for await (const part of parts) {
        if (part.type === "file" && part.fieldname === "file") {
          storageKey = generateStorageKey();
          try {
            byteSize = await writeBlob(storageKey, part.file);
          } catch (err) {
            if (storageKey) await deleteBlob(storageKey).catch(() => {});
            req.log.error({ err }, "attachment.upload failed");
            return reply.code(500).send({ error: "upload_failed" });
          }
          truncated = part.file.truncated;
        } else if (part.type === "field") {
          if (part.fieldname === "downloadPin" && typeof part.value === "string" && part.value.length > 0) {
            downloadPin = part.value;
          } else if (part.fieldname === "allowedUserIds" && typeof part.value === "string") {
            try {
              const parsed = JSON.parse(part.value);
              if (Array.isArray(parsed)) {
                allowedUserIds = parsed.filter((v): v is string => typeof v === "string");
              }
            } catch {
              // ignorar JSON mal formado
            }
          }
        }
      }

      if (!storageKey) {
        return reply.code(400).send({ error: "missing_file" });
      }

      if (truncated) {
        await deleteBlob(storageKey).catch(() => {});
        return reply.code(413).send({ error: "file_too_large" });
      }

      // Hashear el PIN si fue provisto.
      let downloadPinHash: string | undefined;
      if (downloadPin) {
        downloadPinHash = await argon2.hash(downloadPin, { type: argon2.argon2id });
      }

      const accessType = allowedUserIds && allowedUserIds.length > 0 ? "restricted" : "all";

      const { id: attachmentId } = await insertAttachment({
        conversationId,
        uploaderUserId: userId,
        uploaderDeviceId: deviceId,
        storageKey,
        byteSize,
        downloadPinHash,
        accessType,
      });

      // Insertar lista blanca si es acceso restringido.
      // El uploader siempre tiene acceso implícito, pero lo agregamos
      // explícitamente para simplificar las queries de validación.
      if (accessType === "restricted" && allowedUserIds) {
        const withUploader = Array.from(new Set([userId, ...allowedUserIds]));
        await insertAttachmentAllowedUsers(attachmentId, withUploader);
      }

      return { attachmentId, byteSize };
    },
  );

  // --------------------------------------------------------------------------
  // POST /attachments/:id/downloaded — el cliente notifica al server que
  // descargó+descifró exitosamente el archivo.
  // --------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/attachments/:id/downloaded",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const userId = req.session!.sub;
      const deviceId = req.session!.did;

      const att = await getAttachmentForUser(req.params.id, userId);
      if (!att) return reply.code(404).send({ error: "not_found" });

      const parsed = AttachmentDownloadedNotifySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      }

      const actor = await pool.query<{ username: string; display_name: string }>(
        "SELECT username, display_name FROM users WHERE id = $1",
        [userId],
      );
      const a = actor.rows[0];
      if (!a) return reply.code(404).send({ error: "actor_not_found" });

      const event: SystemEvent = {
        kind: "attachment_downloaded",
        actor: { userId, username: a.username, displayName: a.display_name },
        target: {
          attachmentId: req.params.id,
          fileName: parsed.data.fileName,
          byteSize: parsed.data.byteSize,
        },
      };

      const { messageId, createdAt } = await insertSystemMessage({
        conversationId: att.conversation_id,
        senderUserId: userId,
        senderDeviceId: deviceId,
        content: JSON.stringify(event),
        contentType: SYSTEM_CONTENT_TYPE,
      });

      await pool.query(
        `INSERT INTO audit_log (user_id, device_id, action, metadata, ip, user_agent)
         VALUES ($1, $2, 'attachment.downloaded', $3::jsonb, $4, $5)`,
        [
          userId,
          deviceId,
          JSON.stringify({
            attachmentId: req.params.id,
            conversationId: att.conversation_id,
            fileName: parsed.data.fileName,
          }),
          req.ip,
          req.headers["user-agent"] ?? null,
        ],
      );

      const watcherUserIds = await getAlertWatchersInConversation(att.conversation_id);
      broadcastSystemMessage(app, {
        messageId,
        conversationId: att.conversation_id,
        actorUserId: userId,
        actorDeviceId: deviceId,
        contentJson: JSON.stringify(event),
        contentType: SYSTEM_CONTENT_TYPE,
        createdAt,
        watcherUserIds,
      });

      return reply.code(204).send();
    },
  );

  // --------------------------------------------------------------------------
  // GET /attachments/:id/download — devuelve el ciphertext crudo.
  // Verifica: membresía, acceso (si restricted), PIN (si configurado).
  // --------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/attachments/:id/download",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const userId = req.session!.sub;
      const att = await getAttachmentForUser(req.params.id, userId);
      if (!att) return reply.code(404).send({ error: "not_found" });

      // Verificar acceso restringido.
      if (att.access_type === "restricted") {
        const allowed = await isAttachmentAllowed(att.id, userId);
        if (!allowed) {
          return reply.code(403).send({ error: "access_denied" });
        }
      }

      // Verificar PIN si el attachment tiene uno configurado.
      if (att.download_pin_hash) {
        const pin = req.headers["x-download-pin"] as string | undefined;
        if (!pin) {
          return reply.code(403).send({ error: "pin_required" });
        }
        const pinValid = await argon2.verify(att.download_pin_hash, pin);
        if (!pinValid) {
          return reply.code(403).send({ error: "invalid_pin" });
        }
      }

      if (!(await blobExists(att.storage_key))) {
        return reply.code(410).send({ error: "blob_gone" });
      }

      const { path } = streamBlob(att.storage_key);
      const size = Number(att.byte_size);

      reply
        .header("Content-Type", "application/octet-stream")
        .header("Content-Length", String(size))
        .header("Cache-Control", "private, no-store");

      return reply.send(createReadStream(path));
    },
  );
}
