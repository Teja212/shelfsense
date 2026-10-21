import { Redis } from "@upstash/redis";

// Shared Upstash Redis client (REST-based, works on Vercel serverless).
// Returns null when the env vars aren't set, so local dev and builds fall back
// to in-memory storage without any Redis dependency at runtime.
let client: Redis | null = null;

export function redis(): Redis | null {
  if (client) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  client = new Redis({ url, token });
  return client;
}
