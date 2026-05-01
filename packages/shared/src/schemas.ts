import { z } from "zod";

export const UuidSchema = z.string().uuid();

export const UserRoleSchema = z.enum(["user", "admin"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const DevicePlatformSchema = z.enum(["web", "ios", "android", "desktop"]);
export type DevicePlatform = z.infer<typeof DevicePlatformSchema>;

export const DeviceStatusSchema = z.enum(["pending", "active", "revoked"]);
export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;

export const ConversationTypeSchema = z.enum(["dm", "group"]);
export type ConversationType = z.infer<typeof ConversationTypeSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  version: z.string(),
  timestamp: z.string().datetime(),
  deps: z.object({
    postgres: z.enum(["up", "down", "unknown"]),
    redis: z.enum(["up", "down", "unknown"]),
  }),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// ============================================================================
// Auth schemas (Fase 2)
// ============================================================================

export const UsernameSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9._-]+$/, "solo minúsculas, dígitos, . _ -");

export const PasswordSchema = z
  .string()
  .min(12, "mínimo 12 caracteres")
  .max(256);

export const TotpTokenSchema = z.string().regex(/^\d{6}$/, "6 dígitos");

export const InviteCodeSchema = z
  .string()
  .regex(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/, "formato ABCD-EFGH-..");

export const CreateInvitationRequestSchema = z.object({
  intendedFor: z.string().max(128).optional(),
  role: UserRoleSchema.default("user"),
  ttlHours: z.number().int().min(1).max(168).default(24),
});
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequestSchema>;

export const CreateInvitationResponseSchema = z.object({
  code: InviteCodeSchema,
  expiresAt: z.string().datetime(),
});
export type CreateInvitationResponse = z.infer<typeof CreateInvitationResponseSchema>;

export const EnrollBeginRequestSchema = z.object({
  code: InviteCodeSchema,
  username: UsernameSchema,
  displayName: z.string().min(1).max(64),
  email: z.string().email().optional(),
});
export type EnrollBeginRequest = z.infer<typeof EnrollBeginRequestSchema>;

export const EnrollBeginResponseSchema = z.object({
  enrollmentId: z.string().uuid(),
  totpUri: z.string(),
  totpQrDataUrl: z.string(),
});
export type EnrollBeginResponse = z.infer<typeof EnrollBeginResponseSchema>;

export const EnrollCompleteRequestSchema = z.object({
  enrollmentId: z.string().uuid(),
  password: PasswordSchema,
  totpToken: TotpTokenSchema,
  deviceName: z.string().min(1).max(64),
  platform: DevicePlatformSchema,
});
export type EnrollCompleteRequest = z.infer<typeof EnrollCompleteRequestSchema>;

export const AuthSuccessResponseSchema = z.object({
  accessToken: z.string(),
  expiresInSec: z.number().int().positive(),
  user: z.object({
    id: z.string().uuid(),
    username: UsernameSchema,
    displayName: z.string(),
    role: UserRoleSchema,
  }),
  device: z.object({
    id: z.string().uuid(),
    deviceName: z.string(),
    platform: DevicePlatformSchema,
  }),
});
export type AuthSuccessResponse = z.infer<typeof AuthSuccessResponseSchema>;

export const LoginRequestSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
  totpToken: TotpTokenSchema,
  deviceName: z.string().min(1).max(64),
  platform: DevicePlatformSchema,
  /**
   * Si el cliente ya enrolló este browser antes, manda el deviceId guardado
   * en el `deviceHint` para que el server reuse la fila existente y no se
   * acumulen devices zombie cuando el usuario re-loguea full (post-localStorage clear,
   * cookies expiradas, etc).
   */
  deviceId: z.string().uuid().optional(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/**
 * Re-autenticación de dispositivo ya enrollado.
 * Permite renovar el JWT usando solo el TOTP — sin re-ingresar
 * usuario ni contraseña y sin crear un device nuevo. El deviceId
 * debe corresponder a un device 'active' en DB.
 */
export const ReauthRequestSchema = z.object({
  deviceId: UuidSchema,
  totpToken: TotpTokenSchema,
});
export type ReauthRequest = z.infer<typeof ReauthRequestSchema>;

export const MeResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    username: UsernameSchema,
    displayName: z.string(),
    email: z.string().email().nullable(),
    role: UserRoleSchema,
    /** Si true, este usuario recibe avisos de seguridad (super admin). */
    receivesSecurityAlerts: z.boolean(),
  }),
  device: z.object({
    id: z.string().uuid(),
    deviceName: z.string(),
    platform: DevicePlatformSchema,
    lastSeenAt: z.string().datetime().nullable(),
  }),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

// ============================================================================
// Chat schemas (Fase 3 — texto plano; Fase 4 añade E2EE)
// ============================================================================

export const UserListItemSchema = z.object({
  id: z.string().uuid(),
  username: UsernameSchema,
  displayName: z.string(),
  role: UserRoleSchema,
});
export type UserListItem = z.infer<typeof UserListItemSchema>;

export const ConversationMemberSchema = z.object({
  userId: z.string().uuid(),
  username: UsernameSchema,
  displayName: z.string(),
  role: z.enum(["member", "admin"]),
  joinedAt: z.string().datetime(),
  /** Fase 18: cuándo leyó el usuario por última vez en esta conversación. */
  lastReadAt: z.string().datetime().nullable(),
});
export type ConversationMember = z.infer<typeof ConversationMemberSchema>;

export const ConversationSchema = z.object({
  id: z.string().uuid(),
  type: ConversationTypeSchema,
  name: z.string().nullable(),
  description: z.string().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  members: z.array(ConversationMemberSchema),
  lastMessage: z
    .object({
      id: z.string().uuid(),
      senderUserId: z.string().uuid(),
      content: z.string().nullable(),
      /**
       * content_type del último mensaje. El cliente lo usa para renderizar
       * un preview amigable en el sidebar (ej. "📋 Nueva tarea: Foo" en vez
       * del JSON crudo).
       */
      contentType: z.string(),
      createdAt: z.string().datetime(),
    })
    .nullable(),
  unreadCount: z.number().int().nonnegative(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const CreateConversationRequestSchema = z
  .object({
    type: ConversationTypeSchema,
    memberUserIds: z.array(z.string().uuid()).min(1).max(50),
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "group" && !v.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "los grupos requieren un nombre",
        path: ["name"],
      });
    }
    if (v.type === "dm" && v.memberUserIds.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "un DM requiere exactamente 1 contraparte",
        path: ["memberUserIds"],
      });
    }
  });
export type CreateConversationRequest = z.infer<
  typeof CreateConversationRequestSchema
>;

/** Base64 (variante ORIGINAL, con padding) de libsodium. */
export const Base64Schema = z
  .string()
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, "base64 esperado");

export const EnvelopeInputSchema = z.object({
  recipientDeviceId: z.string().uuid(),
  ciphertext: Base64Schema,
  nonce: Base64Schema,
});
export type EnvelopeInput = z.infer<typeof EnvelopeInputSchema>;

export const MessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  senderUserId: z.string().uuid(),
  senderDeviceId: z.string().uuid(),
  /** Solo para mensajes legados de Fase 3 (sin E2EE). En Fase 4 es null. */
  content: z.string().nullable(),
  contentType: z.string(),
  createdAt: z.string().datetime(),
  /** Sobre dirigido a MI dispositivo, si existe. Null en mensajes Fase 3
   *  o si mi dispositivo no estaba activo cuando se envió. */
  envelope: z
    .object({ ciphertext: Base64Schema, nonce: Base64Schema })
    .nullable(),
});
export type Message = z.infer<typeof MessageSchema>;

export const SendMessageRequestSchema = z.object({
  contentType: z.string().default("text/plain"),
  /** ID generado en cliente para dedupe + optimistic UI. */
  clientId: z.string().uuid(),
  envelopes: z.array(EnvelopeInputSchema).min(1).max(200),
  /**
   * Fase 14: si este mensaje referencia un adjunto, incluir el attachmentId
   * para que el servidor vincule attachment.message_id = message.id.
   */
  attachmentId: z.string().uuid().optional(),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

export const PublishIdentityRequestSchema = z.object({
  identityPublicKey: Base64Schema,
});
export type PublishIdentityRequest = z.infer<
  typeof PublishIdentityRequestSchema
>;

export const DeviceKeySchema = z.object({
  deviceId: z.string().uuid(),
  userId: z.string().uuid(),
  identityPublicKey: Base64Schema.nullable(),
  deviceName: z.string(),
  platform: DevicePlatformSchema,
});
export type DeviceKey = z.infer<typeof DeviceKeySchema>;

// ============================================================================
// Adjuntos (Fase 5 + Fase 14) — archivos cifrados E2EE
// ============================================================================

/** Content type que identifica un mensaje cuyo plaintext describe un adjunto. */
export const ATTACHMENT_CONTENT_TYPE =
  "application/vnd.euromex.attachment+json";

/**
 * Estructura del plaintext del mensaje cuando es un adjunto. Se serializa
 * como JSON y se cifra como cualquier otro mensaje de texto. El server
 * NUNCA ve este JSON — solo el ciphertext del sobre.
 */
export const AttachmentPayloadSchema = z.object({
  kind: z.literal("attachment"),
  attachmentId: z.string().uuid(),
  fileName: z.string().min(1).max(260),
  mime: z.string().min(1).max(100),
  byteSize: z.number().int().positive(),
  /** Clave AES-256-GCM en base64 (32 bytes). */
  fileKey: Base64Schema,
  /** IV/nonce AES-GCM en base64 (12 bytes). */
  fileIv: Base64Schema,
  /** Opcional: texto adicional que acompaña al archivo. */
  caption: z.string().max(1000).optional(),
});
export type AttachmentPayload = z.infer<typeof AttachmentPayloadSchema>;

/**
 * Payload para dispositivos que NO tienen acceso al documento restringido.
 * No incluye fileKey ni fileIv — solo metadatos para mostrar la burbuja bloqueada.
 */
export const AttachmentRestrictedPayloadSchema = z.object({
  kind: z.literal("attachment_restricted"),
  attachmentId: z.string().uuid(),
  fileName: z.string().min(1).max(260),
  mime: z.string().min(1).max(100),
  byteSize: z.number().int().positive(),
});
export type AttachmentRestrictedPayload = z.infer<typeof AttachmentRestrictedPayloadSchema>;

export const UploadAttachmentResponseSchema = z.object({
  attachmentId: z.string().uuid(),
  byteSize: z.number().int().nonnegative(),
});
export type UploadAttachmentResponse = z.infer<
  typeof UploadAttachmentResponseSchema
>;

/** Un ítem en la biblioteca de documentos de una conversación. */
export const AttachmentListItemSchema = z.object({
  id: z.string().uuid(),
  uploaderUserId: z.string().uuid(),
  uploaderDisplayName: z.string(),
  byteSize: z.number().int(),
  createdAt: z.string().datetime(),
  accessType: z.enum(["all", "restricted"]),
  /** User IDs con acceso (solo relevante cuando accessType = 'restricted'). */
  allowedUserIds: z.array(z.string().uuid()),
  /** true si requiere PIN para descargar. */
  hasPin: z.boolean(),
  /** ID del mensaje que referencia este adjunto (tiene la clave AES). */
  messageId: z.string().uuid().nullable(),
});
export type AttachmentListItem = z.infer<typeof AttachmentListItemSchema>;

// ============================================================================
// System events (avisos de seguridad visibles en el chat)
// ============================================================================

/**
 * Content type de mensajes de sistema (avisos de eventos: descargas, etc.).
 * A diferencia de los mensajes normales, NO son E2EE — son audit events
 * que el server sí conoce y broadcasta. Se almacenan con `content` en
 * plaintext (el JSON del evento) y `envelope` siempre null.
 *
 * Convención del proyecto: visibles a TODOS los miembros de la conversación
 * (transparencia > privacidad individual en contexto corporativo).
 */
export const SYSTEM_CONTENT_TYPE = "application/vnd.euromex.system+json";

export const SystemActorSchema = z.object({
  userId: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
});
export type SystemActor = z.infer<typeof SystemActorSchema>;

export const SystemEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("attachment_downloaded"),
    actor: SystemActorSchema,
    target: z.object({
      attachmentId: z.string().uuid(),
      fileName: z.string(),
      byteSize: z.number().int().nonnegative(),
    }),
  }),
  z.object({
    kind: z.literal("conversation_created"),
    actor: SystemActorSchema,
    conversationType: ConversationTypeSchema,
    memberUserIds: z.array(z.string().uuid()),
  }),
  z.object({
    kind: z.literal("member_added"),
    actor: SystemActorSchema,
    addedMembers: z.array(SystemActorSchema).min(1),
  }),
]);
export type SystemEvent = z.infer<typeof SystemEventSchema>;

export const AttachmentDownloadedNotifySchema = z.object({
  fileName: z.string().min(1).max(260),
  byteSize: z.number().int().nonnegative(),
});
export type AttachmentDownloadedNotify = z.infer<
  typeof AttachmentDownloadedNotifySchema
>;

// ============================================================================
// Admin panel (Fase 9) — endpoints solo accesibles con requireAdmin
// ============================================================================

export const UserStatusSchema = z.enum(["active", "disabled"]);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const AdminUserListItemSchema = z.object({
  id: z.string().uuid(),
  username: UsernameSchema,
  displayName: z.string(),
  email: z.string().email().nullable(),
  role: UserRoleSchema,
  receivesSecurityAlerts: z.boolean(),
  status: UserStatusSchema,
  activeDevicesCount: z.number().int().nonnegative(),
  lastSeenAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  // Fase 10 — campos de perfil extendido (organigrama)
  jobTitle: z.string().nullable(),
  department: z.string().nullable(),
  managerUserId: z.string().uuid().nullable(),
  /** Nombre del jefe directo — denormalizado para no necesitar lookup adicional. */
  managerDisplayName: z.string().nullable(),
});
export type AdminUserListItem = z.infer<typeof AdminUserListItemSchema>;

export const AdminUserUpdateRequestSchema = z
  .object({
    role: UserRoleSchema.optional(),
    receivesSecurityAlerts: z.boolean().optional(),
    displayName: z.string().min(1).max(64).optional(),
    email: z.string().email().nullable().optional(),
    status: UserStatusSchema.optional(),
    // Fase 10 — perfil extendido
    jobTitle: z.string().max(80).nullable().optional(),
    department: z.string().max(80).nullable().optional(),
    /** null = sin jefe; uuid = asignar jefe. El servidor rechaza auto-asignación. */
    managerUserId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (v) =>
      v.role !== undefined ||
      v.receivesSecurityAlerts !== undefined ||
      v.displayName !== undefined ||
      v.email !== undefined ||
      v.status !== undefined ||
      v.jobTitle !== undefined ||
      v.department !== undefined ||
      v.managerUserId !== undefined,
    { message: "al menos un campo debe cambiar" },
  );
export type AdminUserUpdateRequest = z.infer<
  typeof AdminUserUpdateRequestSchema
>;

export const AdminDeviceItemSchema = z.object({
  id: z.string().uuid(),
  deviceName: z.string(),
  platform: DevicePlatformSchema,
  status: DeviceStatusSchema,
  userAgent: z.string().nullable(),
  lastSeenAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
});
export type AdminDeviceItem = z.infer<typeof AdminDeviceItemSchema>;

export const AdminInvitationItemSchema = z.object({
  id: z.string().uuid(),
  intendedFor: z.string().nullable(),
  role: UserRoleSchema,
  expiresAt: z.string().datetime(),
  usedAt: z.string().datetime().nullable(),
  usedByUsername: z.string().nullable(),
  createdAt: z.string().datetime(),
  createdByUsername: z.string(),
});
export type AdminInvitationItem = z.infer<typeof AdminInvitationItemSchema>;

export const AdminAuditLogItemSchema = z.object({
  id: z.number().int(),
  userId: z.string().uuid().nullable(),
  username: z.string().nullable(),
  action: z.string(),
  metadata: z.record(z.unknown()),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AdminAuditLogItem = z.infer<typeof AdminAuditLogItemSchema>;

// ============================================================================
// Actividades y Tareas (Fase 15)
// ============================================================================

/** Content type del mensaje de sistema que representa una actividad en el chat. */
export const ACTIVITY_CONTENT_TYPE = "application/vnd.euromex.activity+json";

/** Content type del mensaje de sistema que representa una tarea en el chat. */
export const TASK_CONTENT_TYPE = "application/vnd.euromex.task+json";

export const CreateActivityRequestSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.number().int().positive().optional(),
  location: z.string().max(300).optional(),
  /** Al menos un participante aparte del creador. */
  participantIds: z.array(z.string().uuid()).min(1),
  /** Conversación donde se publicará el mensaje de la actividad. */
  conversationId: z.string().uuid().optional(),
});
export type CreateActivityRequest = z.infer<typeof CreateActivityRequestSchema>;

export const RsvpRequestSchema = z.object({
  status: z.enum(["confirmed", "declined"]),
});
export type RsvpRequest = z.infer<typeof RsvpRequestSchema>;

export const ActivityParticipantSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  username: z.string(),
  rsvpStatus: z.enum(["pending", "confirmed", "declined"]),
  respondedAt: z.string().datetime().nullable(),
});
export type ActivityParticipant = z.infer<typeof ActivityParticipantSchema>;

export const ActivitySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  creatorUserId: z.string().uuid(),
  creatorDisplayName: z.string(),
  conversationId: z.string().uuid().nullable(),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.number().int().nullable(),
  location: z.string().nullable(),
  status: z.enum(["active", "cancelled"]),
  participants: z.array(ActivityParticipantSchema),
  createdAt: z.string().datetime(),
});
export type Activity = z.infer<typeof ActivitySchema>;

export const CreateTaskRequestSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  dueDate: z.string().date().optional(),
  /** Uno o más responsables. */
  assigneeIds: z.array(z.string().uuid()).min(1),
  /** Conversación donde se publicará el mensaje de la tarea. */
  conversationId: z.string().uuid().optional(),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;

export const TaskAssigneeSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  username: z.string(),
  status: z.enum(["pending", "in_progress", "completed"]),
  completedAt: z.string().datetime().nullable(),
});
export type TaskAssignee = z.infer<typeof TaskAssigneeSchema>;

export const TaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  creatorUserId: z.string().uuid(),
  creatorDisplayName: z.string(),
  conversationId: z.string().uuid().nullable(),
  dueDate: z.string().nullable(),
  status: z.enum(["open", "cancelled"]),
  assignees: z.array(TaskAssigneeSchema),
  createdAt: z.string().datetime(),
});
export type Task = z.infer<typeof TaskSchema>;

// ============================================================================
// Socket.IO events
// ============================================================================

export interface ServerToClientEvents {
  "message:new": (msg: Message) => void;
  "conversation:updated": (conv: Conversation) => void;
  "typing:update": (p: { conversationId: string; userId: string; typing: boolean }) => void;
  /** Fase 15: algún participante actualizó su RSVP en una actividad. */
  "activity:updated": (p: { activityId: string; conversationId: string }) => void;
  /** Fase 15: algún asignado actualizó su estado en una tarea. */
  "task:updated": (p: { taskId: string; conversationId: string }) => void;
  /** Fase 18: un usuario se conectó. */
  "user:online": (p: { userId: string }) => void;
  /** Fase 18: un usuario se desconectó (todas sus pestañas). */
  "user:offline": (p: { userId: string; lastSeenAt: string }) => void;
  /** Fase 18: un usuario leyó una conversación — actualiza read receipts. */
  "message:read": (p: { conversationId: string; userId: string; lastReadAt: string }) => void;
  error: (p: { code: string; message?: string }) => void;
}

export interface ClientToServerEvents {
  "conversation:join": (conversationId: string, ack?: (ok: boolean) => void) => void;
  "conversation:leave": (conversationId: string) => void;
  "message:send": (
    p: {
      conversationId: string;
      clientId: string;
      contentType: string;
      envelopes: EnvelopeInput[];
      /** Fase 14: adjunto referenciado por este mensaje (para vincular message_id). */
      attachmentId?: string;
      /**
       * Fase 19: IDs de usuarios mencionados con @username.
       * Solo se usa para disparar push notifications — no se persiste en DB
       * (el servidor nunca ve el plaintext del mensaje E2EE).
       * El servidor verifica que todos los IDs sean miembros de la conversación.
       */
      mentionedUserIds?: string[];
    },
    ack?: (res: { ok: true; message: Message } | { ok: false; error: string }) => void,
  ) => void;
  "typing:set": (p: { conversationId: string; typing: boolean }) => void;
}

// ============================================================================
// Fase 17 — Mensajes guardados
// ============================================================================

export const StarredMessageSchema = z.object({
  messageId: z.string().uuid(),
  conversationId: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type StarredMessage = z.infer<typeof StarredMessageSchema>;

// ============================================================================
// Fase 18 — Presencia de usuarios
// ============================================================================

export const UserPresenceSchema = z.object({
  userId: z.string().uuid(),
  online: z.boolean(),
  lastSeenAt: z.string().datetime().nullable(),
});
export type UserPresence = z.infer<typeof UserPresenceSchema>;

// ============================================================================
// Fase 19 — Push notifications
// ============================================================================

export const PushSubscribeRequestSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});
export type PushSubscribeRequest = z.infer<typeof PushSubscribeRequestSchema>;
