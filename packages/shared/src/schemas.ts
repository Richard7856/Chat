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
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const MeResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    username: UsernameSchema,
    displayName: z.string(),
    email: z.string().email().nullable(),
    role: UserRoleSchema,
  }),
  device: z.object({
    id: z.string().uuid(),
    deviceName: z.string(),
    platform: DevicePlatformSchema,
    lastSeenAt: z.string().datetime().nullable(),
  }),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;
