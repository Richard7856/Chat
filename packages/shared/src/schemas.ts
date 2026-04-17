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
