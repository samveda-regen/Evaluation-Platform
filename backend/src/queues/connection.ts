// Shared Redis connection config for every BullMQ Queue/Worker/QueueEvents.
// Deliberately a plain options object rather than a live ioredis instance:
// BullMQ bundles its own internal ioredis client, and holding a separately
// installed `ioredis` package's Redis instance here causes a type conflict
// between the two copies. A plain object has no such issue and lets each
// BullMQ class construct its own connection.
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

function parseRedisUrl(url: string): { host: string; port: number; username?: string; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
  };
}

export function getRedisConnectionOptions() {
  return {
    ...parseRedisUrl(REDIS_URL),
    // Required by BullMQ on every connection it manages, otherwise its
    // internal blocking commands get cut short by ioredis's default retry behavior.
    maxRetriesPerRequest: null as null,
  };
}
