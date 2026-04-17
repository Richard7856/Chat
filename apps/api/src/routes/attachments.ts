import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { UploadAttachmentResponse } from "@euromex/shared";
import { requireAuth } from "../auth/jwt.js";
import { isConversationMember } from "../chat/repo.js";
import {
  getAttachmentForUser,
  insertAttachment,
} from "../chat/attachments-repo.js";
import {
  blobExists,
  deleteBlob,
  generateStorageKey,
  streamBlob,
  writeBlob,
} from "../storage/files.js";
import { config } from "../config.js";

export async function attachmentRoutes(app: FastifyInstance) {
  // --------------------------------------------------------------------------
  // POST /conversations/:id/attachments — sube un blob ya cifrado
  // El cuerpo es multipart/form-data con un solo campo file="blob".
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

      // Extrae el archivo multipart. Solo uno permitido.
      const part = await req.file({
        limits: {
          fileSize: config.maxAttachmentBytes,
          files: 1,
          fields: 0, // no metadata — todo va en el plaintext del mensaje
        },
      });
      if (!part) {
        return reply.code(400).send({ error: "missing_file" });
      }

      const storageKey = generateStorageKey();
      let byteSize = 0;
      try {
        byteSize = await writeBlob(storageKey, part.file);
      } catch (err) {
        await deleteBlob(storageKey).catch(() => {});
        req.log.error({ err }, "attachment.upload failed");
        return reply.code(500).send({ error: "upload_failed" });
      }

      // Rechaza si Fastify marcó el stream como truncado (archivo excedió
      // el límite durante el stream).
      if (part.file.truncated) {
        await deleteBlob(storageKey).catch(() => {});
        return reply.code(413).send({ error: "file_too_large" });
      }

      const { id: attachmentId } = await insertAttachment({
        conversationId,
        uploaderUserId: userId,
        uploaderDeviceId: deviceId,
        storageKey,
        byteSize,
      });

      return { attachmentId, byteSize };
    },
  );

  // --------------------------------------------------------------------------
  // GET /attachments/:id/download — devuelve el ciphertext crudo
  // El cliente lo descifra con la clave AES que traía el mensaje.
  // --------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/attachments/:id/download",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const att = await getAttachmentForUser(req.params.id, req.session!.sub);
      if (!att) return reply.code(404).send({ error: "not_found" });

      if (!(await blobExists(att.storage_key))) {
        return reply.code(410).send({ error: "blob_gone" });
      }

      const { path } = streamBlob(att.storage_key);
      const size = Number(att.byte_size);

      // Content-Type genérico — el archivo está cifrado, no hay mime real
      // que el server pueda afirmar.
      reply
        .header("Content-Type", "application/octet-stream")
        .header("Content-Length", String(size))
        .header("Cache-Control", "private, no-store");

      return reply.send(createReadStream(path));
    },
  );
}
