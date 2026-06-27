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

/**
 * Fase 24 — Permisos granulares por usuario.
 *
 * Estos flags los controla el admin desde el panel y se devuelven en la
 * respuesta de auth para que el cliente pueda ocultar UI prohibida (los
 * admins igual aplican enforcement server-side, esta es la capa de UX).
 *
 * Defaults sensatos para usuarios nuevos están en la migration 011 y en
 * apps/api/src/db/schema.sql (capacidades existentes preservadas + restricción
 * conservadora en lo que es extracción de info).
 */
export const UserPermissionsSchema = z.object({
  canDownloadAttachments: z.boolean(),
  canShareExternally: z.boolean(),
  canCreateGroups: z.boolean(),
  canInviteUsers: z.boolean(),
  canInitiateCalls: z.boolean(),
  maxAttachmentMb: z.number().int().min(1).max(500),
});
export type UserPermissions = z.infer<typeof UserPermissionsSchema>;

export const AuthSuccessResponseSchema = z.object({
  accessToken: z.string(),
  expiresInSec: z.number().int().positive(),
  user: z.object({
    id: z.string().uuid(),
    username: UsernameSchema,
    displayName: z.string(),
    role: UserRoleSchema,
    /** Fase 24 — permisos efectivos del usuario en este momento. */
    permissions: UserPermissionsSchema,
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

/**
 * Fase 26 (C3) — el usuario cambia su propia password.
 *
 * Requiere TOTP además del password actual para evitar que un atacante
 * con sesión robada pueda cambiar credenciales desde un device autorizado.
 *
 * Si revokeOtherDevices=true (recomendado), todos los devices del usuario
 * EXCEPTO el actual son revocados (zero-trust en credentials filtradas).
 */
export const ChangePasswordRequestSchema = z.object({
  currentPassword: PasswordSchema,
  newPassword: PasswordSchema,
  totpToken: TotpTokenSchema,
  revokeOtherDevices: z.boolean().default(true),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

/**
 * Fase 30 — Login response cuando el user tiene must_change_password=true.
 *
 * El server NO firma el JWT normal (que daría acceso completo) sino un
 * changeToken corto (5 min) que SOLO sirve para llamar /auth/password/forced.
 * Cualquier otro endpoint protegido rechaza este token (lo discrimina por su
 * claim `t === "password-change"`).
 *
 * El cliente detecta esta respuesta vía `if ("changeRequired" in response)` y
 * redirige a la página de cambio forzado.
 */
export const LoginChangeRequiredResponseSchema = z.object({
  changeRequired: z.literal(true),
  changeToken: z.string(),
  username: UsernameSchema,
  displayName: z.string(),
});
export type LoginChangeRequiredResponse = z.infer<
  typeof LoginChangeRequiredResponseSchema
>;

/**
 * Fase 30 — Cambio forzado de password tras un admin reset.
 *
 * Diferencias con /auth/password (Fase 26 C3):
 *   - NO requiere `currentPassword` (la temp ya fue verificada en /auth/login).
 *   - Sí requiere TOTP (segundo factor sigue siendo obligatorio).
 *   - El `changeToken` reemplaza al JWT de sesión — el endpoint lo valida
 *     contra la claim `t === "password-change"` y rechaza cualquier otro.
 *   - Al completar, must_change_password se pone en FALSE y el server devuelve
 *     un AuthSuccessResponse normal (el user queda logueado).
 */
export const ForcedPasswordChangeRequestSchema = z.object({
  changeToken: z.string().min(1),
  newPassword: PasswordSchema,
  totpToken: TotpTokenSchema,
  deviceName: z.string().min(1).max(64),
  platform: DevicePlatformSchema,
});
export type ForcedPasswordChangeRequest = z.infer<
  typeof ForcedPasswordChangeRequestSchema
>;

/**
 * Fase 30 — Admin solicita reset de password para otro user.
 *
 * Requiere TOTP del admin (segundo factor obligatorio para acciones
 * destructivas — un admin con sesión robada NO debería poder resetear
 * passwords sin el authenticator físico).
 *
 * El server genera una temp password random crypto-strong, hashea con
 * Argon2id, marca must_change_password=true, y revoca todos los devices
 * activos del target user (zero-trust: si alguna sesión vieja seguía viva,
 * se invalida ahora).
 *
 * La temp password se devuelve UNA SOLA VEZ en la respuesta. El admin la
 * entrega al user por canal seguro fuera-de-banda (correo personal,
 * WhatsApp, en persona).
 */
export const AdminResetPasswordRequestSchema = z.object({
  adminTotpToken: TotpTokenSchema,
});
export type AdminResetPasswordRequest = z.infer<
  typeof AdminResetPasswordRequestSchema
>;

export const AdminResetPasswordResponseSchema = z.object({
  /** Password temporal de 12 chars (base64url). Mostrar al admin UNA SOLA VEZ. */
  tempPassword: z.string(),
  /** Display info del user reseteado para confirmación visual en el modal. */
  user: z.object({
    id: z.string().uuid(),
    username: UsernameSchema,
    displayName: z.string(),
  }),
  /** Cuántos devices activos fueron revocados como side-effect del reset. */
  revokedDevices: z.number().int().min(0),
});
export type AdminResetPasswordResponse = z.infer<
  typeof AdminResetPasswordResponseSchema
>;

/**
 * Fase 30b — Self-service password reset.
 *
 * Alternativa al admin reset: el user que conserva su authenticator TOTP
 * puede cambiar la password por sí mismo sin esperar a un administrador.
 * El TOTP funciona como segundo factor obligatorio — sin él, no hay reset.
 *
 * Side-effects servidor:
 *   - Si TOTP valida: nuevo password_hash, must_change_password=false (por si
 *     venía de un reset admin pendiente), todos los devices activos del user
 *     son revocados (zero-trust: el user se loguea fresh con la nueva pwd).
 *   - audit_log: 'password.self_reset' con username + ip + count de devices.
 *   - El admin lo ve en su panel → Audit. Si fue ilegítimo, puede investigar.
 *
 * Anti-enumeration: si username no existe o user inactivo, devolvemos el
 * mismo 401 invalid_credentials_or_totp que con TOTP malo. Audit log
 * registra el intento aunque el user no exista.
 *
 * Rate limiting: el rate-limit global del API aplica (300 req/min/IP). Para
 * un attacker queriendo bruteforce de TOTP eso es ~7.5h por user para los
 * 1M de combinaciones — combinado con la ventana 30s del TOTP que invalida
 * cada código, infactible.
 */
export const SelfResetPasswordRequestSchema = z.object({
  username: UsernameSchema,
  totpToken: TotpTokenSchema,
  newPassword: PasswordSchema,
});
export type SelfResetPasswordRequest = z.infer<
  typeof SelfResetPasswordRequestSchema
>;

// ===========================================================================
// Fase 31 — Identidad por usuario con escrow (ver docs/FASE-31-IDENTIDAD-ESCROW.md)
// ===========================================================================

/**
 * El cliente sube su identidad de usuario recién generada. Todos los blobs
 * van en base64. El server los guarda opacos (nunca ve la privada en claro).
 *   - identityPublic: clave pública X25519 (32 bytes)
 *   - identityEncPw: privada envuelta con la llave derivada de la contraseña
 *     (secretbox: nonce||ciphertext)
 *   - pwSalt: salt para derivar la llave de contraseña (16 bytes)
 *   - identityEncEscrow: privada sellada hacia la pública de escrow
 *     (sealed box: ephemeralPub||nonce||ciphertext)
 */
export const EnrollIdentityRequestSchema = z.object({
  identityPublic: z.string().min(1),
  identityEncPw: z.string().min(1),
  pwSalt: z.string().min(1),
  identityEncEscrow: z.string().min(1),
});
export type EnrollIdentityRequest = z.infer<typeof EnrollIdentityRequestSchema>;

/**
 * Estado de la identidad del usuario. El cliente lo consulta tras el login:
 * si `hasIdentity`, descifra `identityEncPw` con la contraseña; si no, genera
 * una identidad nueva y la enrolla.
 */
export const IdentityStatusResponseSchema = z.object({
  hasIdentity: z.boolean(),
  identityPublic: z.string().nullable(),
  identityEncPw: z.string().nullable(),
  pwSalt: z.string().nullable(),
});
export type IdentityStatusResponse = z.infer<typeof IdentityStatusResponseSchema>;

/** Devuelve la pública de escrow para que el cliente selle su identidad. */
export const EscrowPubkeyResponseSchema = z.object({
  escrowPublic: z.string(),
});
export type EscrowPubkeyResponse = z.infer<typeof EscrowPubkeyResponseSchema>;

/**
 * Re-envolver la identidad con una contraseña nueva (cambio de password sin
 * perder identidad). El cliente, ya con la privada en memoria, la re-cifra
 * con la nueva llave de contraseña y sube el nuevo blob + salt.
 */
export const RewrapIdentityRequestSchema = z.object({
  identityEncPw: z.string().min(1),
  pwSalt: z.string().min(1),
});
export type RewrapIdentityRequest = z.infer<typeof RewrapIdentityRequestSchema>;

/**
 * Respuesta de recuperación por escrow. El server, usando la llave de escrow
 * de la organización, descifra la privada de identidad del usuario y la
 * devuelve (vía TLS) para que el cliente la re-envuelva con su nueva
 * contraseña. Se usa cuando el usuario olvidó la contraseña con la que se
 * envolvió su identidad. CADA uso queda auditado (identity.escrow_recovery).
 */
export const IdentityRecoverResponseSchema = z.object({
  privateKey: z.string(), // base64 — userPriv recuperada vía escrow
  publicKey: z.string(), // base64 — userPub (para confirmar consistencia)
});
export type IdentityRecoverResponse = z.infer<typeof IdentityRecoverResponseSchema>;

/**
 * Fase 26 (C4) — rotación de 2FA. Flujo de dos pasos:
 *
 *  1) POST /auth/totp/begin con totpToken actual:
 *     server genera nuevo secret, lo cifra con master key + lo embebe en
 *     un JWT corto (5 min). Devuelve QR + JWT al cliente.
 *
 *  2) POST /auth/totp/confirm con jwt + totpToken (calculado desde el
 *     nuevo secret en la app autenticadora del usuario):
 *     server descifra el secret del JWT, valida totpToken contra él,
 *     persiste el nuevo secret en BD reemplazando el viejo.
 *
 * Esto garantiza que el secret nuevo NUNCA pasa por base de datos hasta
 * que el usuario demuestra que lo configuró bien en su autenticador.
 */
export const BeginTotpRotationRequestSchema = z.object({
  totpToken: TotpTokenSchema, // del secret VIEJO
});
export type BeginTotpRotationRequest = z.infer<
  typeof BeginTotpRotationRequestSchema
>;

export const BeginTotpRotationResponseSchema = z.object({
  /** JWT corto que envuelve el nuevo secret cifrado. Lo manda al server en confirm. */
  rotationToken: z.string(),
  /** otpauth:// URI para que el cliente arme su propio QR si no quiere el PNG. */
  otpauthUri: z.string(),
  /** PNG base64 del QR para enseñar al usuario directamente. */
  qrPngBase64: z.string(),
});
export type BeginTotpRotationResponse = z.infer<
  typeof BeginTotpRotationResponseSchema
>;

export const ConfirmTotpRotationRequestSchema = z.object({
  rotationToken: z.string(),
  totpToken: TotpTokenSchema, // calculado desde el secret NUEVO
});
export type ConfirmTotpRotationRequest = z.infer<
  typeof ConfirmTotpRotationRequestSchema
>;

// ─── Fase 27 — Biometric unlock (per-device) ──────────────────────────────────
//
// Patrón: el server emite un biometric_unlock_token (JWT con ttl largo) que el
// cliente guarda cifrado con biometría en Keystore/Keychain. Al desbloquear
// con huella, el cliente lo recupera y lo manda a /auth/biometric/unlock para
// obtener una session normal. El TOTP se pide en /enable como segundo factor
// de la operación que activa la conveniencia (no del unlock posterior).

export const EnableBiometricRequestSchema = z.object({
  totpToken: TotpTokenSchema,
});
export type EnableBiometricRequest = z.infer<typeof EnableBiometricRequestSchema>;

export const EnableBiometricResponseSchema = z.object({
  /** JWT firmado por el server. El cliente DEBE guardarlo en Keystore/Keychain
   *  cifrado con biometría — nunca en localStorage plano. */
  biometricToken: z.string(),
  /** Mismo TTL que el JWT, en segundos, para que el cliente pueda mostrar
   *  cuándo expira si quiere. */
  expiresInSec: z.number().int().positive(),
});
export type EnableBiometricResponse = z.infer<typeof EnableBiometricResponseSchema>;

export const BiometricUnlockRequestSchema = z.object({
  biometricToken: z.string(),
});
export type BiometricUnlockRequest = z.infer<typeof BiometricUnlockRequestSchema>;

export const MeResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    username: UsernameSchema,
    displayName: z.string(),
    email: z.string().email().nullable(),
    role: UserRoleSchema,
    /** Si true, este usuario recibe avisos de seguridad (super admin). */
    receivesSecurityAlerts: z.boolean(),
    /** Fase 24 — permisos granulares efectivos. */
    permissions: UserPermissionsSchema,
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

// Fase 31: el envelope ahora se dirige a un USUARIO (su identidad compartida
// entre devices), no a un device. Un envelope por usuario destinatario.
export const EnvelopeInputSchema = z.object({
  recipientUserId: z.string().uuid(),
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
  /** Fase 25: si el mensaje fue editado, ISO de la última edición. */
  editedAt: z.string().datetime().nullable().default(null),
  /** Fase 25: número de ediciones; permite mostrar "(editado)" sin tooltip. */
  editCount: z.number().int().nonnegative().default(0),
  /** Fase 25: si el mensaje fue borrado (soft delete), ISO del borrado. */
  deletedAt: z.string().datetime().nullable().default(null),
  /** Fase 25: usuario que ejecutó el borrado. Útil para tombstones tipo
   *  "Borrado por <X>" cuando el sender no es el que borra (futuro: admins). */
  deletedByUserId: z.string().uuid().nullable().default(null),
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

/**
 * Fase 25 — editar un mensaje existente. El cliente re-cifra el contenido
 * para TODOS los devices destinatarios actuales y manda el nuevo set de
 * envelopes. El server archiva los envelopes anteriores en
 * `message_envelopes_history` antes de reemplazarlos.
 *
 * Reglas server-side:
 *  - Solo el sender original puede editar.
 *  - Solo dentro de 24h después del envío original (configurable).
 *  - El message no puede estar borrado (deleted_at IS NULL).
 *  - El contentType DEBE coincidir con el original (no se permite convertir
 *    un text/plain en un attachment).
 */
export const EditMessageRequestSchema = z.object({
  envelopes: z.array(EnvelopeInputSchema).min(1).max(200),
});
export type EditMessageRequest = z.infer<typeof EditMessageRequestSchema>;

/**
 * Fase 23b — agregar envelopes a un mensaje existente (multi-device backfill).
 *
 * Cuando un usuario activa un nuevo dispositivo (ej. instala el APK), las
 * conversaciones tienen mensajes ya creados que NO tienen envelope para ese
 * device — el plaintext fue destruido al cifrar. Los devices que sí tienen
 * el plaintext (los que enviaron originalmente) pueden re-cifrarlos para el
 * device nuevo y publicar envelopes adicionales con este request.
 *
 * Server-side validations:
 *  - El caller debe ser el SENDER original del mensaje (es el único que tiene
 *    plaintext válido).
 *  - Los `recipientDeviceId` deben pertenecer a algún miembro de la
 *    conversación de ese mensaje.
 *  - INSERT con ON CONFLICT (message_id, recipient_device) DO NOTHING — es
 *    seguro reenviar si ya existe.
 */
export const AddEnvelopesRequestSchema = z.object({
  envelopes: z.array(EnvelopeInputSchema).min(1).max(200),
});
export type AddEnvelopesRequest = z.infer<typeof AddEnvelopesRequestSchema>;

/**
 * Fase 31: claves públicas por USUARIO de una conversación. El cliente cifra
 * un envelope por usuario miembro usando su identityPublicKey. Reemplaza el
 * modelo previo de claves por device (DeviceKeySchema).
 */
export const UserKeySchema = z.object({
  userId: z.string().uuid(),
  identityPublicKey: Base64Schema.nullable(),
  displayName: z.string(),
});
export type UserKey = z.infer<typeof UserKeySchema>;

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
  /** Fase 24 — permisos granulares (todos los flags se incluyen completos). */
  permissions: UserPermissionsSchema,
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
    // Fase 24 — permisos granulares (todos opcionales; admin patch-ea solo
    // los que cambian, audit log registra el diff).
    canDownloadAttachments: z.boolean().optional(),
    canShareExternally: z.boolean().optional(),
    canCreateGroups: z.boolean().optional(),
    canInviteUsers: z.boolean().optional(),
    canInitiateCalls: z.boolean().optional(),
    maxAttachmentMb: z.number().int().min(1).max(500).optional(),
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
      v.managerUserId !== undefined ||
      v.canDownloadAttachments !== undefined ||
      v.canShareExternally !== undefined ||
      v.canCreateGroups !== undefined ||
      v.canInviteUsers !== undefined ||
      v.canInitiateCalls !== undefined ||
      v.maxAttachmentMb !== undefined,
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
  /**
   * Fase 23b — Multi-device backfill: un dispositivo de algún miembro
   * de mi conversación publicó su identity public key. Mis dispositivos
   * activos lo escuchan y pueden re-cifrar mensajes históricos para él.
   */
  "device:identity-published": (p: {
    userId: string;
    deviceId: string;
    identityPublicKey: string; // base64
  }) => void;
  /**
   * Fase 23b — backfill: se agregó un envelope nuevo a un mensaje que ya
   * existía. El cliente actualiza el mensaje en memoria y descifra.
   */
  "message:envelope-added": (p: {
    messageId: string;
    conversationId: string;
    envelope: { ciphertext: string; nonce: string };
    senderUserId: string;
    senderDeviceId: string;
    contentType: string;
    createdAt: string;
  }) => void;
  /**
   * Fase 25 — el mensaje fue editado. El payload incluye el envelope
   * dirigido al device del receptor (ya re-cifrado con el nuevo plaintext);
   * el cliente actualiza el bubble in-place y muestra "(editado)".
   */
  "message:edited": (p: {
    messageId: string;
    conversationId: string;
    envelope: { ciphertext: string; nonce: string } | null;
    editCount: number;
    editedAt: string;
  }) => void;
  /**
   * Fase 25 — el mensaje fue borrado (soft delete). Los envelopes siguen
   * existiendo en BD para auditoría, pero el cliente debe dejar de
   * mostrarlo y poner un tombstone.
   */
  "message:deleted": (p: {
    messageId: string;
    conversationId: string;
    deletedAt: string;
    deletedByUserId: string;
  }) => void;
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
