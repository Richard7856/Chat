import { Redis } from "ioredis";
import { config } from "../config.js";

export const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

export async function redisPing(): Promise<boolean> {
  try {
    if (redis.status === "wait" || redis.status === "end") {
      await redis.connect();
    }
    const reply = await redis.ping();
    return reply === "PONG";
  } catch {
    return false;
  }
}
